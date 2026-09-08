// BlastSimulator2026 — Dust devils: cartoon twisters wandering the arid rims
// (#458 T7.3 per-biome ambient extra). Each one is the `prop_twister` model —
// a striped funnel standing on a dust cloud — that this module spins, wobbles
// and breathes, with a handful of grit chunks orbiting up its flank.
//
// Construct-safe under Node (model stand-in + BoxGeometry, no canvas/DOM).

import * as THREE from 'three';
import { cellRand, subSeed } from '../../core/math/Hash.js';
import { modelLibrary, type ModelInstance, type ModelLibrary } from '../models/ModelLibrary.js';
import { TWISTER_MODEL_ID } from '../models/ModelIds.js';
import { createToonMaterial } from '../models/CartoonMaterial.js';

const DEVIL_COUNT = 4;
const SPAWN_RADIUS_MIN = 40;
const SPAWN_RADIUS_MAX = 160;
const SPIN_SPEED_MIN = 2.2;
const SPIN_SPEED_MAX = 3.4;
const WANDER_RADIUS_MIN = 3;
const WANDER_RADIUS_MAX = 9;
const WANDER_SPEED_MIN = 0.15;
const WANDER_SPEED_MAX = 0.35;
/** Lean of the funnel as it staggers about (rad) and how fast it staggers. */
const WOBBLE_ANGLE = 0.07;
const WOBBLE_FREQUENCY = 1.3;
const BREATHE_AMPLITUDE = 0.08;
const BREATHE_FREQUENCY = 0.9;
/** Stand-in envelope while the twister asset is not loaded (x, y, z). */
const FALLBACK_SIZE = [3.2, 9, 3.2] as const;
/** Grit chunks orbiting each funnel: they climb, widen with the funnel, and drop back to the foot. */
const DEBRIS_PER_DEVIL = 5;
const DEBRIS_SIZE = 0.3;
const DEBRIS_ORBIT_MIN = 1.1;
const DEBRIS_ORBIT_SPREAD = 1.7;
const DEBRIS_RISE = 6.5;
const DEBRIS_ORBIT_SPEED = 2.4;
const DEBRIS_CLIMB_SPEED = 0.45;
const DEBRIS_COLOR = 0x7a6a55;

interface Devil {
  baseX: number;
  baseZ: number;
  spinSpeed: number;
  wanderRadius: number;
  wanderSpeed: number;
  phase: number;
  group: THREE.Group;
  instance: ModelInstance;
}

export class DustDevils {
  private readonly scene: THREE.Scene;
  private readonly devils: Devil[] = [];
  private readonly debris: THREE.InstancedMesh;
  private readonly debrisMaterial: THREE.Material;
  private time = 0;
  private readonly dummy = new THREE.Object3D();
  /** Set to the twister id while the library lacks it — the level draws stand-ins and rebuilds once it loads. */
  readonly missingModelIds: string[] = [];

  constructor(
    scene: THREE.Scene, levelSeed: number, centerX: number, centerZ: number,
    private readonly sampleHeight: (x: number, z: number) => number,
    library: ModelLibrary = modelLibrary,
  ) {
    this.scene = scene;
    const seed = subSeed(levelSeed, 'dust-devils');
    if (!library.has(TWISTER_MODEL_ID)) this.missingModelIds.push(TWISTER_MODEL_ID);

    for (let i = 0; i < DEVIL_COUNT; i++) {
      const angle = cellRand(seed, i, 0, 1) * Math.PI * 2;
      const dist = SPAWN_RADIUS_MIN + cellRand(seed, i, 0, 2) * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN);
      const instance = library.instantiate(TWISTER_MODEL_ID, { size: FALLBACK_SIZE });
      const group = new THREE.Group();
      group.name = 'dust-devil';
      group.add(instance.root);
      this.scene.add(group);
      this.devils.push({
        baseX: centerX + Math.cos(angle) * dist,
        baseZ: centerZ + Math.sin(angle) * dist,
        spinSpeed: SPIN_SPEED_MIN + cellRand(seed, i, 0, 3) * (SPIN_SPEED_MAX - SPIN_SPEED_MIN),
        wanderRadius: WANDER_RADIUS_MIN + cellRand(seed, i, 0, 4) * (WANDER_RADIUS_MAX - WANDER_RADIUS_MIN),
        wanderSpeed: WANDER_SPEED_MIN + cellRand(seed, i, 0, 5) * (WANDER_SPEED_MAX - WANDER_SPEED_MIN),
        phase: cellRand(seed, i, 0, 6) * Math.PI * 2,
        group,
        instance,
      });
    }

