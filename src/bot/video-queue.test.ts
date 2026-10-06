import {describe,it,expect,vi,afterEach} from 'vitest';
vi.mock('@discordjs/opus',()=>({default:{OpusEncoder:class {}}}));
import {BotInstance} from './instance.js';
import {PlayQueue,PlayMode} from '../audio/queue.js';
const video={id:'BV1KN411N7sG',name:'video',artist:'fixture',album:'',platform:'bilibili',coverUrl:'',duration:10} as any;
function context(){
 const c=Object.create(BotInstance.prototype);Object.assign(c,{
  connected:true,config:{commandPrefix:'!'},queue:new PlayQueue(),player:{stop:vi.fn(),getState:()=> 'idle'},
  videoSession:{active:false,stop:vi.fn(async()=>{c.videoSession.active=false;})},
  spotifyController:{stop:vi.fn()},profileManager:{onSongChange:vi.fn(async()=>{})},
  logger:{warn:vi.fn()},emit:vi.fn(),sweepLocalAudio:vi.fn(),disableFmMode:vi.fn(),
  cmdPause:vi.fn(),playNext:vi.fn(async()=>true),
 });
 c.queue.add(video);c.queue.add({...video,id:'next',name:'next'});c.queue.play();return c;
}
async function start(c:any,queued=true){
 let ended:any;c.videoSession.start=vi.fn(async(_q:any,_h:any,cb:any)=>{ended=cb;c.videoSession.active=true;});
 await c.startVideo(video.id,720,queued?video:undefined);return ()=>ended?.();
}
afterEach(()=>vi.unstubAllEnvs());
describe('video queue control',()=>{
 it('clear awaits video teardown before clearing the queue',async()=>{
  vi.stubEnv('TS_VIDEO_ENABLED','1');const c=context();await start(c);let finish!:()=>void;
  c.videoSession.stop.mockImplementation(()=>new Promise<void>(r=>finish=()=>{c.videoSession.active=false;r();}));
  const pending=c.executeCommand({name:'clear',args:''});expect(c.queue.size()).toBe(2);
  finish();expect(await pending).toBe('Queue cleared');expect(c.queue.size()).toBe(0);expect(c.videoSession.active).toBe(false);
 });
 it.each([PlayMode.Sequential,PlayMode.Loop,PlayMode.Random,PlayMode.RandomLoop])('deleting current video in %s stops and advances exactly once',async mode=>{
  vi.stubEnv('TS_VIDEO_ENABLED','1');const c=context();c.queue.setMode(mode);const ended=await start(c);
  c.playNext.mockImplementation(async()=>{c.queue.next();return true;});
  await c.executeCommand({name:'remove',args:'1'});await ended();
  expect(c.videoSession.stop).toHaveBeenCalledOnce();expect(c.playNext).toHaveBeenCalledOnce();expect(c.queue.current()?.id).toBe('next');
 });
 it('removing another item does not stop the current share or lose its completion',async()=>{
  vi.stubEnv('TS_VIDEO_ENABLED','1');const c=context();const ended=await start(c);
  await c.executeCommand({name:'remove',args:'2'});expect(c.videoSession.stop).not.toHaveBeenCalled();await ended();expect(c.playNext).toHaveBeenCalledOnce();
 });
 it('a failed stop leaves the current queue entry intact',async()=>{
  vi.stubEnv('TS_VIDEO_ENABLED','1');const c=context();await start(c);c.videoSession.stop.mockRejectedValue(Error('close failed'));
  await expect(c.executeCommand({name:'remove',args:'1'})).rejects.toThrow('close failed');expect(c.queue.size()).toBe(2);expect(c.queue.current()).toBe(video);
  await expect(c.executeCommand({name:'clear',args:''})).rejects.toThrow('close failed');expect(c.queue.size()).toBe(2);
 });
 it('an independent share is not mistaken for the queued item being deleted',async()=>{
  vi.stubEnv('TS_VIDEO_ENABLED','1');const c=context();await start(c,false);await c.executeCommand({name:'remove',args:'1'});
  expect(c.videoSession.stop).not.toHaveBeenCalled();expect(c.playNext).not.toHaveBeenCalled();
 });
 it('invalid commands and unsuccessful lookup preserve the existing share',async()=>{
  vi.stubEnv('TS_VIDEO_ENABLED','1');const c=context();await start(c);
  expect(await c.executeCommand({name:'play',args:''})).toMatch(/^Usage:/);
  expect(await c.executeCommand({name:'move',args:''})).toMatch(/^Usage:/);
  c.resolvePlayQuery=vi.fn(async()=>({error:'No results'}));
  expect(await c.executeCommand({name:'play',args:'missing'})).toBe('No results');
  expect(c.videoSession.stop).not.toHaveBeenCalled();expect(c.videoSession.active).toBe(true);
 });
});
