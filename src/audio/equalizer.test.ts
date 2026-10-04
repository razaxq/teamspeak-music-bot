import { describe, it, expect } from "vitest";
import { defaultEqualizer, EQ_FREQUENCIES, parseEqualizer, PcmEqualizer } from "./equalizer.js";
import { AudioPlayer } from "./player.js";

function tone(frequency: number, amplitude = 2000, right = true): Buffer {
  const buffer = Buffer.alloc(48000 * 4);
  for (let i = 0; i < 48000; i++) {
    const value = Math.round(amplitude * Math.sin(2 * Math.PI * frequency * i / 48000));
    buffer.writeInt16LE(value, i * 4);
    buffer.writeInt16LE(right ? value : 0, i * 4 + 2);
  }
  return buffer;
}
function rms(buffer: Buffer, channel = 0): number {
  let sum = 0, count = 0;
  for (let i = 24000 * 4 + channel * 2; i < buffer.length; i += 4) {
    sum += buffer.readInt16LE(i) ** 2; count++;
  }
  return Math.sqrt(sum / count);
}
function configured(index: number, gain: number, preamp = 0): PcmEqualizer {
  const eq = new PcmEqualizer();
  const settings = defaultEqualizer();
  settings.enabled = true; settings.gains[index] = gain; settings.preamp = preamp;
  eq.setSettings(settings); eq.reset();
  return eq;
}

describe("PCM equalizer", () => {
  it("is bit exact when disabled or flat and does not mutate its input", () => {
    const input = tone(1000);
    const original = Buffer.from(input);
    expect(new PcmEqualizer().process(input)).toEqual(input);
    expect(configured(5, 0).process(input)).toEqual(input);
    configured(5, 12).process(input);
    expect(input).toEqual(original);
  });
  it.each(EQ_FREQUENCIES.flatMap((f, i) => [-12, 6, 12].map(g => [f, i, g])))
    ("measures %s Hz band %s at %s dB", (frequency, index, gain) => {
      const input = tone(frequency);
      const output = configured(index, gain).process(input);
      expect(20 * Math.log10(rms(output) / rms(input))).toBeCloseTo(gain, 1);
    });
  it("boosts the target band while leaving distant frequencies nearly unchanged", () => {
    const input = tone(8000);
    expect(20 * Math.log10(rms(configured(2, 12).process(input)) / rms(input))).toBeCloseTo(0, 1);
  });
  it("does not leak between stereo channels", () => {
    expect(rms(configured(5, 12).process(tone(1000, 2000, false)), 1)).toBe(0);
  });
  it("preserves filter history across arbitrary PCM chunk boundaries", () => {
    const input = tone(125);
    const one = configured(2, 12).process(input);
    const eq = configured(2, 12);
    const chunks: Buffer[] = [];
    for (let i = 0; i < input.length; i += 508) chunks.push(eq.process(input.subarray(i, i + 508)));
    expect(Buffer.concat(chunks)).toEqual(one);
  });
  it("applies volume after EQ without clipping intermediates", () => {
    const input = tone(1000, 20000);
    const out = configured(5, 12).process(input, 0.1);
    expect(20 * Math.log10(rms(out) / rms(input))).toBeCloseTo(-8, 1);
  });
  it("applies preamp and clamps overload instead of wrapping samples", () => {
    const input = tone(1000, 20000);
    expect(20 * Math.log10(rms(configured(5, 12, -12).process(input)) / rms(input))).toBeCloseTo(0, 1);
    const out = configured(5, 12).process(input);
    expect(out.readInt16LE(12012 * 4)).toBe(32767);
    expect(out.readInt16LE(12036 * 4)).toBe(-32768);
  });
  it("crossfades hot changes and bypass, and resets tails for a new track", () => {
    const eq = configured(5, 12);
    eq.process(tone(1000));
    eq.setSettings(defaultEqualizer());
    const input = tone(1000);
    const out = eq.process(input);
    expect(out.subarray(960 * 4)).toEqual(input.subarray(960 * 4));
    expect(eq.isActive()).toBe(false);
    eq.setSettings({ ...defaultEqualizer(), enabled: true, gains: Array(10).fill(12) });
    eq.process(input);
    eq.reset();
    expect(eq.process(Buffer.alloc(3840))).toEqual(Buffer.alloc(3840));
  });
  it("queues changes arriving during a transition without discontinuously replacing a bank", () => {
    const eq = new PcmEqualizer();
    eq.setSettings({ ...defaultEqualizer(), enabled: true, preamp: -12 });
    eq.process(tone(1000).subarray(0, 400));
    eq.setSettings(defaultEqualizer());
    const input = tone(1000);
    const out = eq.process(input);
    expect(out.subarray(1920 * 4)).toEqual(input.subarray(1920 * 4));
    expect(eq.isActive()).toBe(false);
  });
  it("rejects invalid input and protects stored arrays from caller mutation", () => {
    for (const patch of [{ enabled: 1 }, { preamp: -25 }, { preamp: Infinity },
      { gains: Array(10).fill(NaN) }, { gains: Array(10) }, { gains: [0] },
      { gains: Array(10).fill(13) }, { gains: Array(10).fill('1') }]) {
      expect(() => parseEqualizer({ ...defaultEqualizer(), ...patch })).toThrow();
    }
    const eq = new PcmEqualizer();
    const settings = defaultEqualizer();
    eq.setSettings(settings); settings.gains[0] = 12;
    eq.getSettings().gains[1] = 12;
    expect(eq.getSettings()).toEqual(defaultEqualizer());
  });
  it("integrates EQ into the player's volume/ducking path and preserves it after stop", () => {
    const logger: any = { info() {}, warn() {}, error() {}, debug() {} };
    const player = new AudioPlayer(logger);
    player.setVolume(100);
    player.setDuckingGain(0.5);
    const settings = { ...defaultEqualizer(), enabled: true, gains: [0, 0, 0, 0, 0, 6, 0, 0, 0, 0] };
    player.setEqualizer(settings);
    const input = tone(1000);
    const output = (player as any).applyVolume(input);
    expect(20 * Math.log10(rms(output) / rms(input))).toBeCloseTo(6 + 20 * Math.log10(0.5), 1);
    player.stop();
    expect(player.getEqualizer()).toEqual(settings);
    expect((player as any).applyVolume(Buffer.alloc(3840))).toEqual(Buffer.alloc(3840));
  });
});
