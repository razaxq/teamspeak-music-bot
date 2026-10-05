import { RTCPeerConnection, RTCRtpCodecParameters, MediaStreamTrack } from 'werift';
import dgram from 'node:dgram';
import { spawn } from 'node:child_process';
import {useSharedUdp} from './shared-udp.mjs';
import {remoteInput,remoteInputOptions} from './input-options.mjs';
import {RtpTimeline} from './rtp-timeline.mjs';
import {networkInterfaces} from 'node:os';
export const codecs = {
  video: [new RTCRtpCodecParameters({mimeType:'video/VP8',clockRate:90000,payloadType:96,rtcpFeedback:[{type:'nack'},{type:'nack',parameter:'pli'}]})],
  audio: [new RTCRtpCodecParameters({mimeType:'audio/opus',clockRate:48000,channels:2,payloadType:111,parameters:'minptime=10;useinbandfec=1'})],
};
export function peer(sender=false) {
  const bindIp=process.env.MEDIA_BIND_IP || networkInterfaces()[process.env.MEDIA_BIND_INTERFACE||'eth0']?.find(a=>a.family==='IPv4'&&!a.internal)?.address;
  if(sender&&!bindIp)throw new Error('Video network interface not available');
  const pc = new RTCPeerConnection({codecs,bundlePolicy:'max-bundle',iceUseIpv6:false,
    iceServers:sender ? [] : [{urls:'stun:ali.dtft.net:12196'}], ...(sender ? {iceAdditionalHostAddresses:[bindIp],
      iceInterfaceAddresses:{udp4:bindIp}} : {})});
  return sender ? useSharedUdp(pc,bindIp) : pc;
}
export function videoProfile(requested=720, sourceHeight=1080) {
  if(![360,480,720,1080].includes(requested))throw new Error('Unsupported video resolution');
  const height=Math.max(2,Math.floor(Math.min(requested,sourceHeight)/2)*2);
  return {height,width:Math.floor(height*16/9/2)*2,fps:height>720?15:20,kbps:height<=360?650:height<=480?1000:height<=720?1600:2500};
}
export class MediaSource {
  tracks = new Set(); sockets = []; process = null;
  counts = {video:0,audio:0};
  inputHealth = {reconnects:0,readErrors:0};
  timelines = {video:new RtpTimeline(90000,4500),audio:new RtpTimeline(48000,960)};
  addPeer(pc) {
    const tracks = ['video','audio'].map(kind => new MediaStreamTrack({kind}));
    tracks.forEach(track => pc.addTransceiver(track,{direction:'sendonly'}));
    this.tracks.add(tracks);
    return () => {this.tracks.delete(tracks);tracks.forEach(t=>t.stop());};
  }
  async start(input, profile=videoProfile(360,360)) {
    const before={...this.counts};
    const ports = [];
    for (const kind of ['video','audio']) {
      this.timelines[kind].restart();
      const socket = dgram.createSocket('udp4');
      await new Promise((resolve,reject)=>{socket.once('error',reject);socket.bind(0,'127.0.0.1',resolve);});
      this.sockets.push(socket); ports.push(socket.address().port);
      socket.on('message', data=>{
        if(data.length<12) return;
        if(input?.live)data=this.timelines[kind].map(data);
        this.counts[kind]++;
        for (const tracks of this.tracks) tracks[kind==='video'?0:1].writeRtp(Buffer.from(data));
      });
    }
    const inputs = input?.live ? [...remoteInputOptions(),'-headers','Referer: https://live.bilibili.com/\r\nUser-Agent: Mozilla/5.0\r\n','-i',input.url]
      : input ? [...remoteInput(input.video),...remoteInput(input.audio)]
      : ['-re','-f','lavfi','-i','testsrc2=size=640x360:rate=20','-re','-f','lavfi','-i','sine=frequency=440:sample_rate=48000'];
    this.process=spawn('ffmpeg',['-hide_banner','-loglevel','warning',...inputs,
      '-map','0:v:0','-an','-vf',`scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2,fps=${profile.fps}`,
      '-c:v','libvpx','-deadline','realtime','-cpu-used','8','-threads','1','-b:v',`${profile.kbps}k`,'-g',String(profile.fps),
      '-payload_type','96','-f','rtp',`rtp://127.0.0.1:${ports[0]}?pkt_size=1100`,
      '-map',input?.live?'0:a:0':'1:a:0','-vn','-ac','2','-ar','48000','-c:a','libopus','-b:a','96k','-frame_duration','20',
      '-payload_type','111','-f','rtp',`rtp://127.0.0.1:${ports[1]}?pkt_size=1100`],{stdio:['ignore','ignore','pipe']});
    // Do not log FFmpeg's stderr: signed media URLs can appear in errors.
    let pending='';
    this.process.stderr.on('data',data=>{
      pending+=data.toString();const lines=pending.split(/[\r\n]/);pending=lines.pop().slice(-8192);
      for(const line of lines){
        if(/Will reconnect at/.test(line))this.inputHealth.reconnects++;
        if(/Stream ends prematurely|Input\/output error|Connection timed out|Error in the pull function/.test(line))this.inputHealth.readErrors++;
      }
    });
    const encoder=this.process;
    encoder.on('error',()=>{if(this.process===encoder)this.onEnd?.(false);});
    encoder.on('exit',code=>{if(this.process===encoder)this.onEnd?.(code===0);});
    if(input?.live){
      for(let i=0;i<300;i++){
        if(this.process!==encoder||encoder.exitCode!==null||encoder.killed)throw new Error('直播解码已停止');
        if(this.counts.video>before.video&&this.counts.audio>before.audio)return;
        await new Promise(r=>setTimeout(r,50));
      }
      throw new Error('直播音视频读取超时');
    }
  }
  async stop() {
    const p=this.process; this.process=null;
    if(p && p.exitCode===null){p.kill('SIGTERM');await Promise.race([new Promise(r=>p.once('exit',r)),new Promise(r=>setTimeout(()=>{p.kill('SIGKILL');r();},3000).unref())]);}
    this.sockets.forEach(s=>s.close());this.sockets=[];
  }
}
