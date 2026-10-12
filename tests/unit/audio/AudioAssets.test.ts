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
import { parseMp3 } from '../../helpers/mp3Info.js';

const ROOT = join(import.meta.dirname, '../../..');
const SFX_DIR = join(ROOT, 'public/audio/sfx');
const CREDITS = readFileSync(join(ROOT, 'public/audio/CREDITS.md'), 'utf8');

// About 1.5 times what ships (largest file 38 KB, 617 KB in total), so growth of the set is a decision and not an accident.
const MAX_FILE_BYTES = 60 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
/** Encoder delay plus padding that the frame count includes but playback trims. */
const FRAME_SLACK_S = 0.1;
const MIN_DURATION_S = 0.03;
const ALLOWED_LICENCES = new Set(['CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0']);

interface Recipe {
  readonly kinds: Record<string, { readonly max_s: number }>;
  readonly mirrors: Record<string, { readonly commit: string }>;
  readonly packs: Record<string, {
    readonly license: string;
    readonly title: string;
    readonly author: string;
    readonly commit?: string;
    readonly mirror?: string;
    readonly official_zip?: string;
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

  it('pins the OpenSFX commit and the mirror commit it relies on, and names the uisfx copyright holder', () => {
    expect(RECIPE.packs['opensfx']!.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(CREDITS).toContain(RECIPE.packs['opensfx']!.commit!);
    expect(CREDITS).toContain(RECIPE.mirrors['open-game-sfx-index']!.commit);
    expect(RECIPE.packs['uisfx']!.author).toContain('Yuki Capital');
    expect(CREDITS).toContain('Yuki Capital (uisfx, github.com/romainsimon/uisfx)');
    expect(CREDITS).not.toContain('Romain Simon');
  });

  it('documents the official download of every mirror pack a sound uses, for the upstream verification', () => {
    const used = new Set(Object.values(RECIPE.sounds).flatMap(sound => sound.layers.map(layer => layer.pack)));
    const mirrored = Object.entries(RECIPE.packs).filter(([, pack]) => pack.mirror !== undefined);
    expect(mirrored.length).toBeGreaterThan(0);
    for (const [name, pack] of mirrored) {
      expect(RECIPE.mirrors[pack.mirror!], `${name}: unknown mirror ${pack.mirror}`).toBeDefined();
      expect(pack.official_zip, `${name}: no official download`).toMatch(/^https:\/\/.+\.zip$/);
      if (used.has(name)) expect(CREDITS, `${name}: official download missing from CREDITS.md`).toContain(pack.official_zip!);
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
