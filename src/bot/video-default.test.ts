import {describe,it,expect,vi,afterEach} from 'vitest';
vi.mock('@discordjs/opus',()=>({default:{OpusEncoder:class {}}}));
import {BotInstance} from './instance.js';
const proto=BotInstance.prototype as any;
afterEach(()=>vi.unstubAllEnvs());
const song={id:'BV1KN411N7sG?p=2',platform:'bilibili',name:'test',duration:10};
function context(){
 const provider={getSongUrl:vi.fn(async()=>({url:'https://fixture.invalid/audio'}))};
 return {connected:true,voteSkipUsers:new Set(),player:{stop:vi.fn(),play:vi.fn(),pause:vi.fn(),resume:vi.fn()},
 getProviderFor:()=>provider,provider,startVideo:vi.fn(async()=>{}),logger:{error:vi.fn()},database:{addPlayHistory:vi.fn()},emit:vi.fn(),syncProfileToSong:vi.fn(async()=>{}),queue:{current:()=>song}} as any;
}
describe('default Bilibili video routing',()=>{
 it('all callers of the shared resolver start video without resolving an audio URL',async()=>{
  vi.stubEnv('TS_VIDEO_ENABLED','1');const c=context();expect(await proto.resolveAndPlay.call(c,song)).toBe(true);
  expect(c.startVideo).toHaveBeenCalledWith(song.id,720,song);expect(c.provider.getSongUrl).not.toHaveBeenCalled();expect(c.player.play).not.toHaveBeenCalled();
 });
 it('does not silently fall back to audio after video publication fails',async()=>{
  vi.stubEnv('TS_VIDEO_ENABLED','1');const c=context();c.startVideo.mockRejectedValue(new Error('publish failed'));
  expect(await proto.resolveAndPlay.call(c,song)).toBe(false);expect(c.player.play).not.toHaveBeenCalled();
 });
 it('keeps ordinary music on the original audio path',async()=>{
  vi.stubEnv('TS_VIDEO_ENABLED','1');const c=context();expect(await proto.resolveAndPlay.call(c,{...song,platform:'netease'})).toBe(true);
  expect(c.startVideo).not.toHaveBeenCalled();expect(c.player.play).toHaveBeenCalled();
 });
 it('pause and resume control the current video without starting background audio',()=>{
  const c=context();c.videoSession={active:true,pause:vi.fn()};proto.cmdPause.call(c);proto.cmdResume.call(c);
  expect(c.videoSession.pause.mock.calls).toEqual([[true],[false]]);expect(c.player.resume).not.toHaveBeenCalled();
 });
 it('resume from idle restarts a queued Bilibili video',async()=>{
  vi.stubEnv('TS_VIDEO_ENABLED','1');const c=context();c.resolveAndPlay=vi.fn(async()=>true);
  expect(await proto.cmdResume.call(c)).toBe('Video resumed');expect(c.resolveAndPlay).toHaveBeenCalledWith(song);expect(c.player.resume).not.toHaveBeenCalled();
 });
 it('appending a queue does not interrupt active video even while the audio player is idle',async()=>{
  const c=context();c.videoSession={active:true};c.player.getState=()=> 'idle';c.withRequester=(s:any)=>s;
  c.queue={size:()=>1,add:vi.fn(),playAt:vi.fn()};c.resolveAndPlay=vi.fn();
  await proto.loadSavedQueue.call(c,[song],'append');expect(c.queue.add).toHaveBeenCalled();expect(c.resolveAndPlay).not.toHaveBeenCalled();
 });
 it('only the currently queued video advances on completion',async()=>{
  vi.stubEnv('TS_VIDEO_ENABLED','1');const c=context();let ended:()=>Promise<void>;
  c.videoSession={active:false,start:vi.fn(async(_q:any,_h:any,cb:any)=>{ended=cb;})};c.player.getState=()=> 'idle';c.cmdPause=vi.fn();c.playNext=vi.fn(async()=>true);
  await proto.startVideo.call(c,song.id,720,song);await ended!();expect(c.playNext).toHaveBeenCalledTimes(1);
  c.queue.current=()=>({...song});await ended!();expect(c.playNext).toHaveBeenCalledTimes(1);
 });
});
