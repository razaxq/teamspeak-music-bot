import {test} from 'node:test';import assert from 'node:assert/strict';
import {RtpPlayoutBuffer} from './playout-buffer.mjs';
function fixture(options={}){
 let time=0,id=0;const timers=new Map(),out=[];
 const b=new RtpPlayoutBuffer((kind,data)=>out.push({kind,time,ts:data.readUInt32BE(4)}),{now:()=>time,setTimer:(fn,ms)=>{const n=++id;timers.set(n,{at:time+ms,fn});return n;},clearTimer:n=>timers.delete(n),...options});
 const advance=end=>{for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;timers.delete(next[0]);time=next[1].at;next[1].fn();}time=end;};
 const packet=ts=>{const p=Buffer.alloc(20);p[0]=0x80;p.writeUInt32BE(ts>>>0,4);return p;};return {b,out,advance,packet};
}
test('bursty live audio is delivered at 20ms intervals, with video delayed equally',()=>{
 const x=fixture();for(let i=0;i<5;i++)x.b.push('audio',x.packet(500+i*960));
 x.b.push('video',x.packet(1000));x.b.push('video',x.packet(1000));x.b.push('video',x.packet(5500));
 x.advance(249);assert.equal(x.out.length,0);x.advance(350);
 assert.deepEqual(x.out.filter(p=>p.kind==='audio').map(p=>p.time),[250,270,290,310,330]);
 assert.deepEqual(x.out.filter(p=>p.kind==='video').map(p=>p.time),[250,250,300]);
 assert.equal(x.b.stats.latePackets,0);assert.equal(x.b.bytes,0);
});
test('RTP timestamp wrap does not delay a packet for an entire clock cycle',()=>{
 const x=fixture();x.b.push('audio',x.packet(0xfffffff0));x.b.push('audio',x.packet(0xfffffff0+960));x.advance(300);
 assert.deepEqual(x.out.map(p=>p.time),[250,270]);
});
test('stop clears delayed packets and the queue has a memory bound',()=>{
 const x=fixture({maxBytes:40});assert.ok(x.b.push('audio',x.packet(0)));assert.ok(x.b.push('audio',x.packet(960)));
 assert.equal(x.b.push('audio',x.packet(1920)),false);assert.equal(x.b.stats.overflows,1);
 x.b.stop();x.advance(1000);assert.equal(x.out.length,0);assert.equal(x.b.bytes,0);
});
test('late input is counted and delivered without changing its RTP clock or building extra delay',()=>{
 const x=fixture();x.b.push('audio',x.packet(0));x.advance(500);x.b.push('audio',x.packet(960));x.advance(500);
 assert.equal(x.out[1].time,500);assert.equal(x.out[1].ts,960);assert.equal(x.b.stats.latePackets,1);
});

test('a live session can run beyond a full RTP clock wrap',()=>{
 const x=fixture();for(let i=0;i<=5;i++){x.b.push('video',x.packet(i*1000000000));x.advance(250+i*1000000000/90);}
 assert.equal(x.out.length,6);assert.ok(x.out.at(-1).time>2**32/90);assert.equal(x.b.stats.latePackets,0);
});
