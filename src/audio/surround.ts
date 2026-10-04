export interface SurroundSettings {
  enabled: boolean;
  strength: number;
  room: number;
}

export function defaultSurround(): SurroundSettings {
  return { enabled: false, strength: 60, room: 25 };
}

export function parseSurround(value: unknown): SurroundSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("surround must be an object");
  }
  const { enabled, strength, room } = value as Record<string, unknown>;
  if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
  for (const [name, v] of Object.entries({ strength, room })) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) {
      throw new Error(`${name} must be between 0 and 100`);
    }
  }
  return { enabled, strength: strength as number, room: room as number };
}

/** Lightweight headphone virtual speakers: head-shadow crossfeed with 0.25 ms
 * interaural delay plus finite, decorrelated early room reflections. This is
 * stereo spatial simulation, not measured HRTF convolution or discrete 5.1.
 * All mixes are convex; no positive feedback, output delay, or extra clipping.
 * EQ and volume stay in floating point until the final PCM quantization. */
export class HeadphoneSurround {
  private settings = defaultSurround();
  private left = new Float64Array(2048);
  private right = new Float64Array(2048);
  private output = new Float64Array(2);
  private cursor = 0;
  private lowLeft = 0;
  private lowRight = 0;
  private mix = 0;
  private room = 0.25;
  private remaining = 0;
  private static readonly LOWPASS = 1 - Math.exp(-2 * Math.PI * 2200 / 48000);

  getSettings(): SurroundSettings { return { ...this.settings }; }
  isActive(): boolean { return this.mix !== 0 || (this.settings.enabled && this.settings.strength > 0); }

  setSettings(value: SurroundSettings): void {
    const next = parseSurround(value);
    if (JSON.stringify(next) === JSON.stringify(this.settings)) return;
    // Old audio must never reappear when a bypassed processor is enabled.
    if (!this.isActive()) this.clearHistory();
    this.settings = next;
    this.remaining = 960; // 20 ms sample-accurate ramp, also across short chunks.
  }

  private clearHistory(): void {
    this.left.fill(0); this.right.fill(0);
    this.cursor = 0; this.lowLeft = this.lowRight = 0;
  }

  reset(): void {
    this.clearHistory();
    this.mix = this.settings.enabled ? this.settings.strength / 100 : 0;
    this.room = this.settings.room / 100;
    this.remaining = 0;
  }

  /** Returned pair is reused; consume it before the next sample. */
  processStereo(left: number, right: number): Float64Array {
    const target = this.settings.enabled ? this.settings.strength / 100 : 0;
    if (this.remaining > 0) {
      this.mix += (target - this.mix) / this.remaining;
      this.room += (this.settings.room / 100 - this.room) / this.remaining;
      if (--this.remaining === 0) { this.mix = target; this.room = this.settings.room / 100; }
    }
    const at = this.cursor;
    this.left[at] = left; this.right[at] = right;
    const delayed = (at - 12 + 2048) & 2047;
    this.lowLeft += HeadphoneSurround.LOWPASS * (this.left[delayed] - this.lowLeft);
    this.lowRight += HeadphoneSurround.LOWPASS * (this.right[delayed] - this.lowRight);
    const directLeft = (left + 0.22 * this.lowRight) / 1.22;
    const directRight = (right + 0.22 * this.lowLeft) / 1.22;
    // Different left/right reflection times create space even for a mono source.
    const reflectionLeft = 0.35 * this.left[(at - 528 + 2048) & 2047]
      + 0.65 * this.right[(at - 912 + 2048) & 2047];
    const reflectionRight = 0.35 * this.right[(at - 624 + 2048) & 2047]
      + 0.65 * this.left[(at - 1104 + 2048) & 2047];
    const roomMix = this.room * 0.24;
    const wetLeft = directLeft * (1 - roomMix) + reflectionLeft * roomMix;
    const wetRight = directRight * (1 - roomMix) + reflectionRight * roomMix;
    this.output[0] = left * (1 - this.mix) + wetLeft * this.mix;
    this.output[1] = right * (1 - this.mix) + wetRight * this.mix;
    this.cursor = (at + 1) & 2047;
    return this.output;
  }
}
