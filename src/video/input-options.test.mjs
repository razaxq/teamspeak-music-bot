import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {remoteInputOptions,remoteInput} from './input-options.mjs';
function run(args){return new Promise((resolve,reject)=>{const p=spawn('ffmpeg',['-hide_banner','-loglevel','error',...args],{stdio:['ignore','pipe','pipe']});const chunks=[];let error='';p.stdout.on('data',b=>chunks.push(b));p.stderr.on('data',b=>error+=b);p.on('error',reject);const timer=setTimeout(()=>p.kill('SIGKILL'),25000);p.on('exit',code=>{clearTimeout(timer);resolve({code,data:Buffer.concat(chunks),error});});});}
test('audio resumes at the interrupted byte range and normal EOF completes without replay',{timeout:60000},async()=>{
 const fixture=await run(['-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','8','-c:a','aac','-b:a','96k','-f','adts','pipe:1']);assert.equal(fixture.code,0);
 const payload=fixture.data;let interrupt=false,requests=[],interrupted=false;
 const server=createServer((req,res)=>{const start=Number(req.headers.range?.match(/bytes=(\d+)/)?.[1]||0);requests.push(start);if(start>=payload.length){res.writeHead(416,{'Content-Range':`bytes */${payload.length}`});res.end();return;}
 res.writeHead(start?206:200,{'Content-Length':payload.length-start,'Accept-Ranges':'bytes',...(start?{'Content-Range':`bytes ${start}-${payload.length-1}/${payload.length}`}:{})});
 if(interrupt&&start===0){interrupted=true;res.write(payload.subarray(start,Math.floor(payload.length*.4)));setTimeout(()=>res.destroy(),20);}else res.end(payload.subarray(start));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/audio.aac`;
 const decode=options=>run([...options,'-f','aac','-probesize','32','-analyzeduration','0','-i',url,'-ac','2','-ar','48000','-f','s16le','pipe:1']);
 try{
  const full=await decode([]);assert.equal(full.code,0);
  interrupt=true;interrupted=false;requests=[];const broken=await decode([]);assert.ok(broken.data.length<full.data.length);const brokenSize=broken.data.length;
  interrupted=false;requests=[];const recovered=await decode(remoteInputOptions());assert.equal(recovered.code,0);assert.deepEqual(recovered.data,full.data);assert.ok(requests.some(x=>x>0));assert.ok(requests.length<8);
  assert.equal(remoteInput(url).filter(x=>x==='-reconnect').length,1);assert.equal(remoteInputOptions().includes('-reconnect_at_eof'),false);
  console.log(JSON.stringify({baselinePcmBytes:full.data.length,interruptedWithoutRecovery:brokenSize,recoveredPcmBytes:recovered.data.length,resumeOffsets:requests,normalEof:'PASS'}));
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
