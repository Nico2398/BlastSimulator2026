// BlastSimulator2026 — Catalog view
// The sound catalog arranged for the lab page: per bus, its one-shots and its
// looped beds, with a one-line description of where each sound comes from.

import type { WorldPoint } from '../AudioPlayer.js';
import { SOUND_CATALOG, type LoopId, type OneShotId, type SoundBus, type SoundDefinition } from '../SoundCatalog.js';

export interface OneShotEntry {
  readonly id: OneShotId;
  readonly def: SoundDefinition;
}

export interface LoopEntry {
  readonly id: LoopId;
  readonly def: SoundDefinition;
}

interface BusSection {
  readonly bus: SoundBus;
  readonly oneShots: readonly OneShotEntry[];
  readonly loops: readonly LoopEntry[];
}

const LAB_BUSES: readonly SoundBus[] = ['ui', 'effects', 'ambient'];

/** Every catalog entry, in catalog order, under its bus. */
export function groupCatalogByBus(): BusSection[] {
  const entries = Object.entries(SOUND_CATALOG) as Array<[keyof typeof SOUND_CATALOG, SoundDefinition]>;
  return LAB_BUSES.map((bus) => {
    const onBus = entries.filter(([, def]) => def.bus === bus);
    return {
      bus,
      oneShots: onBus.filter(([, def]) => !def.loop).map(([id, def]) => ({ id: id as OneShotId, def })),
      loops: onBus.filter(([, def]) => def.loop).map(([id, def]) => ({ id: id as LoopId, def })),
    };
  });
}

/** "2 samples", "sample", "synth blast_sub", plus the catalog trim and priority. */
export function describeSound(def: SoundDefinition): string {
  const source = def.source.kind === 'sample'
    ? (def.source.files.length > 1 ? `${def.source.files.length} samples` : 'sample')
    : `synth ${def.source.recipe}`;
  const trim = `${def.gainDb >= 0 ? '+' : ''}${def.gainDb} dB`;
  return `${source} · ${trim} · priority ${def.priority}`;
}

/**
 * A point `distanceM` metres from the listener, `side` of the way round to its right:
 * -1 is hard left, 0 straight ahead (away from the camera), 1 hard right. The lab
 * listener's right-hand direction is +x and "ahead" is -z.
 */
export function sourcePosition(distanceM: number, side: number): WorldPoint {
  const angle = Math.max(-1, Math.min(1, side)) * (Math.PI / 2);
  return { x: distanceM * Math.sin(angle), z: -distanceM * Math.cos(angle) };
}
