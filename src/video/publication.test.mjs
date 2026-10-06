import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {VideoSession} from './runtime.mjs';
import {ServerError,CommandTimeoutError} from '@honeybbq/teamspeak-client';
process.env.TS_VIDEO_ENABLED='1';process.env.MEDIA_BIND_IP='127.0.0.1';process.env.PUBLIC_IP='127.0.0.1';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const until=async f=>{for(let i=0;i<100;i++){if(f())return;await new Promise(r=>setImmediate(r));}throw Error('barrier not reached');};
function setup(options={}){
 const ts=new EventEmitter(),pending=[],remote=new Set(),commands=[];ts.getClientId=()=>7;
 ts.execCommand=async cmd=>{commands.push(cmd);
  if(cmd.startsWith('setupstream ')){const ack=deferred();pending.push(ack);await ack.promise;}
  if(cmd.startsWith('stopstream ')){const id=/id=(\S+)/.exec(cmd)[1];remote.delete(id);}
 };
 const s=new VideoSession(ts,{resolve:async query=>({title:query}),makeSource:()=>({start:async()=>{},stop:async()=>{}}),...options});
 const notify=id=>{remote.add(id);ts.emit('rawNotification',{name:'notifystreamstarted',params:{clid:'7',id}});};
 return {s,ts,pending,remote,commands,notify};
}
test('stop during publication holds ownership until the old share is confirmed closed',async()=>{
 const x=setup();try{
  const first=x.s.start('first');await until(()=>x.pending.length===1);
  const stop=x.s.stop();assert.equal(x.s.state,'stopping');
  await assert.rejects(x.s.start('second'),/已有/);
  x.notify('old');x.pending[0].resolve();await Promise.all([first,stop]);
  assert.deepEqual([...x.remote],[]);assert.equal(x.s.state,'idle');
  const second=x.s.start('second');await until(()=>x.pending.length===2);
  x.notify('new');x.pending[1].resolve();await second;
  assert.equal(x.s.stream,'new');await x.s.stop();assert.equal(x.remote.size,0);
  assert.equal(x.ts.listenerCount('rawNotification'),1);
 }finally{await x.s.stop(true);}
});
test('timeout retains lease; late publication is stopped before a new share is allowed',async()=>{
 const x=setup({publicationTimeoutMs:5});try{
  const first=x.s.start('first');await until(()=>x.pending.length===1);x.pending[0].resolve();
  await assert.rejects(first,/未确认/);assert.equal(x.s.state,'stopping');
  await assert.rejects(x.s.start('second'),/已有/);await assert.rejects(x.s.stop(),/未确认/);
  x.notify('late');await until(()=>x.s.state==='idle');
  assert.equal(x.remote.size,0);assert.ok(x.commands.includes('stopstream id=late reason=1'));
  assert.equal(x.ts.listenerCount('rawNotification'),1);
 }finally{await x.s.stop(true);}
});
test('confirmed disconnection cancels an outstanding publication without waiting for its timeout',async()=>{
 const x=setup();const start=x.s.start('first');await until(()=>x.pending.length===1);
 const stop=x.s.stop();await x.s.stop(true);await Promise.all([start,stop]);
 assert.equal(x.s.state,'idle');assert.equal(x.ts.listenerCount('rawNotification'),1);
 x.pending[0].resolve();
});
test('unrelated notifications cannot claim or cancel the outstanding publication',async()=>{
 const x=setup();try{
  const start=x.s.start('first');await until(()=>x.pending.length===1);
  await x.s.handle({name:'notifystreamstopped',params:{}});
  x.ts.emit('rawNotification',{name:'notifystreamstarted',params:{clid:'99',id:'other'}});
  assert.equal(x.s.state,'loading');assert.equal(x.s.publication.id,null);
  x.notify('own');x.pending[0].resolve();await start;assert.equal(x.s.stream,'own');
 }finally{await x.s.stop(true);}
});
test('explicit server rejection releases capacity; command timeout does not',async()=>{
 const x=setup();try{
  x.ts.execCommand=async()=>{throw new ServerError('2568','insufficient permissions');};
  await assert.rejects(x.s.start('denied'),ServerError);assert.equal(x.s.state,'idle');
  x.ts.execCommand=async()=>{throw new CommandTimeoutError('setupstream');};
  await assert.rejects(x.s.start('uncertain'),CommandTimeoutError);assert.equal(x.s.state,'stopping');
  await assert.rejects(x.s.start('blocked'),/已有/);
 }finally{await x.s.stop(true);}
});
test('a failed close of a late publication preserves ownership for an explicit retry',async()=>{
 const x=setup({publicationTimeoutMs:5});try{
  const start=x.s.start('first');await until(()=>x.pending.length===1);x.pending[0].resolve();await assert.rejects(start);
  const exec=x.ts.execCommand;x.ts.execCommand=async c=>{if(c.startsWith('stopstream'))throw Error('rejected');return exec(c);};
  x.notify('late');await until(()=>x.s.stopTask===null);
  await assert.rejects(x.s.stop());assert.equal(x.s.active,true);assert.equal(x.remote.size,1);
  x.ts.execCommand=exec;await x.s.stop();assert.equal(x.s.state,'idle');assert.equal(x.remote.size,0);
 }finally{await x.s.stop(true);}
});
