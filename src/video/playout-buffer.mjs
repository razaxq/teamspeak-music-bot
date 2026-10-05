// Preserve RTP timestamps and smooth the bursty output of a live FLV decoder.
// Both tracks receive the same initial delay so audio buffering does not add an A/V offset.
export class RtpPlayoutBuffer {
  constructor(deliver,{delayMs=250,maxBytes=16*1024*1024,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout}={}) {
    Object.assign(this,{deliver,delayMs,maxBytes,now,setTimer,clearTimer});
    this.queue=[];this.anchors={};this.bytes=0;this.timer=null;this.closed=false;
    this.stats={delivered:0,latePackets:0,overflows:0,maxBufferedBytes:0};
  }
  push(kind,data) {
    if(this.closed||data.length<12)return false;
    if(this.bytes+data.length>this.maxBytes){this.stats.overflows++;return false;}
    const now=this.now(),timestamp=data.readUInt32BE(4),rate=kind==='audio'?48000:90000;
    const anchor=this.anchors[kind]??= {timestamp,time:now+this.delayMs,ticks:0};
    const step=(timestamp-anchor.timestamp)>>>0;
    if(step>=0x80000000)return false;
    anchor.timestamp=timestamp;anchor.ticks+=step;
    const due=anchor.time+anchor.ticks*1000/rate;
    const item={kind,data,due};let index=this.queue.length;
    while(index>0&&this.queue[index-1].due>due)index--;
    this.queue.splice(index,0,item);this.bytes+=data.length;
    this.stats.maxBufferedBytes=Math.max(this.stats.maxBufferedBytes,this.bytes);
    if(index===0)this.schedule();return true;
  }
  schedule() {
    if(this.timer!==null)this.clearTimer(this.timer);this.timer=null;
    if(this.closed||!this.queue.length)return;
    this.timer=this.setTimer(()=>{this.timer=null;this.drain();},Math.max(0,this.queue[0].due-this.now()));
    this.timer?.unref?.();
  }
  drain() {
    const now=this.now();
    while(this.queue.length&&this.queue[0].due<=now+0.5){
      const p=this.queue.shift();this.bytes-=p.data.length;
      if(now-p.due>20)this.stats.latePackets++;
      this.stats.delivered++;this.deliver(p.kind,p.data);
    }
    this.schedule();
  }
  stop() {
    this.closed=true;if(this.timer!==null)this.clearTimer(this.timer);
    this.timer=null;this.queue=[];this.bytes=0;
  }
}
