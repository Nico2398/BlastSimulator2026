// BlastSimulator2026 — sampled sound assets stay consistent with the catalog
//
// The sound catalog names every sampled one-shot; the files live in
// public/audio/sfx and are produced from assets/audio/recipe.json. This test
// reads those files from disk (no audio decoding: MPEG headers are parsed by
// hand) and proves the paper trail: nothing referenced is missing, nothing
// unreferenced is shipped, every file is credited with an acceptable licence,
// and sizes and durations stay inside the budget.

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { SOUND_CATALOG } from '../../../src/audio/SoundCatalog.js';

const ROOT = join(import.meta.dirname, '../../..');
const SFX_DIR = join(ROOT, 'public/audio/sfx');
const CREDITS = readFileSync(join(ROOT, 'public/audio/CREDITS.md'), 'utf8');

const MAX_FILE_BYTES = 90 * 1024;
const MAX_TOTAL_BYTES = 3.5 * 1024 * 1024;
/** Encoder delay plus padding that the frame count includes but playback trims. */
const FRAME_SLACK_S = 0.1;
const MIN_DURATION_S = 0.03;
const ALLOWED_LICENCES = new Set(['CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0']);

interface Recipe {
  readonly kinds: Record<string, { readonly max_s: number }>;
  readonly packs: Record<string, {
    readonly license: string;
    readonly title: string;
    readonly files?: Record<string, { readonly license?: string; readonly psfo?: string }>;
  }>;
  readonly sounds: Record<string, {
    readonly kind: string;
    readonly max_s?: number;
    readonly layers: readonly { readonly pack: string; readonly file: string }[];
  }>;
}

const RECIPE = JSON.parse(readFileSync(join(ROOT, 'assets/audio/recipe.json'), 'utf8')) as Recipe;

function catalogSampleNames(): Set<string> {
  const names = new Set<string>();
  for (const def of Object.values(SOUND_CATALOG)) {
    if (def.source.kind === 'sample') for (const file of def.source.files) names.add(file);
  }
  return names;
}

const SHIPPED = readdirSync(SFX_DIR).sort();

const BITRATES_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES = [[11025, 12000, 8000], [0, 0, 0], [22050, 24000, 16000], [44100, 48000, 32000]];

interface Mp3Info {
  readonly sampleRate: number;
  readonly channels: number;
  readonly durationS: number;
  readonly hasXing: boolean;
}

