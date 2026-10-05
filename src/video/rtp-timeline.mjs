// A restarted live decoder has fresh RTP counters. Preserve the outgoing
// timeline so existing WebRTC viewers can keep their audio/video receivers.
export class RtpTimeline {
  constructor(rate,step){this.rate=rate;this.step=step;this.first=true;this.last=null;this.seqOffset=0;this.timeOffset=0;}
  restart(){this.first=true;}
  map(packet,now=performance.now()){
    const data=Buffer.from(packet),seq=data.readUInt16BE(2),timestamp=data.readUInt32BE(4);
    if(this.first){this.first=false;if(this.last){
      this.seqOffset=(this.last.seq+1-seq)&65535;
      this.timeOffset=(this.last.timestamp+Math.max(this.step,Math.round((now-this.last.at)*this.rate/1000))-timestamp)>>>0;
    }}
    data.writeUInt16BE((seq+this.seqOffset)&65535,2);data.writeUInt32BE((timestamp+this.timeOffset)>>>0,4);
    this.last={seq:data.readUInt16BE(2),timestamp:data.readUInt32BE(4),at:now};return data;
  }
}
