import {describe,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import pino from 'pino';
import {createPlayerRouter} from './player.js';
function setup(user:any={role:'admin',bots:'all'}) {
  const bot={startVideo:vi.fn(),stopVideo:vi.fn(),pauseVideo:vi.fn(),getVideoStatus:()=>({state:'idle',enabled:true})};
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user=user;next();});
  app.use('/api/player',createPlayerRouter({getBot:(id:string)=>id==='b'?bot:undefined} as any,pino({level:'silent'})));
  return {app,bot};
}
describe('video playback permissions',()=>{
  it('accepts a live room through the same authorized video endpoint',async()=>{
    const {app,bot}=setup();const query='https://live.bilibili.com/31550614?live_from=71002';
    expect((await request(app).post('/api/player/b/video').send({action:'start',query})).status).toBe(200);
    expect(bot.startVideo).toHaveBeenCalledWith(query,480);
    expect((await request(app).post('/api/player/b/video').send({action:'start',query,height:720})).status).toBe(200);
    expect(bot.startVideo).toHaveBeenLastCalledWith(query,720);
    expect((await request(app).post('/api/player/b/video').send({action:'start',query:'https://live.bilibili.com.evil.test/31550614'})).status).toBe(400);
  });
  it.each([
    [null,401],
    [{role:'member',bots:'all',capabilities:new Set()},403],
    [{role:'member',bots:new Set(['other']),capabilities:new Set(['player.control'])},403],
    [{role:'guest',bots:'all',guest:{transport:true}},403],
    [{role:'member',bots:new Set(['b']),capabilities:new Set(['player.control'])},200],
  ])('preserves bot access and player.control %j',async(user,status)=>{
    const {app,bot}=setup(user);
    const r=await request(app).post('/api/player/b/video').send({action:'start',query:'BV1KN411N7sG'});
    expect(r.status).toBe(status);expect(bot.startVideo).toHaveBeenCalledTimes(status===200?1:0);
  });
  it.each([{action:'start',query:'http://127.0.0.1/secrets'},{action:'start',query:{}},{action:'exec',query:'BV1KN411N7sG'}])('rejects invalid requests %j',async body=>{
    const {app,bot}=setup();expect((await request(app).post('/api/player/b/video').send(body)).status).toBe(400);expect(bot.startVideo).not.toHaveBeenCalled();
  });
  it('uses video controls without calling music queue controls',async()=>{
    const {app,bot}=setup();for(const action of ['pause','resume','stop'])expect((await request(app).post('/api/player/b/video').send({action})).status).toBe(200);
    expect(bot.pauseVideo.mock.calls).toEqual([[true],[false]]);expect(bot.stopVideo).toHaveBeenCalledOnce();
  });
});

it('rejects unsupported resolution and passes supported selection to the bot',async()=>{
 const {app,bot}=setup();
 expect((await request(app).post('/api/player/b/video').send({action:'start',query:'BV1KN411N7sG',height:4320})).status).toBe(400);
 expect(bot.startVideo).not.toHaveBeenCalled();
 expect((await request(app).post('/api/player/b/video').send({action:'start',query:'BV1KN411N7sG',height:1080})).status).toBe(200);
 expect(bot.startVideo).toHaveBeenCalledWith('BV1KN411N7sG',1080);
});
