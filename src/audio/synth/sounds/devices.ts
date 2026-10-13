// BlastSimulator2026 — Worksite devices
// The electronic sounds of the site: the radio's squelch and beeps, the office
// phone's ringer, the alarm buzzer, a truck's backup alarm and a survey
// instrument. Each is a few tones and hiss bursts (DEVICE_SOUNDS) heard through
// a small, slightly overdriven loudspeaker, which is what makes a square wave
// sound like a device rather than a game.

import { DEVICE_SOUNDS, type DeviceSoundConfig } from '../../../core/config/audio/synth.js';
import { finishRender } from '../finish.js';
import { Biquad } from '../filters.js';
import { saturate } from '../mix.js';
import { whiteNoise } from '../noise.js';
import { squareAt } from '../oscillators.js';
import { rngFor } from '../seed.js';
import type { SynthRecipe } from '../types.js';

type DeviceSoundId = keyof typeof DEVICE_SOUNDS;

/** Raised-cosine gate: 0 outside [start, start + dur], ramping over `edge` at both ends. */
function gate(t: number, start: number, dur: number, edge: number): number {
  const local = t - start;
  if (local <= 0 || local >= dur) return 0;
  const ramp = Math.min(local, dur - local);
  return ramp >= edge ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * ramp) / edge);
}

/** The pitch a tone sounds at `t`: a trilling tone flips to `altHz` every other half-period of `trillHz`. */
function pitchAt(tone: DeviceSoundConfig['tones'][number], t: number): number {
  if (tone.altHz === undefined || tone.trillHz === undefined) return tone.hz;
  return Math.floor((t - tone.atSec) * tone.trillHz * 2) % 2 === 1 ? tone.altHz : tone.hz;
}

function render(id: DeviceSoundId): Float32Array {
  const c: DeviceSoundConfig = DEVICE_SOUNDS[id];
  const sr = c.sampleRate;
  const n = Math.round(c.durationSec * sr);
  const noise = whiteNoise(rngFor(id, 0), n);
  const highpass = new Biquad('highpass', sr, c.speaker.highpassHz);
  const lowpass = new Biquad('lowpass', sr, c.speaker.lowpassHz);
  // One running phase per tone, so a trill changes pitch without a phase jump.
  const phases = c.tones.map(() => 0);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let x = 0;
    c.tones.forEach((tone, k) => {
      const level = gate(t, tone.atSec, tone.durSec, c.edgeSec);
      if (level === 0) return;
      const hz = pitchAt(tone, t);
      x += tone.gain * level * squareAt(phases[k] as number, hz, sr, c.harmonics);
      phases[k] = (phases[k] as number) + hz / sr;
    });
    for (const hiss of c.hiss) {
      const level = gate(t, hiss.atSec, hiss.durSec, c.edgeSec);
      if (level === 0) continue;
      const decay = hiss.tauSec === undefined ? 1 : Math.exp(-(t - hiss.atSec) / hiss.tauSec);
      x += hiss.gain * level * decay * (noise[i] as number);
    }
    out[i] = saturate(lowpass.tick(highpass.tick(x)), c.speaker.drive);
  }
  return out;
}

function deviceRecipe(id: DeviceSoundId): SynthRecipe {
  return {
    variants: 1,
    loop: false,
    render: () => finishRender([render(id)], DEVICE_SOUNDS[id].sampleRate, 'oneShot'),
  };
}

export const RADIO_ORDER = deviceRecipe('radio_order');
export const RADIO_INFO = deviceRecipe('radio_info');
export const RADIO_GOOD = deviceRecipe('radio_good');
export const RADIO_WARN = deviceRecipe('radio_warn');
export const RADIO_END = deviceRecipe('radio_end');
export const PHONE_RING = deviceRecipe('phone_ring');
export const ALARM_BUZZER = deviceRecipe('alarm_buzzer');
export const REVERSE_BEEPER = deviceRecipe('reverse_beeper');
export const INSTRUMENT_BEEP = deviceRecipe('instrument_beep');
