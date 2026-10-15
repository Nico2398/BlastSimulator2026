// BlastSimulator2026 — The site's rally flag
// A flag on a pole over a little stone cairn, planted on the site's rally
// point (RallyPoint.ts), where new hires and purchased vehicles arrive. It is
// a marker, not a building: nothing damages it, and every sync stands it on
// whatever ground is left under its tile, so a dig or a blast beneath it only
// lowers it.

import * as THREE from 'three';
import type { RallyPoint } from '../core/state/GameState.js';
import { createToonMaterial } from './models/CartoonMaterial.js';

const POLE_HEIGHT = 3.4;
const POLE_RADIUS = 0.06;
const CLOTH_WIDTH = 1.25;
const CLOTH_HEIGHT = 0.8;
/** Columns the cloth is cut into, so it can carry a frozen ripple rather than read as a card. */
const CLOTH_SEGMENTS = 8;
const CLOTH_RIPPLE = 0.09;
const CAIRN_RADIUS = 0.42;
const CAIRN_HEIGHT = 0.35;

const POLE_COLOR = 0x6b4a2b;
const CLOTH_COLOR = 0xff5a1f;
const STRIPE_COLOR = 0xffd21f;
const CAIRN_COLOR = 0x8a8478;
const FINIAL_COLOR = 0xffd21f;

/** Name the flag's group carries, so scene inspection (tests, debugging) can find it. */
export const RALLY_FLAG_NAME = 'rally-flag';

/** A cloth panel along +x from the pole, rippled across its width; `top`/`bottom` are heights on the pole. */
function clothGeometry(top: number, bottom: number): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(CLOTH_WIDTH, top - bottom, CLOTH_SEGMENTS, 1);
  geometry.translate(CLOTH_WIDTH / 2 + POLE_RADIUS, (top + bottom) / 2, 0);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const along = (position.getX(i) - POLE_RADIUS) / CLOTH_WIDTH;
    position.setZ(i, Math.sin(along * Math.PI * 2) * CLOTH_RIPPLE * along);
    position.setY(i, position.getY(i) - along * 0.12);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function buildFlag(): THREE.Group {
  const group = new THREE.Group();
  group.name = RALLY_FLAG_NAME;

  const cairn = new THREE.Mesh(
    new THREE.DodecahedronGeometry(CAIRN_RADIUS, 0),
    createToonMaterial({ color: new THREE.Color(CAIRN_COLOR), name: 'rallyFlagCairn' }),
  );
  cairn.scale.set(1, CAIRN_HEIGHT / CAIRN_RADIUS, 1);
  cairn.position.y = CAIRN_HEIGHT * 0.5;

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS * 1.3, POLE_HEIGHT, 8),
    createToonMaterial({ color: new THREE.Color(POLE_COLOR), name: 'rallyFlagPole' }),
  );
  pole.position.y = POLE_HEIGHT / 2;

  const finial = new THREE.Mesh(
    new THREE.SphereGeometry(POLE_RADIUS * 2.2, 10, 8),
    createToonMaterial({ color: new THREE.Color(FINIAL_COLOR), name: 'rallyFlagFinial' }),
  );
  finial.position.y = POLE_HEIGHT + POLE_RADIUS;

  const clothTop = POLE_HEIGHT - 0.08;
  const stripeTop = clothTop - CLOTH_HEIGHT * 0.4;
  const stripeBottom = clothTop - CLOTH_HEIGHT * 0.6;
  const clothMaterial = createToonMaterial({ color: new THREE.Color(CLOTH_COLOR), name: 'rallyFlagCloth' });
  clothMaterial.side = THREE.DoubleSide;
  const stripeMaterial = createToonMaterial({ color: new THREE.Color(STRIPE_COLOR), name: 'rallyFlagStripe' });
  stripeMaterial.side = THREE.DoubleSide;
  const upper = new THREE.Mesh(clothGeometry(clothTop, stripeTop), clothMaterial);
  const stripe = new THREE.Mesh(clothGeometry(stripeTop, stripeBottom), stripeMaterial);
  const lower = new THREE.Mesh(clothGeometry(stripeBottom, clothTop - CLOTH_HEIGHT), clothMaterial);

  for (const mesh of [cairn, pole, finial, upper, stripe, lower]) {
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

export class RallyFlagMesh {
  private readonly scene: THREE.Scene;
  private flag: THREE.Group | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Plants the flag on `point`, standing on `surfaceY` there — sampled anew on
   * every call, so the flag follows the ground down after a dig or a blast.
   * No point (a state with no terrain yet) removes it.
   */
  sync(point: RallyPoint | undefined, surfaceY: (x: number, z: number) => number): void {
    if (!point) {
      this.dispose();
      return;
    }
    if (!this.flag) {
      this.flag = buildFlag();
      this.scene.add(this.flag);
    }
    this.flag.position.set(point.x, surfaceY(point.x, point.z), point.z);
  }

  /** The flag's world position, or null when none is planted. */
  get position(): THREE.Vector3 | null {
    return this.flag ? this.flag.position.clone() : null;
  }

  dispose(): void {
    if (!this.flag) return;
    this.scene.remove(this.flag);
    const materials = new Set<THREE.Material>();
    this.flag.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      materials.add(object.material as THREE.Material);
    });
    for (const material of materials) material.dispose();
    this.flag = null;
  }
}
