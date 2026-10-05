import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {parseLiveRoom,resolveLive} from './live.mjs';
import {RtpTimeline} from './rtp-timeline.mjs';
const fetchOriginal=globalThis.fetch;afterEach(()=>globalThis.fetch=fetchOriginal);
test('room parsing accepts canonical links and rejects other hosts or arbitrary URLs',()=>{
 for(const value of ['https://live.bilibili.com/31550614?live_from=71002','https://live.bilibili.com/blanc/31550614','live:31550614','[URL]https://live.bilibili.com/31550614[/URL]'])assert.equal(parseLiveRoom(value),'31550614');
 for(const value of ['31550614','https://live.bilibili.com.evil.test/31550614','https://evil.test/?url=https://live.bilibili.com/31550614','http://127.0.0.1/123','https://x@live.bilibili.com/31550614','live:0'])assert.equal(parseLiveRoom(value),null);
});
test('live resolver keeps credentials on the API and accepts only trusted H264 HTTPS media',async()=>{
 const calls=[];globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return{ok:true,json:async()=>({code:0,data:url.includes('get_info')?{room_id:123,title:'test',live_status:1}:{playurl_info:{playurl:{stream:[{protocol_name:'http_stream',format:[{format_name:'flv',codec:[{codec_name:'avc',base_url:'/live.flv',url_info:[{host:'https://evil.test',extra:'?signed=fixture'},{host:'https://live-cdn.bilivideo.com',extra:'?signed=fixture'}]}]}]}]}}}})};};
 const result=await resolveLive('live:123',{cookie:'fixture-cookie',height:480});assert.equal(result.live,true);assert.equal(result.height,480);assert.equal(result.url,'https://live-cdn.bilivideo.com/live.flv?signed=fixture');assert.equal('cookie' in result,false);
 assert.equal(calls.length,2);for(const c of calls){assert.equal(new URL(c.url).hostname,'api.live.bilibili.com');assert.equal(c.opts.headers.Cookie,'fixture-cookie');assert.equal(c.opts.redirect,'error');}
});
test('offline rooms do not attempt to resolve a playback URL',async()=>{
 let calls=0;globalThis.fetch=async()=>{calls++;return{ok:true,json:async()=>({code:0,data:{room_id:123,live_status:0}})};};
 await assert.rejects(resolveLive('live:123'),e=>e.code==='LIVE_OFFLINE');assert.equal(calls,1);
});
test('live RTP restart preserves sequence and media clock across wraparound',()=>{
 const t=new RtpTimeline(48000,960);const packet=(seq,ts)=>{const b=Buffer.alloc(13);b[0]=0x80;b.writeUInt16BE(seq,2);b.writeUInt32BE(ts,4);b[12]=99;return b;};
 const a=t.map(packet(65535,0xfffffff0),100);t.restart();const b=t.map(packet(421,1234),2100);const c=t.map(packet(422,2194),2120);
 assert.equal(a.readUInt16BE(2),65535);assert.equal(b.readUInt16BE(2),0);assert.equal(c.readUInt16BE(2),1);assert.equal(b.readUInt32BE(4),(0xfffffff0+96000)>>>0);assert.equal(c.readUInt32BE(4),(b.readUInt32BE(4)+960)>>>0);assert.equal(c[12],99);
});
