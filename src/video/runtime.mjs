import { peer, MediaSource } from './media.mjs';
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
    this.ts=ts; this.resolve=options.resolve||resolveVideo; this.makeSource=options.makeSource||(()=>new MediaSource());
    this.makePeer=options.makePeer||(()=>peer(true));this.changed=options.changed||(()=>{});
    this.listener=n=>{void this.handle(n).catch(()=>{this.error='共享连接失败，请重新加入';this.changed();});};
    ts.on('rawNotification',this.listener);
  }
  get active(){return this.state!=='idle';}
  status(){return {enabled:process.env.TS_VIDEO_ENABLED==='1',state:this.state,title:this.title,viewers:this.viewers.size,error:this.error,streamId:this.stream,publisherId:this.ts.getClientId(),packets:{...this.source?.counts}};}
  async start(query) {
    if(process.env.TS_VIDEO_ENABLED!=='1')throw new Error('视频功能未启用');
    if(owner||this.active)throw new Error('已有视频共享，请先停止');
    if((!process.env.MEDIA_BIND_IP&&!process.env.MEDIA_BIND_INTERFACE)||!process.env.PUBLIC_IP)throw new Error('视频网络配置缺失');
    owner=this;const generation=++this.generation;
    this.state='loading';this.error='';this.changed();
    try {
      const input=await this.resolve(query);
      if(generation!==this.generation)return;
      this.title=input.title;
      const source=this.makeSource();this.source=source;
      source.onEnd=()=>{if(this.source===source)void this.stop();};
      await source.start(input);
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
        await this.ts.execCommand(command('setupstream',{name:input.title.slice(0,80),type:3,bitrate:800,accessibility:1,mode:1,viewer_limit:3,audio:1}));
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
    this.state='idle';this.title='';this.changed();
    if(source?.process)source.process.kill('SIGCONT');
    await Promise.allSettled([source?.stop(),...peers.map(async v=>{clearTimeout(v.timeout);v.remove();await v.pc.close();}),
      stream?this.ts.sendCommandNoWait(command('stopstream',{id:stream})):Promise.resolve()]);
    if(owner===this)owner=null;
  }
  async remove(clid) {
    const v=this.viewers.get(clid);if(!v)return;
    this.viewers.delete(clid);clearTimeout(v.timeout);v.remove();await v.pc.close();this.changed();
  }
  async handle({name,params:p}) {
    if(!this.stream||(p.id||p.stream_id)!==this.stream)return;
    const clid=Number(p.clid);
    if(name==='notifyjoinstreamrequest') {
      // Serialize candidate gathering: the three allowed UDP ports cannot race.
      this.joinGate=this.joinGate.catch(()=>{}).then(()=>this.join(clid));await this.joinGate;
    } else if(name==='notifystreamsignaling') {
      const v=this.viewers.get(clid);if(!v)return;
      const raw=p.json||p.data||'';if(raw.length>262144)return;
      const signal=JSON.parse(raw);
      if(signal.cmd==='answer'&&typeof signal.args?.answer==='string')await v.pc.setRemoteDescription({type:'answer',sdp:signal.args.answer});
      if(signal.cmd==='iceCandidate'&&typeof signal.args?.sdp==='string')await v.pc.addIceCandidate({candidate:signal.args.sdp,sdpMid:signal.args.mid,sdpMLineIndex:signal.args.mLine});
    } else if(name==='notifystreamclientleft')await this.remove(clid);
    else if(name==='notifystreamstopped')await this.stop();
  }
  async join(clid) {
    if(!this.stream||!Number.isInteger(clid)||clid<=0||this.viewers.has(clid))return;
    const stream=this.stream,generation=this.generation;
    if(this.viewers.size>=3){await this.ts.sendCommandNoWait(command('respondjoinstreamrequest',{id:stream,clid,decision:0,msg:'视频原型最多三位观众'}));return;}
    const pc=this.makePeer();const remove=this.source.addPeer(pc);
    const timeout=setTimeout(()=>{void this.remove(clid);},25000);
    this.viewers.set(clid,{pc,remove,timeout});this.changed();
    pc.connectionStateChange.subscribe(state=>{
      if(state==='connected')clearTimeout(timeout);
      if(state==='failed'||state==='closed')void this.remove(clid);
    });
    try {
      await pc.setLocalDescription(await pc.createOffer());
      if(generation!==this.generation||this.viewers.get(clid)?.pc!==pc)return;
      const offer=publicOffer(pc.localDescription.sdp,process.env.PUBLIC_IP);
      if(!/^a=candidate:/m.test(offer))throw new Error('No media port available');
      await this.ts.sendCommandNoWait(command('respondjoinstreamrequest',{id:stream,clid,msg:'',offer,decision:1}));
    } catch(e){await this.remove(clid);throw e;}
  }
}
