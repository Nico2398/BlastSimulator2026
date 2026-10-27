// BlastSimulator2026 — Progression probe options: defaults, CLI parsing and matrix expansion (#1922)

import type { SandboxKitId } from '../../src/core/config/balance.js';
import { getAllBiomes } from '../../src/core/world/BiomeCatalog.js';

export type StrategyId = 'opening' | 'reinvest' | 'ladder' | 'stay_g1';

export interface ProbeRunConfig {
  seed: number;
  biome: string;
  kit: SandboxKitId;
  strategy: StrategyId;
  horizon: number;
  /** Explosive id for every shot; absent = the probe's reference krackle. */
  explosive?: string;
  /** Most haulers the ladder buys; absent = LADDER_MAX_HAULERS. An experiment knob for fleet-size studies. */
  maxHaulers?: number;
}

export interface ProbeOptions {
  seeds: number[];
  biomes: string[];
  kits: SandboxKitId[];
  strategies: StrategyId[];
  horizon: number;
  quick: boolean;
  jsonPath: string | null;
}

export const QUICK_HORIZON = 3000;

export const PROBE_DEFAULTS: ProbeOptions = {
  seeds: [42, 7, 13],
  biomes: ['desert_badlands', 'green_foothills'],
  kits: ['digger', 'full'],
  strategies: ['opening', 'reinvest'],
  horizon: 10000,
  quick: false,
  jsonPath: null,
};

const QUICK_SEED = 42;
const QUICK_BIOME = 'desert_badlands';
const QUICK_KIT: SandboxKitId = 'digger';

/**
 * The one site the long ladder runs are measured on unless sites are named. A ladder run to grade 3 costs half an hour
 * and its outcome turns on small policy changes (one shaft 1 m shorter turned grade 3 at t11836 into a bankruptcy on
 * this very site), so a spread of seeds measures the probe's luck more than the game; the per-site guarantees live in
 * the sandbox integration tests, every biome and five seeds each. Name `--seed`, `--biome` or `--kit` for a spread.
 */
export const LADDER_REFERENCE_SITE: { seed: number; biome: string; kit: SandboxKitId } = {
  seed: 42, biome: 'desert_badlands', kit: 'full',
};

const KIT_IDS: readonly SandboxKitId[] = ['digger', 'full'];
const STRATEGY_IDS: readonly StrategyId[] = ['opening', 'reinvest', 'ladder', 'stay_g1'];

function parseList(flag: string, raw: string | undefined): string[] {
  if (raw === undefined || raw.startsWith('--')) throw new Error(`${flag} needs a value`);
  const items = raw.split(',').map(x => x.trim());
  if (items.some(x => x === '')) throw new Error(`${flag}: empty entry in "${raw}"`);
  return items;
}

function parseInt10(flag: string, raw: string): number {
  if (!/^-?\d+$/.test(raw)) throw new Error(`${flag}: "${raw}" is not an integer`);
  return Number(raw);
}

function pickFromSet<T extends string>(flag: string, raw: string, valid: readonly T[]): T {
  if (!(valid as readonly string[]).includes(raw)) {
    throw new Error(`${flag}: unknown value "${raw}" (valid: ${valid.join(', ')})`);
  }
  return raw as T;
}

/** Parse CLI flags into options; throws an Error naming the offending value. */
export function parseArgs(argv: readonly string[]): ProbeOptions {
  const opts: ProbeOptions = { ...PROBE_DEFAULTS };
  let horizonGiven = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    switch (flag) {
      case '--seed':
        opts.seeds = parseList(flag, argv[++i]).map(x => parseInt10(flag, x));
        break;
      case '--biome':
        opts.biomes = parseList(flag, argv[++i]).map(x => pickFromSet(flag, x, getAllBiomes().map(b => b.id)));
        break;
      case '--kit':
        opts.kits = parseList(flag, argv[++i]).map(x => pickFromSet(flag, x, KIT_IDS));
        break;
      case '--strategy':
        opts.strategies = parseList(flag, argv[++i]).map(x => pickFromSet(flag, x, STRATEGY_IDS));
        break;
      case '--horizon': {
        const raw = argv[++i];
        if (raw === undefined) throw new Error('--horizon needs a value');
        const horizon = parseInt10(flag, raw);
        if (horizon <= 0) throw new Error(`--horizon: "${raw}" must be greater than 0`);
        opts.horizon = horizon;
        horizonGiven = true;
        break;
      }
      case '--quick':
        opts.quick = true;
        break;
      case '--json': {
        const path = argv[++i];
        if (path === undefined || path.startsWith('--')) throw new Error('--json needs a path');
        opts.jsonPath = path;
        break;
      }
      default:
        throw new Error(`unknown flag "${flag}"`);
    }
  }
  if (opts.quick) {
    // --quick narrows the matrix to one site; explicit selectors still win.
    if (!argv.includes('--seed')) opts.seeds = [QUICK_SEED];
    if (!argv.includes('--biome')) opts.biomes = [QUICK_BIOME];
    if (!argv.includes('--kit')) opts.kits = [QUICK_KIT];
    if (!horizonGiven) opts.horizon = QUICK_HORIZON;
  } else if (opts.strategies.every(id => id === 'ladder' || id === 'stay_g1')) {
    // A ladder-only run measures the reference site; explicit selectors still win.
    if (!argv.includes('--seed')) opts.seeds = [LADDER_REFERENCE_SITE.seed];
    if (!argv.includes('--biome')) opts.biomes = [LADDER_REFERENCE_SITE.biome];
    if (!argv.includes('--kit')) opts.kits = [LADDER_REFERENCE_SITE.kit];
  }
  return opts;
}

/** Order: biome, kit, seed, strategy. */
export function expandMatrix(opts: ProbeOptions): ProbeRunConfig[] {
  const runs: ProbeRunConfig[] = [];
  for (const biome of opts.biomes) {
    for (const kit of opts.kits) {
      for (const seed of opts.seeds) {
        for (const strategy of opts.strategies) {
          runs.push({ seed, biome, kit, strategy, horizon: opts.horizon });
        }
      }
    }
  }
  return runs;
}
