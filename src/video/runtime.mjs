import { peer, MediaSource, videoProfile } from './media.mjs';
import { resolveVideo } from './bilibili.mjs';
let owner = null;
const escape = v => String(v).replace(/\\/g,'\\\\').replace(/ /g,'\\s').replace(/\//g,'\\/').replace(/\|/g,'\\p').replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\t/g,'\\t');
export const command = (name, fields) => name+' '+Object.entries(fields).map(([k,v])=>`${k}=${escape(v)}`).join(' ');
export function publicOffer(sdp, ip) {
  if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || ip.split('.').some(n=>Number(n)>255))throw new Error('Video public IP is not configured');
  return sdp.replace(/^(a=candidate:\S+ \d+ UDP \d+) (\S+) (\d+) typ host(.*)$/gmi,(_,head,_ip,port,tail)=>`${head} ${ip} ${port} typ host${tail}`);
}
export class VideoSession {
  state='idle'; title=''; stream=null; generation=0; viewers=new Map(); source=null; error=''; joinGate=Promise.resolve();
  constructor(ts, options={}) {
    this.diagnostics={};this.getCookie=options.getCookie||(()=> '');this.profile=null;this.ts=ts; this.resolve=options.resolve||resolveVideo; this.makeSource=options.makeSource||(()=>new MediaSource());
    this.makePeer=options.makePeer||(()=>peer(true));this.changed=options.changed||(()=>{});
    this.listener=n=>{void this.handle(n).catch(()=>{this.error='共享连接失败，请重新加入';this.changed();});};
    ts.on('rawNotification',this.listener);
  }
  get active(){return this.state!=='idle';}
  status(){return {enabled:process.env.TS_VIDEO_ENABLED==='1',state:this.state,title:this.title,viewers:[...this.viewers.values()].filter(v=>v.pc.connectionState==='connected').length,error:this.error,streamId:this.stream,publisherId:this.ts.getClientId(),packets:{...this.source?.counts},connections:[...this.viewers.entries()].map(([clientId,v])=>({clientId,state:v.pc.connectionState,ice:v.pc.iceConnectionState})),diagnostics:this.diagnostics,resolution:this.profile?`${this.profile.height}p / ${this.profile.fps}fps`:null};}
  async start(query, height=720, onEnded) {
    videoProfile(height);
    if(process.env.TS_VIDEO_ENABLED!=='1')throw new Error('视频功能未启用');
    if(owner||this.active)throw new Error('已有视频共享，请先停止');
    if((!process.env.MEDIA_BIND_IP&&!process.env.MEDIA_BIND_INTERFACE)||!process.env.PUBLIC_IP)throw new Error('视频网络配置缺失');
    owner=this;const generation=++this.generation;
    this.state='loading';this.error='';this.diagnostics={};this.changed();
    try {
      const input=await this.resolve(query,{cookie:this.getCookie(),height});
      if(generation!==this.generation)return;
      this.title=input.title;
      const source=this.makeSource();this.source=source;
      source.onEnd=async (complete=true)=>{
        if(this.source!==source)return;
        await this.stop();
        if(generation+1!==this.generation)return;
        if(complete) {try {await onEnded?.();} catch {this.error='无法播放下一项';this.changed();}}
        else {this.error='视频播放中断，请重试';this.changed();}
      };
      this.profile=videoProfile(height,input.height||360);
      await source.start(input,this.profile);
      if(generation!==this.generation){await source.stop();return;}
      let handler,timer;
      const ready=new Promise((resolve,reject)=>{
        handler=n=>{if(n.name==='notifystreamstarted'&&Number(n.params.clid)===this.ts.getClientId())resolve(n.params.id||n.params.stream_id);};
        this.ts.on('rawNotification',handler);
        timer=setTimeout(()=>reject(new Error('TeamSpeak 未确认视频共享')),8000);
      });
      // Attach a rejection handler while the command is in flight.
      ready.catch(()=>{});
      try {
        await this.ts.execCommand(command('setupstream',{name:input.title.slice(0,80),type:3,bitrate:this.profile.kbps+128,accessibility:1,mode:1,viewer_limit:0,audio:1}));
        const stream=await ready;
        if(generation!==this.generation){await this.ts.sendCommandNoWait(command('stopstream',{id:stream}));return;}
        this.stream=stream;this.state='playing';this.changed();
      } finally {clearTimeout(timer);this.ts.off('rawNotification',handler);}
    } catch(e) {if(generation===this.generation){await this.stop();this.error=e.message;this.changed();}throw e;}
  }
  pause(paused) {
    if(!['playing','paused'].includes(this.state))throw new Error('当前没有可暂停的视频');
    if(!this.source?.process?.kill(paused?'SIGSTOP':'SIGCONT'))throw new Error('视频进程不可用');
    this.state=paused?'paused':'playing';this.changed();
  }
  async stop() {
    ++this.generation;const stream=this.stream;this.stream=null;
    const source=this.source;this.source=null;
    const peers=[...this.viewers.values()];this.viewers.clear();
    this.state='idle';this.title='';this.profile=null;this.changed();
    if(source?.process)source.process.kill('SIGCONT');
    await Promise.allSettled([source?.stop(),...peers.map(async v=>{clearTimeout(v.timeout);v.remove();await v.pc.close();}),
      stream?this.ts.sendCommandNoWait(command('stopstream',{id:stream})):Promise.resolve()]);
    if(owner===this)owner=null;
  }
  async remove(clid, expectedPeer) {
    const v=this.viewers.get(clid);if(!v||(expectedPeer&&v.pc!==expectedPeer))return;
    this.viewers.delete(clid);clearTimeout(v.timeout);v.remove();await v.pc.close();this.changed();
  }
  async handle({name,params:p}) {
    if(!this.stream||(p.id||p.stream_id)!==this.stream)return;
    this.diagnostics.lastNotification=name;const clid=Number(p.clid);
    if(name!=="notifystreamsignaling")this.diagnostics.lastRequest={name,clientId:clid,remove:p.is_remove||"0"};
    if(name==='notifyjoinstreamrequest') {
      // Removal from the approval queue is not a viewer-leave event.
      if(p.is_remove==='1')return;
      // Serialize candidate gathering: the three allowed UDP ports cannot race.
      this.joinGate=this.joinGate.catch(()=>{}).then(()=>this.join(clid));await this.joinGate;
    } else if(name==='notifystreamsignaling') {
      const v=this.viewers.get(clid);if(!v)return;
      const raw=p.json||p.data||'';if(raw.length>262144)return;
      const signal=JSON.parse(raw);this.diagnostics.lastSignal=signal.cmd;
      if(signal.cmd==='answer'&&typeof signal.args?.answer==='string'){this.diagnostics.answerReceived=true;await v.pc.setRemoteDescription({type:'answer',sdp:signal.args.answer});this.diagnostics.answerApplied=true;}
      if(signal.cmd==='iceCandidate'&&typeof signal.args?.sdp==='string')await v.pc.addIceCandidate({candidate:signal.args.sdp,sdpMid:signal.args.mid,sdpMLineIndex:signal.args.mLine});
    } else if(name==='notifystreamclientleft')await this.remove(clid);
    else if(name==='notifystreamstopped')await this.stop();
  }
  async join(clid) {
    if(!this.stream||!Number.isInteger(clid)||clid<=0)return;
    // A fresh join must replace a stale session from the same TS client.
    await this.remove(clid);
    const stream=this.stream,generation=this.generation;
    if(this.viewers.size>=3){await this.ts.sendCommandNoWait(command('respondjoinstreamrequest',{id:stream,clid,decision:0,msg:'视频原型最多三位观众'}));return;}
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
