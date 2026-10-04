import { describe, it, expect } from 'vitest';
import { defaultSurround, HeadphoneSurround, parseSurround } from './surround.js';
import { PcmEqualizer } from './equalizer.js';

const enabled = { enabled: true, strength: 100, room: 100 };
function ready(settings = enabled) { const p = new HeadphoneSurround(); p.setSettings(settings); p.reset(); return p; }
describe('headphone surround', () => {
  it.each([null, [], {}, { enabled: 1, strength: 60, room: 25 }, { ...enabled, strength: NaN },
    { ...enabled, strength: -1 }, { ...enabled, room: 101 }, { ...enabled, room: '25' }])('rejects invalid settings %j', value => {
    expect(() => parseSurround(value)).toThrow();
  });
  it('starts bypassed and returns settings by value', () => {
    const p = new HeadphoneSurround(); expect(p.isActive()).toBe(false);
    expect(p.getSettings()).toEqual(defaultSurround());
    p.getSettings().enabled = true; expect(p.isActive()).toBe(false);
    expect([...p.processStereo(1234, -5678)]).toEqual([1234, -5678]);
  });
  it('places contralateral sound after the direct sound and emits finite room reflections', () => {
    const p = ready(); const out = Array.from({length:8000}, (_, i) => [...p.processStereo(i === 0 ? 10000 : 0, 0)]);
    expect(out[0][0]).toBeGreaterThan(0); expect(out[0][1]).toBe(0);
    expect(out.slice(0,12).every(x => x[1] === 0)).toBe(true);
    expect(out[12][1]).toBeGreaterThan(0);
    expect(out[1104][1]).toBeGreaterThan(1000);
    expect(Math.max(...out.slice(3000).flat().map(Math.abs))).toBeLessThan(1e-8);
  });
  it('keeps maximum input bounded without a limiter or positive feedback', () => {
    const p = ready();
    for (let i=0;i<15000;i++) {
      const pair=p.processStereo(i%5 ? 32767 : -32768, i%7 ? -32768 : 32767);
      for(const value of pair) { expect(Number.isFinite(value)).toBe(true); expect(Math.abs(value)).toBeLessThanOrEqual(32768); }
    }
  });
  it('switches smoothly and becomes bit-exact after bypass, clearing history on re-enable', () => {
    const p=ready(); for(let i=0;i<2400;i++)p.processStereo(10000,0);
    let previous=p.processStereo(10000,0)[0]; p.setSettings({...enabled,enabled:false});
    for(let i=0;i<960;i++){const current=p.processStereo(10000,0)[0];expect(Math.abs(current-previous)).toBeLessThan(10);previous=current;}
    expect(p.isActive()).toBe(false);expect([...p.processStereo(-123,456)]).toEqual([-123,456]);
    p.setSettings(enabled);
    for(let i=0;i<2000;i++)expect([...p.processStereo(0,0)]).toEqual([0,0]);
  });
  it('reset removes old-song reflections but keeps settings', () => {
    const p=ready();p.processStereo(10000,-10000);p.reset();expect(p.getSettings()).toEqual(enabled);
    for(let i=0;i<2400;i++)expect([...p.processStereo(0,0)]).toEqual([0,0]);
  });
  it('processes identically across PCM chunk boundaries and respects final volume/mute', () => {
    const pcm=Buffer.alloc(3840*5);for(let i=0;i<pcm.length;i+=2)pcm.writeInt16LE(Math.round(8000*Math.sin(i/33)),i);
    const a=new PcmEqualizer(),b=new PcmEqualizer(),sa=ready(),sb=ready();
    const full=a.process(pcm,0.2,0.2,sa);
    const chunks=Buffer.concat([b.process(pcm.subarray(0,400),0.2,0.2,sb),b.process(pcm.subarray(400),0.2,0.2,sb)]);
    expect(chunks.equals(full)).toBe(true);
    expect(a.process(pcm,0,0,sa).every(x=>x===0)).toBe(true);
  });
});