/** Parse the first MPEG audio frame (after an optional ID3v2 tag) and estimate the duration. */
function parseMp3(buf: Buffer): Mp3Info | null {
  let pos = 0;
  if (buf.toString('latin1', 0, 3) === 'ID3') {
    pos = 10 + ((buf[6]! << 21) | (buf[7]! << 14) | (buf[8]! << 7) | buf[9]!);
  }
  const b0 = buf[pos], b1 = buf[pos + 1], b2 = buf[pos + 2], b3 = buf[pos + 3];
  if (b0 !== 0xff || b1 === undefined || b2 === undefined || b3 === undefined || (b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
  const layer = (b1 >> 1) & 3; // 1 = Layer III
  if (version === 1 || layer !== 1) return null;
  const mpeg1 = version === 3;
  const bitrate = (mpeg1 ? BITRATES_MPEG1_L3 : BITRATES_MPEG2_L3)[b2 >> 4]! * 1000;
  const sampleRate = SAMPLE_RATES[version]![(b2 >> 2) & 3]!;
  if (bitrate === 0 || sampleRate === 0) return null;
  const channels = (b3 >> 6) === 3 ? 1 : 2;
  const samplesPerFrame = mpeg1 ? 1152 : 576;
  const crcBytes = (b1 & 1) === 0 ? 2 : 0;
  const sideInfo = mpeg1 ? (channels === 1 ? 17 : 32) : (channels === 1 ? 9 : 17);
  const tagAt = pos + 4 + crcBytes + sideInfo;
  const tag = buf.toString('latin1', tagAt, tagAt + 4);
  if ((tag === 'Xing' || tag === 'Info') && (buf.readUInt32BE(tagAt + 4) & 1) !== 0) {
    const frames = buf.readUInt32BE(tagAt + 8);
    return { sampleRate, channels, durationS: (frames * samplesPerFrame) / sampleRate, hasXing: true };
  }
  return { sampleRate, channels, durationS: ((buf.length - pos) * 8) / bitrate, hasXing: false };
}

describe('sampled sound assets', () => {
  it('ships every sample the catalog names and nothing else', () => {
    const referenced = [...catalogSampleNames()].map((n) => `${n}.mp3`).sort();
    expect(referenced.length).toBeGreaterThan(0);
    expect(SHIPPED).toEqual(referenced);
  });

  it('lists exactly the shipped files in the build recipe', () => {
    expect(Object.keys(RECIPE.sounds).map((n) => `${n}.mp3`).sort()).toEqual(SHIPPED);
  });

  it('credits every file and every source file', () => {
    for (const file of SHIPPED) expect(CREDITS, `${file} missing from CREDITS.md`).toContain(`\`${file}\``);
    for (const [name, sound] of Object.entries(RECIPE.sounds)) {
      for (const layer of sound.layers) {
        expect(CREDITS, `${name}: source ${layer.file} missing from CREDITS.md`).toContain(`\`${layer.file}\``);
      }
    }
  });

  it('uses only CC0 or Creative Commons Attribution sources, and prints every required attribution', () => {
    for (const [name, sound] of Object.entries(RECIPE.sounds)) {
      for (const layer of sound.layers) {
        const pack = RECIPE.packs[layer.pack];
        expect(pack, `${name}: unknown pack ${layer.pack}`).toBeDefined();
        const per = pack!.files?.[layer.file];
        const licence = per?.license ?? pack!.license;
        expect(ALLOWED_LICENCES.has(licence), `${name}: ${layer.file} is ${licence}`).toBe(true);
        if (licence.startsWith('CC-BY')) {
          expect(per?.psfo, `${name}: ${layer.file} lacks its attribution line`).toBeTruthy();
          expect(CREDITS, `${layer.file} attribution not printed`).toContain(per!.psfo!);
        }
      }
    }
  });

  it('has a valid mono MPEG Layer III stream in every file', () => {
    for (const file of SHIPPED) {
      const info = parseMp3(readFileSync(join(SFX_DIR, file)));
      expect(info, `${file}: no MPEG Layer III frame sync`).not.toBeNull();
      expect(info!.channels, `${file} channels`).toBe(1);
      expect(info!.sampleRate, `${file} sample rate`).toBe(44100);
      expect(info!.hasXing, `${file}: VBR header missing, duration is a guess`).toBe(true);
    }
  });

  it('keeps every duration inside the cap for its kind', () => {
    for (const file of SHIPPED) {
      const name = file.replace(/\.mp3$/, '');
      const sound = RECIPE.sounds[name]!;
      const cap = Math.min(sound.max_s ?? Infinity, RECIPE.kinds[sound.kind]!.max_s);
      const info = parseMp3(readFileSync(join(SFX_DIR, file)))!;
      expect(info.durationS, `${file} too short`).toBeGreaterThan(MIN_DURATION_S);
      expect(info.durationS, `${file} longer than ${cap} s`).toBeLessThanOrEqual(cap + FRAME_SLACK_S);
    }
  });

  it('stays inside the size budget', () => {
    let total = 0;
    for (const file of SHIPPED) {
      const bytes = readFileSync(join(SFX_DIR, file)).length;
      expect(bytes, `${file} is ${bytes} bytes`).toBeLessThanOrEqual(MAX_FILE_BYTES);
      total += bytes;
    }
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });

  it('never ships two byte-identical files', () => {
    const seen = new Map<string, string>();
    for (const file of SHIPPED) {
      const digest = createHash('sha256').update(readFileSync(join(SFX_DIR, file))).digest('hex');
      expect(seen.get(digest), `${file} duplicates ${seen.get(digest)}`).toBeUndefined();
      seen.set(digest, file);
    }
  });
});
