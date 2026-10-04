import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveVideo} from './bilibili.mjs';
import {videoProfile} from './media.mjs';
test('authenticated resolver confines cookie to Bilibili API and chooses allowed source quality',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options});return {ok:true,json:async()=>({code:0,data:url.includes('/view?')?{title:'test',pages:[{cid:1,duration:10}]}:{dash:{video:[{height:1080,bandwidth:100,baseUrl:'https://example.bilivideo.com/1080'},{height:720,bandwidth:200,baseUrl:'https://example.bilivideo.com/720'}],audio:[{bandwidth:96,baseUrl:'https://example.bilivideo.com/audio'}]}}})};
 };
 try {
  const result=await resolveVideo('BV1KN411N7sG',{cookie:'fixture-only',height:720});assert.equal(result.height,720);
  assert.ok(calls.every(c=>new URL(c.url).hostname==='api.bilibili.com'&&c.options.headers.Cookie==='fixture-only'&&c.options.redirect==='error'));
  assert.equal(JSON.stringify(result).includes('fixture-only'),false);
  assert.equal((await resolveVideo('BV1KN411N7sG',{cookie:'fixture-only',height:1080})).height,1080);
 }finally{globalThis.fetch=original;}
});
test('source quality fallback does not upscale or allow arbitrary encoder sizes',()=>{
 assert.equal(videoProfile(1080,480).height,480);
 assert.deepEqual(videoProfile(720,1080),{height:720,width:1280,fps:20,kbps:1600});
 assert.equal(videoProfile(1080,1080).fps,15);
 assert.throws(()=>videoProfile(4320,4320));
});
