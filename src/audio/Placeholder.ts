// BlastSimulator2026 — Placeholder Sounds (11.2)
// Programmatically synthesized sounds using Web Audio API oscillators.
// All sounds are pure synthesis — no external audio files needed.
// Replace individual buffers with real audio files later without changing the API.

// ── Types ──

export type SoundId =
  | 'beep'       // UI click feedback
  | 'boom'       // Explosion (per detonating hole)
  | 'rumble'     // Post-blast ground shake
  | 'chime'      // Event notification
  | 'ambient'    // General mine ambient hum
  | 'engine'     // Vehicle engine loop
  | 'drill'      // Drill whirring
  | 'rain'       // Rain patter loop
  | 'thud';      // Fragment impact

// ── Buffer synthesis ──

const SAMPLE_RATE = 44100;

function createBuffer(ctx: AudioContext, durationS: number, sampleRate = SAMPLE_RATE): AudioBuffer {
  return ctx.createBuffer(1, Math.floor(sampleRate * durationS), sampleRate);
}

function fill(buf: AudioBuffer, fn: (i: number, rate: number) => number): void {
  const data = buf.getChannelData(0);
  const rate = buf.sampleRate;
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.max(-1, Math.min(1, fn(i, rate)));
  }
}

/** Short UI beep — 880 Hz sine, 80ms, fast fade */
function synthesizeBeep(ctx: AudioContext): AudioBuffer {
  const buf = createBuffer(ctx, 0.08);
  fill(buf, (i, r) => {
    const t = i / r;
    const env = Math.exp(-t * 40);
    return env * Math.sin(2 * Math.PI * 880 * t) * 0.6;
  });
  return buf;
}

/** Explosion boom — low sine chirp down, white noise burst, 1.5s */
function synthesizeBoom(ctx: AudioContext): AudioBuffer {
  const dur = 1.5;
  const buf = createBuffer(ctx, dur);
  fill(buf, (i, r) => {
    const t = i / r;
    const env = Math.exp(-t * 3);
    const freq = 80 * Math.exp(-t * 4);   // chirp from 80 Hz downward
    const sine = Math.sin(2 * Math.PI * freq * t);
    const noise = (Math.random() * 2 - 1);
    return env * (sine * 0.7 + noise * 0.3) * 0.9;
  });
  return buf;
}

/** Post-blast rumble — very low frequency tremor, 2s */
function synthesizeRumble(ctx: AudioContext): AudioBuffer {
  const dur = 2.0;
  const buf = createBuffer(ctx, dur);
  fill(buf, (i, r) => {
    const t = i / r;
    const env = Math.exp(-t * 1.5) * Math.sin(Math.PI * t / dur);
    const lfo = Math.sin(2 * Math.PI * 8 * t);       // 8 Hz shake
    const carrier = Math.sin(2 * Math.PI * 30 * t);  // 30 Hz rumble
    return env * (carrier + lfo * 0.4) * 0.6;
  });
  return buf;
}

/** Event chime — two-tone ascending bell, 0.6s */
function synthesizeChime(ctx: AudioContext): AudioBuffer {
  const dur = 0.6;
  const buf = createBuffer(ctx, dur);
  fill(buf, (i, r) => {
    const t = i / r;
    const env = Math.exp(-t * 6);
    // Two harmonic partials: 880 Hz + 1320 Hz
    return env * (Math.sin(2 * Math.PI * 880 * t) * 0.5 + Math.sin(2 * Math.PI * 1320 * t) * 0.3);
  });
  return buf;
}

/** Ambient mine hum — 60 Hz drone with harmonics, 4s loop */
function synthesizeAmbient(ctx: AudioContext): AudioBuffer {
  const dur = 4.0;
  const buf = createBuffer(ctx, dur);
  fill(buf, (i, r) => {
    const t = i / r;
    // Gentle fade-in/out for seamless loop
    const env = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / dur);
    return env * (
      Math.sin(2 * Math.PI * 60 * t) * 0.4 +
      Math.sin(2 * Math.PI * 120 * t) * 0.2 +
      Math.sin(2 * Math.PI * 180 * t) * 0.1
    ) * 0.3;
  });
  return buf;
}

/** Vehicle engine — rough periodic rumble, 1s loop */
function synthesizeEngine(ctx: AudioContext): AudioBuffer {
  const dur = 1.0;
  const buf = createBuffer(ctx, dur);
  fill(buf, (i, r) => {
    const t = i / r;
    const env = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / dur); // loop envelope
    // 110 Hz sawtooth-like engine sound
    const saw = (t * 110 % 1) * 2 - 1;
    const noise = (Math.random() * 2 - 1) * 0.15;
    return env * (saw * 0.5 + noise) * 0.4;
  });
  return buf;
}

/** Drill whirr — rising then steady high-pitched oscillation, 1.5s loop */
function synthesizeDrill(ctx: AudioContext): AudioBuffer {
  const dur = 1.5;
  const buf = createBuffer(ctx, dur);
  fill(buf, (i, r) => {
    const t = i / r;
    const env = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / dur);
    const freq = 400 + 200 * Math.sin(2 * Math.PI * 3 * t); // wobble 400–600 Hz
    return env * Math.sin(2 * Math.PI * freq * t) * 0.35;
  });
  return buf;
}

/** Rain patter — filtered noise bursts, 2s loop */
function synthesizeRain(ctx: AudioContext): AudioBuffer {
  const dur = 2.0;
  const buf = createBuffer(ctx, dur);
  fill(buf, (i, r) => {
    const t = i / r;
    const env = 0.5 - 0.5 * Math.cos(2 * Math.PI * t / dur);
    // Simulated rain drops via noise with slight high-pass character
    const noise = (Math.random() * 2 - 1);
    return env * noise * 0.25;
  });
  return buf;
}

/** Fragment thud — short low impact, 0.2s */
function synthesizeThud(ctx: AudioContext): AudioBuffer {
  const dur = 0.2;
  const buf = createBuffer(ctx, dur);
  fill(buf, (i, r) => {
    const t = i / r;
    const env = Math.exp(-t * 20);
    return env * Math.sin(2 * Math.PI * 120 * t) * 0.7;
  });
  return buf;
}

// ── Sound library ──

const SYNTH_FNS: Record<SoundId, (ctx: AudioContext) => AudioBuffer> = {
  beep: synthesizeBeep,
  boom: synthesizeBoom,
  rumble: synthesizeRumble,
  chime: synthesizeChime,
  ambient: synthesizeAmbient,
  engine: synthesizeEngine,
  drill: synthesizeDrill,
  rain: synthesizeRain,
  thud: synthesizeThud,
};

/** Lazy-loaded sound buffer cache. Buffers are created on first use. */
export class SoundLibrary {
  private readonly cache = new Map<SoundId, AudioBuffer>();
  private readonly audioCtx: AudioContext;

  constructor(audioCtx: AudioContext) {
    this.audioCtx = audioCtx;
  }

  /** Get (and cache) a synthesized buffer for the given sound ID. */
  get(id: SoundId): AudioBuffer {
    let buf = this.cache.get(id);
    if (!buf) {
      buf = SYNTH_FNS[id](this.audioCtx);
      this.cache.set(id, buf);
    }
    return buf;
  }

  /** Pre-warm all sounds (optional — avoids first-play latency). */
  preload(): void {
    for (const id of Object.keys(SYNTH_FNS) as SoundId[]) {
      this.get(id);
    }
  }
}