    this.debrisMaterial = createToonMaterial({ color: new THREE.Color(DEBRIS_COLOR), name: 'dust-devil-debris' });
    const chunk = new THREE.BoxGeometry(DEBRIS_SIZE, DEBRIS_SIZE * 0.7, DEBRIS_SIZE * 0.85);
    this.debris = new THREE.InstancedMesh(chunk, this.debrisMaterial, DEVIL_COUNT * DEBRIS_PER_DEVIL);
    this.debris.name = 'dust-devil-debris';
    this.debris.castShadow = false;
    this.debris.receiveShadow = false;
    this.scene.add(this.debris);

    this.writeAll();
  }

  /** Devil count — for tests verifying placement. */
  get devilCount(): number {
    return this.devils.length;
  }

  update(dt: number): void {
    this.time += dt;
    this.writeAll();
  }

  dispose(): void {
    for (const devil of this.devils) {
      this.scene.remove(devil.group);
      devil.instance.dispose();
    }
    this.devils.length = 0;
    this.scene.remove(this.debris);
    this.debris.geometry.dispose();
    this.debrisMaterial.dispose();
  }

  // ---------- Internal ----------

  private writeAll(): void {
    const t = this.time;
    for (let i = 0; i < this.devils.length; i++) {
      const devil = this.devils[i]!;
      const wanderAngle = t * devil.wanderSpeed + devil.phase;
      const x = devil.baseX + Math.cos(wanderAngle) * devil.wanderRadius;
      const z = devil.baseZ + Math.sin(wanderAngle) * devil.wanderRadius;
      const y = this.sampleHeight(x, z);
      const breathe = 1 + BREATHE_AMPLITUDE * Math.sin(t * BREATHE_FREQUENCY + devil.phase);

      devil.group.position.set(x, y, z);
      devil.group.rotation.set(
        WOBBLE_ANGLE * Math.sin(t * WOBBLE_FREQUENCY + devil.phase),
        t * devil.spinSpeed,
        WOBBLE_ANGLE * Math.cos(t * WOBBLE_FREQUENCY * 0.8 + devil.phase),
      );
      devil.group.scale.set(breathe, 1, breathe);
      devil.group.updateMatrix();

      for (let k = 0; k < DEBRIS_PER_DEVIL; k++) {
        const climb = (t * DEBRIS_CLIMB_SPEED + k / DEBRIS_PER_DEVIL + devil.phase) % 1;
        const angle = t * DEBRIS_ORBIT_SPEED * (0.8 + 0.1 * k) + devil.phase + (k * Math.PI * 2) / DEBRIS_PER_DEVIL;
        const radius = (DEBRIS_ORBIT_MIN + climb * DEBRIS_ORBIT_SPREAD) * breathe;
        this.dummy.position.set(x + Math.cos(angle) * radius, y + 0.3 + climb * DEBRIS_RISE, z + Math.sin(angle) * radius);
        this.dummy.rotation.set(angle, climb * 6, angle * 0.5);
        this.dummy.scale.setScalar(1 - climb * 0.4);
        this.dummy.updateMatrix();
        this.debris.setMatrixAt(i * DEBRIS_PER_DEVIL + k, this.dummy.matrix);
      }
    }
    this.debris.instanceMatrix.needsUpdate = true;
  }
}
