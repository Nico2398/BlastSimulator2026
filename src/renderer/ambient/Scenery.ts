// BlastSimulator2026 — Scenery: rocks around the site and the houses of
// every village, drawn instanced from the prop models. Villages had been
// flattened pads with smoke rising from bare ground — the houses are the
// same `House` records ChimneySmoke reads, so a chimney puff now starts on a
// roof. Rocks are a seeded scatter in a band outside the playable rect,
// coloured per biome. Static once built.

import * as THREE from 'three';
import { cellRand, subSeed } from '../../core/math/Hash.js';
import type { Village } from '../../core/world/Structures.js';
import type { Rect } from '../../core/world/WorldGen.js';
import type { ModelLibrary } from '../models/ModelLibrary.js';
import { InstancedProp } from '../models/InstancedProp.js';
import { houseModelId, rockModelId, HOUSE_VARIANTS, ROCK_VARIANTS } from '../models/ModelIds.js';

/** Rock colour per biome — the props' `TintRock` material; biomes not listed get plain grey. */
export const ROCK_COLOR_BY_BIOME: Readonly<Record<string, number>> = {
  desert_badlands: 0xc9a97a,
  red_canyon: 0xb8623f,
  alpine_granite: 0x9a9ea6,
  green_foothills: 0x8c8a80,
  tropical_karst: 0x8f9a93,
  volcanic_flats: 0x3c3a3a,
};
const ROCK_COLOR_DEFAULT = 0x8e8a84;

/** Rock band: from just outside the playable rect out to this far. */
const ROCK_BAND_INNER = 6;
const ROCK_BAND_OUTER = 160;
const ROCK_CELL = 10;
const ROCK_DENSITY = 0.1;
const ROCK_SCALE_MIN = 0.5;
const ROCK_SCALE_SPREAD = 1.0;
/** Rocks sink a little so an uneven ground never leaves them floating. */
const ROCK_SINK = 0.12;

/** Villages beyond this distance from the landscape centre are not drawn. */
const HOUSE_DRAW_DISTANCE = 900;

export class Scenery {
  private readonly scene: THREE.Scene;
  private readonly props: InstancedProp[] = [];
  private rockCount = 0;
  private houseCount = 0;
  /** Prop ids this build wanted and the library did not have — a rebuild once they load draws them. */
  readonly missingModelIds: string[] = [];

  constructor(
    scene: THREE.Scene,
    levelSeed: number,
    library: ModelLibrary,
    villages: readonly Village[],
    playableRect: Rect,
    centerX: number,
    centerZ: number,
    sampleGroundHeight: (x: number, z: number) => number,
    biomeId: string | undefined,
  ) {
    this.scene = scene;
    const dummy = new THREE.Object3D();

    // ---- Rocks ----
    const seed = subSeed(levelSeed, 'rocks');
    const rocks: Array<{ x: number; z: number; scale: number; yaw: number; variant: number }> = [];
    const minX = playableRect.minX - ROCK_BAND_OUTER;
    const minZ = playableRect.minZ - ROCK_BAND_OUTER;
    const cellsX = Math.ceil((playableRect.maxX + ROCK_BAND_OUTER - minX) / ROCK_CELL);
    const cellsZ = Math.ceil((playableRect.maxZ + ROCK_BAND_OUTER - minZ) / ROCK_CELL);
    for (let cz = 0; cz < cellsZ; cz++) {
      for (let cx = 0; cx < cellsX; cx++) {
        const x = minX + cx * ROCK_CELL + cellRand(seed, cx, cz, 1) * ROCK_CELL;
        const z = minZ + cz * ROCK_CELL + cellRand(seed, cx, cz, 2) * ROCK_CELL;
        const nearSite = x >= playableRect.minX - ROCK_BAND_INNER && x <= playableRect.maxX + ROCK_BAND_INNER
          && z >= playableRect.minZ - ROCK_BAND_INNER && z <= playableRect.maxZ + ROCK_BAND_INNER;
        if (nearSite) continue;
        if (villages.some(v => Math.hypot(v.x - x, v.z - z) < v.radius)) continue;
        if (cellRand(seed, cx, cz, 3) >= ROCK_DENSITY) continue;
        rocks.push({
          x, z,
          scale: ROCK_SCALE_MIN + cellRand(seed, cx, cz, 4) * ROCK_SCALE_SPREAD,
          yaw: cellRand(seed, cx, cz, 5) * Math.PI * 2,
          variant: Math.floor(cellRand(seed, cx, cz, 6) * ROCK_VARIANTS),
        });
      }
    }
    const tint = new THREE.Color(biomeId !== undefined ? ROCK_COLOR_BY_BIOME[biomeId] ?? ROCK_COLOR_DEFAULT : ROCK_COLOR_DEFAULT);
    for (let v = 0; v < ROCK_VARIANTS; v++) {
      const proto = library.prototype(rockModelId(v));
      const points = rocks.filter(r => r.variant === v);
      if (points.length === 0) continue;
      if (!proto) {
        this.missingModelIds.push(rockModelId(v));
        continue;
      }
      const prop = new InstancedProp(proto, library, { count: points.length, name: 'scenery-rocks', tint });
      for (let i = 0; i < points.length; i++) {
        const r = points[i]!;
        dummy.position.set(r.x, sampleGroundHeight(r.x, r.z) - ROCK_SINK * r.scale, r.z);
        dummy.rotation.set(0, r.yaw, 0);
        dummy.scale.setScalar(r.scale);
        dummy.updateMatrix();
        prop.setMatrixAt(i, dummy.matrix);
      }
      prop.commit();
      prop.addTo(this.scene);
      this.props.push(prop);
      this.rockCount += points.length;
    }

    // ---- Houses ----
    const houseSeed = subSeed(levelSeed, 'houses');
    const houses: Array<{ village: Village; index: number; variant: number }> = [];
    for (const village of villages) {
      if (Math.hypot(village.x - centerX, village.z - centerZ) > HOUSE_DRAW_DISTANCE) continue;
      village.houses.forEach((house, index) => {
        const variant = Math.floor(cellRand(houseSeed, Math.round(house.x * 4), Math.round(house.z * 4), 1) * HOUSE_VARIANTS);
        houses.push({ village, index, variant });
      });
    }
    for (let v = 0; v < HOUSE_VARIANTS; v++) {
      const proto = library.prototype(houseModelId(v));
      const entries = houses.filter(h => h.variant === v);
      if (entries.length === 0) continue;
      if (!proto) {
        this.missingModelIds.push(houseModelId(v));
        continue;
      }
      const prop = new InstancedProp(proto, library, { count: entries.length, name: 'scenery-houses' });
      for (let i = 0; i < entries.length; i++) {
        const house = entries[i]!.village.houses[entries[i]!.index]!;
        dummy.position.set(house.x, sampleGroundHeight(house.x, house.z), house.z);
        // ChimneySmoke rotates the chimney offset by +house.rotation in the
        // x/z plane; a Y-axis rotation in three turns the other way.
        dummy.rotation.set(0, -house.rotation, 0);
        dummy.scale.set(house.w, house.h, house.d);
        dummy.updateMatrix();
        prop.setMatrixAt(i, dummy.matrix);
      }
      prop.commit();
      prop.addTo(this.scene);
      this.props.push(prop);
      this.houseCount += entries.length;
    }
  }

  get rockInstanceCount(): number {
    return this.rockCount;
  }

  get houseInstanceCount(): number {
    return this.houseCount;
  }

  dispose(): void {
    for (const prop of this.props) prop.dispose(this.scene);
    this.props.length = 0;
  }
}
