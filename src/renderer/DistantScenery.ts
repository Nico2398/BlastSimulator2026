// BlastSimulator2026 — Distant Scenery
// Decorative low-poly scenery beyond the interactive mine area:
// mountains, plains, forests, and fields.
// Generated procedurally based on mine type.
// Purely cosmetic — no interaction, very low poly, static.
//
// All scenery is placed at radius ~200–600 units from origin,
// well beyond the 64-unit mine grid.

import * as THREE from 'three';
import type { MinePreset } from '../core/world/MineType.js';

// ---------- Config ----------

const SCENERY_RING_RADIUS = 220;  // distance from grid centre
const MOUNTAIN_COUNT = 12;
const TREE_COUNT = 40;
const HILL_COUNT = 8;

// Mine-type-specific color themes for distant scenery
interface SceneryTheme {
  mountainColor: number;
  hillColor: number;
  vegetationColor: number;
  groundColor: number;
}

const THEMES: Record<string, SceneryTheme> = {
  desert:   { mountainColor: 0xd4a066, hillColor: 0xc8954d, vegetationColor: 0x778844, groundColor: 0xe8c888 },
  mountain: { mountainColor: 0x8899aa, hillColor: 0x667788, vegetationColor: 0x336633, groundColor: 0x99aa88 },
  tropical: { mountainColor: 0x4a7755, hillColor: 0x558866, vegetationColor: 0x22aa44, groundColor: 0x66aa55 },
};

const DEFAULT_THEME: SceneryTheme = THEMES['mountain']!;

// ---------- Main class ----------

