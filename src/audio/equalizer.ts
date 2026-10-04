export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

export interface EqualizerSettings {
  enabled: boolean;
  preamp: number;
  gains: number[];
}

export function defaultEqualizer(): EqualizerSettings {
  return { enabled: false, preamp: 0, gains: EQ_FREQUENCIES.map(() => 0) };
}

/** The API, persistence layer and DSP share the same strict boundary. */
export function parseEqualizer(value: unknown): EqualizerSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("equalizer must be an object");
  }
  const { enabled, preamp, gains } = value as Record<string, unknown>;
  if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
  if (typeof preamp !== "number" || !Number.isFinite(preamp) || preamp < -24 || preamp > 0) {
    throw new Error("preamp must be between -24 and 0 dB");
  }
  if (!Array.isArray(gains) || gains.length !== EQ_FREQUENCIES.length ||
      Array.from(gains).some(g => typeof g !== "number" || !Number.isFinite(g) || g < -12 || g > 12)) {
    throw new Error("gains must contain 10 finite numbers between -12 and 12 dB");
  }
  return { enabled, preamp, gains: [...gains] };
}

interface Filter {
  b0: number; b1: number; b2: number; a1: number; a2: number;
  // Direct form I: independent input/output history for each stereo channel.
  history: number[][];
}
interface Bank { filters: Filter[]; gain: number }

function makeBank(settings: EqualizerSettings): Bank {
  return {
    gain: settings.enabled ? 10 ** (settings.preamp / 20) : 1,
    filters: settings.enabled ? EQ_FREQUENCIES.flatMap((frequency, i) => {
      if (settings.gains[i] === 0) return [];
      // RBJ peaking EQ, Q = sqrt(2) (approximately one octave).
      // https://www.w3.org/TR/audio-eq-cookbook/#formulae
      const a = 10 ** (settings.gains[i] / 40);
      const omega = 2 * Math.PI * frequency / 48000;
      const alpha = Math.sin(omega) / (2 * Math.SQRT2);
      const a0 = 1 + alpha / a;
      return [{
        b0: (1 + alpha * a) / a0, b1: -2 * Math.cos(omega) / a0,
        b2: (1 - alpha * a) / a0, a1: -2 * Math.cos(omega) / a0,
        a2: (1 - alpha / a) / a0, history: [[0, 0, 0, 0], [0, 0, 0, 0]],
      }];
    }) : [],
  };
}

function filterSample(bank: Bank, input: number, channel: number): number {
  let value = input * bank.gain;
  for (const f of bank.filters) {
    const h = f.history[channel];
    const output = f.b0 * value + f.b1 * h[0] + f.b2 * h[1] - f.a1 * h[2] - f.a2 * h[3];
    h[1] = h[0]; h[0] = value; h[3] = h[2]; h[2] = output;
    value = output;
  }
  return value;
}

/** Server-side 48 kHz stereo EQ, shared by URL and external PCM playback. */
export class PcmEqualizer {
  private settings = defaultEqualizer();
  private bank = makeBank(this.settings);
  private pending: Bank | null = null;
  private previous: Bank | null = null;
  private transition = 0;
  private static readonly TRANSITION_SAMPLES = 960; // 20 ms, without restarting playback

  getSettings(): EqualizerSettings { return parseEqualizer(this.settings); }

  setSettings(value: EqualizerSettings): void {
    const settings = parseEqualizer(value);
    if (JSON.stringify(settings) === JSON.stringify(this.settings)) return;
    this.settings = settings;
    // Coalesce updates until the next PCM frame. Finish any current crossfade
    // before starting another, including callers that supply sub-frame chunks.
    this.pending = makeBank(settings);
  }

  reset(): void {
    this.bank = makeBank(this.settings);
    this.pending = this.previous = null;
    this.transition = 0;
  }

  isActive(): boolean {
    return !!(this.pending || this.previous || this.bank.filters.length || this.bank.gain !== 1);
  }

  /** Volume/ducking are applied in floating point after EQ, before the ONLY
   * s16 quantization/clamp. A boosted signal can thus be attenuated safely. */
  process(pcm: Buffer, startGain = 1, endGain = startGain): Buffer {
    if (pcm.length % 4 !== 0) throw new Error("PCM must contain complete stereo s16le samples");
    const out = Buffer.allocUnsafe(pcm.length);
    const samples = pcm.length / 4;
    for (let i = 0; i < samples; i++) {
      if (this.pending && !this.previous) {
        this.previous = this.bank;
        this.bank = this.pending;
        this.pending = null;
        this.transition = 0;
      }
      const mix = Math.min(1, this.transition / (PcmEqualizer.TRANSITION_SAMPLES - 1));
      const gain = startGain + (endGain - startGain) * (samples > 1 ? i / (samples - 1) : 0);
      for (let channel = 0; channel < 2; channel++) {
        const offset = i * 4 + channel * 2;
        const input = pcm.readInt16LE(offset);
        let value = filterSample(this.bank, input, channel);
        if (this.previous) value = filterSample(this.previous, input, channel) * (1 - mix) + value * mix;
        out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * gain))), offset);
      }
      if (this.previous && ++this.transition >= PcmEqualizer.TRANSITION_SAMPLES) this.previous = null;
    }
    return out;
  }
}
