import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {VideoSession,publicOffer,command} from './runtime.mjs';
import {parseVideo} from './bilibili.mjs';
process.env.TS_VIDEO_ENABLED='1';process.env.MEDIA_BIND_IP='127.0.0.1';process.env.PUBLIC_IP='8.133.175.38';
function setup(resolve=async()=>({title:'test'})) {
  const ts=new EventEmitter(),sent=[];ts.getClientId=()=>7;
  ts.execCommand=async c=>{sent.push(c);queueMicrotask(()=>ts.emit('rawNotification',{name:'notifystreamstarted',params:{clid:'7',id:'stream'}}));};
  ts.sendCommandNoWait=async c=>sent.push(c);
  let stopped=0,signals=[];
  const source={start:async()=>{},stop:async()=>{stopped++;},process:{kill:s=>{signals.push(s);return true;}}};
  const session=new VideoSession(ts,{resolve,makeSource:()=>source});
  return {session,sent,signals,get stopped(){return stopped;}};
}
test('Bilibili input cannot inject a URL or command',()=>{
  assert.deepEqual(parseVideo('https://www.bilibili.com/video/BV1KN411N7sG/?p=2'),{bvid:'BV1KN411N7sG',page:2});
  assert.throws(()=>parseVideo('http://127.0.0.1/secret'));
  assert.throws(()=>parseVideo('https://www.bilibili.com/video/BV1KN411N7sG/?p=-1'));
  assert.equal(command('test',{name:'x y\nz|a'}),'test name=x\\sy\\nz\\pa');
});
test('public offer retains allowed ports and rejects an invalid public address',()=>{
  assert.equal(publicOffer('a=candidate:1 1 UDP 1 172.1.1.1 12199 typ host\r\n','8.133.175.38'),'a=candidate:1 1 UDP 1 8.133.175.38 12199 typ host\r\n');
  assert.throws(()=>publicOffer('', '999.1.2.3'));
});
test('play, pause, resume, stop clean up without clearing a music queue',async()=>{
  const x=setup();await x.session.start('BV1KN411N7sG');assert.equal(x.session.state,'playing');
  x.session.pause(true);assert.equal(x.session.state,'paused');x.session.pause(false);
  assert.deepEqual(x.signals,['SIGSTOP','SIGCONT']);
  await x.session.stop();assert.equal(x.session.active,false);assert.equal(x.stopped,1);
  assert.ok(x.sent.some(c=>c==='stopstream id=stream'));
});
test('stop during URL resolution cancels publication and releases global capacity',async()=>{
  let finish;const x=setup(()=>new Promise(r=>{finish=r;}));const pending=x.session.start('BV1KN411N7sG');
  await x.session.stop();finish({title:'late'});await pending;assert.deepEqual(x.sent,[]);
  const next=setup();await next.session.start('BV1KN411N7sG');await next.session.stop();
});
test('only one bot may allocate video ports; failed resolution releases capacity',async()=>{
  const a=setup(),b=setup();await a.session.start('BV1KN411N7sG');
  await assert.rejects(b.session.start('BV1KN411N7sG'));await a.session.stop();
  const bad=setup(async()=>{throw new Error('unavailable');});await assert.rejects(bad.session.start('BV1KN411N7sG'));
  await b.session.start('BV1KN411N7sG');await b.session.stop();
});