export class DistantScenery {
  private readonly scene: THREE.Scene;
  private readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.scene.add(this.group);
  }

  /**
   * Generate scenery for the given mine preset.
   * Call once after terrain is generated.
   * @param preset    - Mine preset (determines biome look)
   * @param gridCentreX - X centre of the mine grid (usually gridSize/2)
   * @param gridCentreZ - Z centre of the mine grid
   */
  generate(preset: MinePreset, gridCentreX: number, gridCentreZ: number): void {
    this.clear();

    const theme = THEMES[preset.id] ?? DEFAULT_THEME;

    // Ground plane (flat circle far out)
    const groundGeo = new THREE.CircleGeometry(SCENERY_RING_RADIUS * 3, 16);
    const groundMat = new THREE.MeshPhongMaterial({ color: theme.groundColor });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(gridCentreX, -0.5, gridCentreZ);
    this.group.add(ground);

    // Mountains (cones arranged in a ring)
    for (let i = 0; i < MOUNTAIN_COUNT; i++) {
      const angle = (i / MOUNTAIN_COUNT) * Math.PI * 2;
      const r = SCENERY_RING_RADIUS + (i % 3) * 40;
      const x = gridCentreX + Math.cos(angle) * r;
      const z = gridCentreZ + Math.sin(angle) * r;
      const h = 30 + (i % 5) * 15;
      const mountain = this.makeMountain(h, theme.mountainColor, i);
      mountain.position.set(x, 0, z);
      this.group.add(mountain);
    }

    // Rolling hills (smaller cones)
    for (let i = 0; i < HILL_COUNT; i++) {
      const angle = (i / HILL_COUNT) * Math.PI * 2 + 0.3;
      const r = SCENERY_RING_RADIUS * 0.7 + (i % 3) * 25;
      const x = gridCentreX + Math.cos(angle) * r;
      const z = gridCentreZ + Math.sin(angle) * r;
      const h = 8 + (i % 4) * 5;
      const hill = this.makeHill(h, theme.hillColor);
      hill.position.set(x, 0, z);
      this.group.add(hill);
    }

    // Trees / vegetation clusters
    if (preset.id !== 'desert') {
      for (let i = 0; i < TREE_COUNT; i++) {
        const angle = (i / TREE_COUNT) * Math.PI * 2 + Math.sin(i) * 0.4;
        const r = SCENERY_RING_RADIUS * 0.5 + (i % 4) * 20;
        const x = gridCentreX + Math.cos(angle) * r;
        const z = gridCentreZ + Math.sin(angle) * r;
        const tree = this.makeTree(theme.vegetationColor, i);
        tree.position.set(x, 0, z);
        this.group.add(tree);
      }
    } else {
      // Desert gets cactus-style spiky things
      for (let i = 0; i < TREE_COUNT / 2; i++) {
        const angle = (i / (TREE_COUNT / 2)) * Math.PI * 2;
        const r = SCENERY_RING_RADIUS * 0.55 + (i % 3) * 15;
        const x = gridCentreX + Math.cos(angle) * r;
        const z = gridCentreZ + Math.sin(angle) * r;
        const cactus = this.makeCactus(theme.vegetationColor);
        cactus.position.set(x, 0, z);
        this.group.add(cactus);
      }
    }
  }

  /** Remove all scenery. */
  clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      } else if (child instanceof THREE.Group) {
        disposeGroup(child);
      }
    }
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.group);
  }

  // ---------- Mesh builders ----------

  private makeMountain(height: number, color: number, variant: number): THREE.Group {
    const g = new THREE.Group();
    // Main peak
    const mainGeo = new THREE.ConeGeometry(height * 0.6, height, 5 + (variant % 3));
    const mat = new THREE.MeshPhongMaterial({ color, shininess: 5, flatShading: true });
    const main = new THREE.Mesh(mainGeo, mat);
    main.position.y = height / 2;
    g.add(main);
    // Snow cap (lighter cone on top) — only for mountain biome heights
    if (height > 40) {
      const capGeo = new THREE.ConeGeometry(height * 0.15, height * 0.25, 5);
      const capMat = new THREE.MeshPhongMaterial({ color: 0xeeeeff, flatShading: true });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.y = height * 0.87;
      g.add(cap);
    }
    return g;
  }

  private makeHill(height: number, color: number): THREE.Mesh {
    const geo = new THREE.SphereGeometry(height * 0.9, 6, 4);
    const mat = new THREE.MeshPhongMaterial({ color, shininess: 3, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.y = 0.5;
    mesh.position.y = height * 0.25;
    return mesh;
  }

  private makeTree(color: number, variant: number): THREE.Group {
    const g = new THREE.Group();
    // Trunk
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.4, 3, 5);
    const trunkMat = new THREE.MeshPhongMaterial({ color: 0x6b4226, flatShading: true });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 1.5;
    g.add(trunk);
    // Foliage (stacked cones)
    const layers = 2 + (variant % 2);
    for (let l = 0; l < layers; l++) {
      const r = 2.5 - l * 0.6;
      const h = 3 + l * 0.5;
      const coneGeo = new THREE.ConeGeometry(r, h, 6);
      const coneMat = new THREE.MeshPhongMaterial({ color, flatShading: true });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.y = 3 + l * 2.2;
      g.add(cone);
    }
    return g;
  }

  private makeCactus(color: number): THREE.Group {
    const g = new THREE.Group();
    // Trunk
    const trunkGeo = new THREE.CylinderGeometry(0.4, 0.5, 6, 6);
    const mat = new THREE.MeshPhongMaterial({ color, flatShading: true });
    const trunk = new THREE.Mesh(trunkGeo, mat);
    trunk.position.y = 3;
    g.add(trunk);
    // Arms
    for (const [side, h] of [[-1, 2.5], [1, 3.5]] as const) {
      const armGeo = new THREE.CylinderGeometry(0.25, 0.3, 2.5, 5);
      const arm = new THREE.Mesh(armGeo, mat.clone());
      arm.rotation.z = (Math.PI / 3) * side;
      arm.position.set(side * 1.4, h, 0);
      g.add(arm);
    }
    return g;
  }
}

function disposeGroup(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  }
}
