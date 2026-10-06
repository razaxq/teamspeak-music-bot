import { peer, MediaSource, videoProfile } from './media.mjs';
import { resolveVideo } from './bilibili.mjs';
import {ServerError} from '@honeybbq/teamspeak-client';
let owner = null;
const escape = v => String(v).replace(/\\/g,'\\\\').replace(/ /g,'\\s').replace(/\//g,'\\/').replace(/\|/g,'\\p').replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\t/g,'\\t');
export const command = (name, fields) => name+' '+Object.entries(fields).map(([k,v])=>`${k}=${escape(v)}`).join(' ');
export function publicOffer(sdp, ip) {
  if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || ip.split('.').some(n=>Number(n)>255))throw new Error('Video public IP is not configured');
  return sdp.replace(/^(a=candidate:\S+ \d+ UDP \d+) (\S+) (\d+) typ host(.*)$/gmi,(_,head,_ip,port,tail)=>`${head} ${ip} ${port} typ host${tail}`);
}
export class VideoSession {
  isLive=false; recoveryTask=null;
  state='idle'; title=''; stream=null; generation=0; viewers=new Map(); source=null; error=''; stopTask=null; serverStopped=false; joinGate=Promise.resolve();
  constructor(ts, options={}) {
    this.publication=null;this.publicationTimeoutMs=options.publicationTimeoutMs??8000;
    this.diagnostics={};this.liveRetryDelayMs=options.liveRetryDelayMs??2000;this.getCookie=options.getCookie||(()=> '');this.profile=null;this.ts=ts; this.resolve=options.resolve||resolveVideo; this.makeSource=options.makeSource||(()=>new MediaSource());
    this.makePeer=options.makePeer||(()=>peer(true));this.changed=options.changed||(()=>{});
    this.listener=n=>{void this.handle(n).catch(()=>{this.error='共享连接失败，请重新加入';this.changed();});};
    ts.on('rawNotification',this.listener);
  }
  get active(){return this.state!=='idle';}
  status(){return {enabled:process.env.TS_VIDEO_ENABLED==='1',isLive:this.isLive,state:this.state,title:this.title,viewers:[...this.viewers.values()].filter(v=>v.pc.connectionState==='connected').length,error:this.error,streamId:this.stream,publisherId:this.ts.getClientId(),packets:{...this.source?.counts},inputHealth:{...this.source?.inputHealth},playout:{...this.source?.playout?.stats},connections:[...this.viewers.entries()].map(([clientId,v])=>({clientId,state:v.pc.connectionState,ice:v.pc.iceConnectionState,media:(v.pc.getSenders?.()||[]).map(s=>({kind:s.kind,packets:s.packetCount,lost:s.remotePacketsLost,lossFraction:s.remoteFractionLost,rttMs:s.rtt===undefined?null:Math.round(s.rtt*1000),nacks:s.nackCount,plis:s.pliCount,retransmits:s.retransmittedPacketsSent,estimatedBitrate:s.receiverEstimatedMaxBitrate===undefined?null:Number(s.receiverEstimatedMaxBitrate)}))})),diagnostics:this.diagnostics,resolution:this.profile?`${this.profile.height}p / ${this.profile.fps}fps`:null};}
  async start(query, height=720, onEnded) {
    videoProfile(height);
    if(process.env.TS_VIDEO_ENABLED!=='1')throw new Error('视频功能未启用');
    if(owner||this.active)throw new Error('已有视频共享，请先停止');
    if((!process.env.MEDIA_BIND_IP&&!process.env.MEDIA_BIND_INTERFACE)||!process.env.PUBLIC_IP)throw new Error('视频网络配置缺失');
    this.serverStopped=false;owner=this;const generation=++this.generation;
    this.state='loading';this.error='';this.diagnostics={};this.changed();
    try {
      const input=await this.resolve(query,{cookie:this.getCookie(),height});
      if(generation!==this.generation)return;
      this.isLive=!!input.live;
      this.title=input.title;
      const source=this.makeSource();this.source=source;
      source.onEnd=async (complete=true)=>{
        if(this.source!==source)return;
        if(input.live){
          if(!this.stream)return;
          if(!this.recoveryTask){const task=this.recoverLive(source,query,height,generation,onEnded).catch(()=>{if(generation===this.generation){this.error='直播恢复失败，请停止共享后重试';this.changed();}}).finally(()=>{if(this.recoveryTask===task)this.recoveryTask=null;});this.recoveryTask=task;}
          await this.recoveryTask;return;
        }
        try {await this.stop();} catch {return;}
        if(generation+1!==this.generation)return;
        if(complete) {try {await onEnded?.();} catch {this.error='无法播放下一项';this.changed();}}
        else {this.error='视频播放中断，请重试';this.changed();}
      };
      this.profile=videoProfile(height,input.height||360,!!input.live);
      await source.start(input,this.profile);
      if(generation!==this.generation){await source.stop();return;}
      const publication=this.publish(command('setupstream',{name:input.title.slice(0,80),type:3,bitrate:this.profile.kbps+128,accessibility:1,mode:1,viewer_limit:0,audio:1}));
      const result=await publication.done;
      if(generation!==this.generation)return;
      if(result.error)throw result.error;
      this.stream=publication.id;this.clearPublication(publication);
      this.state='playing';this.changed();
    } catch(e) {
      if(generation===this.generation){
        try {await this.stop();} catch { /* An uncertain publication retains its lease and late-notification listener. */ }
        this.error=this.publication?'共享发布结果未确认，请重试停止；仍失败时请重连机器人':e.message;this.changed();
      }
      throw e;
    }
  }
  publish(cmd) {
    const p={id:null,ack:false,settled:false,rejected:false};
    p.done=new Promise(resolve=>{p.finish=result=>{if(p.settled)return;p.settled=true;clearTimeout(p.timer);resolve(result);};});
    p.handler=n=>{
      if(n.name!=='notifystreamstarted'||Number(n.params.clid)!==this.ts.getClientId())return;
      const id=n.params.id||n.params.stream_id;if(!id||p.id)return;
      p.id=id;
      if(p.ack)p.finish({});
      // A timeout is not proof that setup failed. Retain ownership until a
      // late successful publication is explicitly stopped or TS disconnects.
      this.retryPublicationClose(p);
    };
    this.publication=p;this.ts.on('rawNotification',p.handler);
    p.timer=setTimeout(()=>p.finish({error:new Error('TeamSpeak 未确认视频共享')}),this.publicationTimeoutMs);
    Promise.resolve().then(()=>this.serverStopped?undefined:this.ts.execCommand(cmd)).then(()=>{
      p.ack=true;if(p.id)p.finish({});
    },error=>{
      // Only an explicit protocol rejection proves no share was created.
      // Network/command timeouts retain ownership until confirmation.
      p.rejected=error instanceof ServerError&&!p.id;
      p.finish({error});if(p.rejected)this.retryPublicationClose(p);
    });
    return p;
  }
  retryPublicationClose(p) {
    if(this.state==='stopping')void (async()=>{
      await this.stopTask?.catch(()=>{});
      if(this.publication===p)await this.stop();
    })().catch(()=>{});
  }
  clearPublication(p) {
    if(!p)return;
    clearTimeout(p.timer);this.ts.off('rawNotification',p.handler);
    if(this.publication===p)this.publication=null;
  }
  pause(paused) {
    if(this.isLive)throw new Error('直播不支持暂停；请停止共享，再次播放会回到实时画面');
    if(!['playing','paused'].includes(this.state))throw new Error('当前没有可暂停的视频');
    if(!this.source?.process?.kill(paused?'SIGSTOP':'SIGCONT'))throw new Error('视频进程不可用');
    this.state=paused?'paused':'playing';this.changed();
  }
  stop(serverStopped=false) {
    if(serverStopped){this.serverStopped=true;this.publication?.finish({});}
    if(this.stopTask)return this.stopTask;
    this.stopTask=this.closeStream().finally(()=>{this.stopTask=null;});
    return this.stopTask;
  }
  async recoverLive(source,query,height,generation,onEnded) {
    const current=()=>generation===this.generation&&this.source===source;
    this.state='reconnecting';this.error='直播连接中断，正在重新连接';this.changed();
    for(let attempt=0;attempt<3&&current();attempt++){
      await source.stop();
      await new Promise(r=>setTimeout(r,this.liveRetryDelayMs));if(!current())return;
      try{
        const input=await this.resolve(query,{cookie:this.getCookie(),height});if(!current())return;
        await source.start(input,this.profile);
        if(!current()){await source.stop();return;}
        this.diagnostics.liveRestarts=(this.diagnostics.liveRestarts||0)+1;
        this.state='playing';this.error='';this.changed();return;
      }catch(error){
        if(!current())return;
        if(error.code==='LIVE_OFFLINE'){
          await this.stop();this.error='直播已结束';this.changed();
          if(generation+1===this.generation)await onEnded?.();return;
        }
      }
    }
    if(current()){await this.stop();this.error='直播重连失败，请重新播放';this.changed();}
  }
  async closeStream() {
    this.recoveryTask=null;
    ++this.generation;const publication=this.publication;
    const source=this.source;this.source=null;
    const peers=[...this.viewers.values()];this.viewers.clear();
    this.state=(this.stream||publication)?'stopping':'idle';this.changed();
    if(source?.process)source.process.kill('SIGCONT');
    const cleanup=Promise.allSettled([source?.stop(),...peers.map(async v=>{clearTimeout(v.timeout);v.remove();await v.pc.close();})]);
    try {
      if(publication&&!this.serverStopped)await publication.done;
      const stream=this.stream||publication?.id;
      if(publication&&!stream&&!publication.rejected&&!this.serverStopped)throw new Error('共享发布结果未确认，请重试停止；仍失败时请重连机器人');
      if(stream&&!this.serverStopped)await this.ts.execCommand(command('stopstream',{id:stream,reason:1}));
    } catch(error) {
      if(!this.serverStopped) {
        await cleanup;
        this.error='旧视频共享关闭失败，请重试停止';this.changed();
        // Keep the stream ID and global lease so a failed close cannot create duplicate shares.
        throw error;
      }
    }
    await cleanup;
    this.clearPublication(publication);
    this.stream=null;this.state='idle';this.title='';this.profile=null;this.isLive=false;
    if(owner===this)owner=null;
    this.changed();
  }
  async remove(clid, expectedPeer) {
    const v=this.viewers.get(clid);if(!v||(expectedPeer&&v.pc!==expectedPeer))return;
    this.viewers.delete(clid);clearTimeout(v.timeout);v.remove();await v.pc.close();this.changed();
  }
  async handle({name,params:p}) {
    if(name==='notifystreamstopped'&&(p.id||p.stream_id)&&(p.id||p.stream_id)===(this.stream||this.publication?.id)){
      await this.stop(true);return;
    }
    if(!this.stream||(p.id||p.stream_id)!==this.stream)return;
    this.diagnostics.lastNotification=name;const clid=Number(p.clid);
    if(name!=="notifystreamsignaling")this.diagnostics.lastRequest={name,clientId:clid,remove:p.is_remove||"0"};
    if(name==='notifyjoinstreamrequest') {
      // Removal from the approval queue is not a viewer-leave event.
      if(p.is_remove==='1')return;
      // Serialize admissions and replacement of stale sessions.
      this.joinGate=this.joinGate.catch(()=>{}).then(()=>this.join(clid));await this.joinGate;
    } else if(name==='notifystreamsignaling') {
      const v=this.viewers.get(clid);if(!v)return;
      const raw=p.json||p.data||'';if(raw.length>262144)return;
      const signal=JSON.parse(raw);this.diagnostics.lastSignal=signal.cmd;
      if(signal.cmd==='answer'&&typeof signal.args?.answer==='string'){this.diagnostics.answerReceived=true;await v.pc.setRemoteDescription({type:'answer',sdp:signal.args.answer});this.diagnostics.answerApplied=true;}
      if(signal.cmd==='iceCandidate'&&typeof signal.args?.sdp==='string')await v.pc.addIceCandidate({candidate:signal.args.sdp,sdpMid:signal.args.mid,sdpMLineIndex:signal.args.mLine});
    } else if(name==='notifystreamclientleft')await this.remove(clid);
    else if(name==='notifystreamstopped')await this.stop(true);
  }
  async join(clid) {
    if(!this.stream||!Number.isInteger(clid)||clid<=0)return;
    // A fresh join must replace a stale session from the same TS client.
    await this.remove(clid);
    const stream=this.stream,generation=this.generation;
    this.diagnostics.joinRequests=(this.diagnostics.joinRequests||0)+1;const pc=this.makePeer();const remove=this.source.addPeer(pc);
    const timeout=setTimeout(()=>{this.diagnostics.timeout=true;void this.remove(clid,pc);},90000);
    pc.iceConnectionStateChange.subscribe(state=>{this.diagnostics.lastIceState=state;});
    this.viewers.set(clid,{pc,remove,timeout});this.changed();
    pc.connectionStateChange.subscribe(state=>{
      this.diagnostics.lastConnectionState=state;
      if(state==='connected')clearTimeout(timeout);
      if(state==='failed'||state==='closed')void this.remove(clid,pc);
    });
    try {
      await pc.setLocalDescription(await pc.createOffer());
      if(generation!==this.generation||this.viewers.get(clid)?.pc!==pc)return;
      const offer=publicOffer(pc.localDescription.sdp,process.env.PUBLIC_IP);
      this.diagnostics.candidatePorts=[...offer.matchAll(/^a=candidate:.*? (\d+) typ /gm)].map(m=>Number(m[1]));
      if(!/^a=candidate:/m.test(offer))throw new Error('No media port available');
      await this.ts.sendCommandNoWait(command('respondjoinstreamrequest',{id:stream,clid,msg:'',offer,decision:1}));
    } catch(e){await this.remove(clid,pc);throw e;}
  }
}
