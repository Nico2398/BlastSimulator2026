// GhostMesh — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { GhostPreview } from '../../../src/core/state/GameState.js';
import {
  GhostMesh,
  GHOST_UNREACHABLE_COLOR,
  GHOST_UNREACHABLE_RIM_COLOR,
  GHOST_UNREACHABLE_OPACITY_MIN,
  GHOST_UNREACHABLE_OPACITY_MAX,
} from '../../../src/renderer/GhostMesh.js';
import { BuildingMesh } from '../../../src/renderer/BuildingMesh.js';
import { RAMP_ARROW_COLOR } from '../../../src/renderer/RampArrow.js';
import { buildingModelId } from '../../../src/renderer/models/ModelIds.js';
import { ModelLibrary } from '../../../src/renderer/models/ModelLibrary.js';
import { getBuildingDef, getDefSize, type Building } from '../../../src/core/entities/Building.js';
import { loadedModelLibrary } from '../../helpers/models.js';

function makePreview(id: number, overrides: Partial<GhostPreview> = {}): GhostPreview {
  return {
    id,
    type: 'drill_hole',
    targetX: id * 3,
    targetY: 0,
    targetZ: id * 3,
    // Unclaimed by default (#547) — callers override to model a claimed ghost.
    claimed: false,
    ...overrides,
  };
}

describe('GhostMesh', () => {
  it('sync adds a mesh per preview', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1), makePreview(2)]);
    expect(gm.count).toBe(2);
    expect(scene.children.length).toBe(2);
    gm.dispose();
  });

  it('sync removes meshes for gone previews', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1), makePreview(2)]);
    gm.sync([makePreview(2)]);
    expect(gm.count).toBe(1);
    expect(scene.children.length).toBe(1);
    gm.dispose();
  });

  it('sync is idempotent — does not duplicate existing ghosts', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    const preview = makePreview(1);
    gm.sync([preview]);
    gm.sync([preview]);
    expect(gm.count).toBe(1);
    gm.dispose();
  });

  it('sync with empty list clears all ghosts', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1), makePreview(2)]);
    gm.sync([]);
    expect(gm.count).toBe(0);
    expect(scene.children.length).toBe(0);
    gm.dispose();
  });

  it('mesh is positioned at targetX/Y/Z', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(5, { targetX: 10, targetY: 2, targetZ: 7 })]);
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh.position.x).toBe(10);
    expect(mesh.position.z).toBe(7);
    expect(mesh.position.y).toBeGreaterThan(2); // elevated by half ghost size
    gm.dispose();
  });

  it('update animates opacity between min and max', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1)]);
    const mat = (scene.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;

    const opacities = new Set<number>();
    for (let i = 0; i < 60; i++) {
      gm.update(1 / 60);
      opacities.add(Math.round(mat.opacity * 100));
    }
    // Opacity should vary — not constant
    expect(opacities.size).toBeGreaterThan(1);
    gm.dispose();
  });

  it('material is transparent and blue', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1)]);
    const mat = (scene.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;
    expect(mat.transparent).toBe(true);
    // Blue channel dominant
    expect(mat.color.b).toBeGreaterThan(mat.color.r);
    gm.dispose();
  });

  it('clearAll removes all meshes', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1), makePreview(2), makePreview(3)]);
    gm.clearAll();
    expect(gm.count).toBe(0);
    expect(scene.children.length).toBe(0);
    gm.dispose();
  });

  it('dispose clears meshes and disposes material', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1)]);
    gm.dispose();
    expect(gm.count).toBe(0);
    expect(scene.children.length).toBe(0);
  });

  // ── #547: claimed vs unclaimed previews must read distinctly ────────────────
  // An employee still walking to a claimed action should not look identical to
  // an untouched, unclaimed one — dimmer + slower pulse, both stay blue.

  describe('claimed vs unclaimed rendering (#547)', () => {
    it('a claimed preview animates with a lower peak opacity than an unclaimed one', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1, { claimed: false }), makePreview(2, { claimed: true })]);

      // Identify each mesh by its (unique, preview-id-derived) x position —
      // GhostMesh exposes no id->mesh lookup, only the synced scene graph.
      const unclaimedMesh = scene.children.find(c => (c as THREE.Mesh).position.x === 3) as THREE.Mesh;
      const claimedMesh = scene.children.find(c => (c as THREE.Mesh).position.x === 6) as THREE.Mesh;
      expect(unclaimedMesh).toBeDefined();
      expect(claimedMesh).toBeDefined();

      let unclaimedMax = -Infinity;
      let claimedMax = -Infinity;
      for (let i = 0; i < 180; i++) {
        gm.update(1 / 60);
        unclaimedMax = Math.max(unclaimedMax, (unclaimedMesh.material as THREE.MeshPhongMaterial).opacity);
        claimedMax = Math.max(claimedMax, (claimedMesh.material as THREE.MeshPhongMaterial).opacity);
      }

      expect(claimedMax).toBeLessThan(unclaimedMax);
      gm.dispose();
    });

    it('a claimed preview pulses slower than an unclaimed one (smaller opacity swing on the very first tick, both starting from their own minimum)', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1, { claimed: false }), makePreview(2, { claimed: true })]);

      const unclaimedMesh = scene.children.find(c => (c as THREE.Mesh).position.x === 3) as THREE.Mesh;
      const claimedMesh = scene.children.find(c => (c as THREE.Mesh).position.x === 6) as THREE.Mesh;

      const unclaimedStart = (unclaimedMesh.material as THREE.MeshPhongMaterial).opacity;
      const claimedStart = (claimedMesh.material as THREE.MeshPhongMaterial).opacity;

      gm.update(0.05);

      const unclaimedDelta = Math.abs((unclaimedMesh.material as THREE.MeshPhongMaterial).opacity - unclaimedStart);
      const claimedDelta = Math.abs((claimedMesh.material as THREE.MeshPhongMaterial).opacity - claimedStart);

      expect(claimedDelta).toBeLessThan(unclaimedDelta);
      gm.dispose();
    });

    it('both a claimed and unclaimed preview stay blue (blue channel dominant)', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1, { claimed: false }), makePreview(2, { claimed: true })]);

      for (const mesh of scene.children as THREE.Mesh[]) {
        const mat = mesh.material as THREE.MeshPhongMaterial;
        expect(mat.transparent).toBe(true);
        expect(mat.color.b).toBeGreaterThan(mat.color.r);
      }
      gm.dispose();
    });

    it('flipping claimed in place on the same id updates the existing mesh rather than recreating it, and its opacity ceiling drops into the claimed (dimmer) range', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      // A permanently-unclaimed control preview (id 9) syncs alongside the one
      // whose claimed flag flips, so this test has a same-run baseline to
      // compare against rather than a hardcoded opacity constant.
      gm.sync([makePreview(1, { claimed: false }), makePreview(9, { claimed: false })]);

      expect(scene.children).toHaveLength(2);
      const meshBefore = scene.children.find(c => (c as THREE.Mesh).position.x === 3) as THREE.Mesh;

      gm.sync([makePreview(1, { claimed: true }), makePreview(9, { claimed: false })]);

      expect(scene.children).toHaveLength(2);
      const meshAfter = scene.children.find(c => (c as THREE.Mesh).position.x === 3) as THREE.Mesh;
      const controlMesh = scene.children.find(c => (c as THREE.Mesh).position.x === 27) as THREE.Mesh;
      // Same mesh instance — not removed/re-added — proving the material was
      // swapped/updated in place rather than the whole ghost being recreated.
      expect(meshAfter).toBe(meshBefore);

      let maxAfter = -Infinity;
      let controlMax = -Infinity;
      for (let i = 0; i < 180; i++) {
        gm.update(1 / 60);
        maxAfter = Math.max(maxAfter, (meshAfter.material as THREE.MeshPhongMaterial).opacity);
        controlMax = Math.max(controlMax, (controlMesh.material as THREE.MeshPhongMaterial).opacity);
      }
      // The flipped mesh's ceiling must now sit below the still-unclaimed
      // control's ceiling — proving the in-place update actually changed its
      // rendering, not merely its `claimed` bookkeeping field.
      expect(maxAfter).toBeLessThan(controlMax);
      gm.dispose();
    });

    it('removing a claimed preview from the sync input removes its mesh, same as an unclaimed one', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1, { claimed: true })]);
      expect(gm.count).toBe(1);

      gm.sync([]);

      expect(gm.count).toBe(0);
      expect(scene.children.length).toBe(0);
      gm.dispose();
    });
  });

  // ── #613: fresnel rim-light on ghost materials ──────────────────────────
  // Edges facing away from the camera should glow brighter than faces facing
  // it, layered on top of the existing pulse-opacity behaviour. Vitest has no
  // WebGL context, so onBeforeCompile is never invoked by a real compile —
  // these tests invoke the hook directly with a hand-built minimal fake
  // shader object, matching the standard Phong fresnel-into-emissive
  // injection point (#common / #emissivemap_fragment chunks).

  describe('fresnel rim-light (#613)', () => {
    function makeFakeShader() {
      return {
        uniforms: {} as Record<string, { value: unknown }>,
        vertexShader: 'void main() {}',
        fragmentShader: '#include <common>\nvoid main() {\n#include <emissivemap_fragment>\n}',
      };
    }

    it('unclaimed and claimed materials stay MeshPhongMaterial with an onBeforeCompile hook assigned', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1, { claimed: false }), makePreview(2, { claimed: true })]);

      const unclaimedMesh = scene.children.find(c => (c as THREE.Mesh).position.x === 3) as THREE.Mesh;
      const claimedMesh = scene.children.find(c => (c as THREE.Mesh).position.x === 6) as THREE.Mesh;
      const unclaimedMat = unclaimedMesh.material as THREE.MeshPhongMaterial;
      const claimedMat = claimedMesh.material as THREE.MeshPhongMaterial;

      expect(unclaimedMat).toBeInstanceOf(THREE.MeshPhongMaterial);
      expect(claimedMat).toBeInstanceOf(THREE.MeshPhongMaterial);
      expect(typeof unclaimedMat.onBeforeCompile).toBe('function');
      expect(typeof claimedMat.onBeforeCompile).toBe('function');
      gm.dispose();
    });

    it('onBeforeCompile injects rim uniforms (color, fresnel power, intensity) into the shader', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1)]);
      const mat = (scene.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;

      const shader = makeFakeShader();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mat.onBeforeCompile!(shader as any, {} as any);

      expect(shader.uniforms.rimColor).toBeDefined();
      expect(shader.uniforms.rimPower).toBeDefined();
      expect(shader.uniforms.rimIntensity).toBeDefined();
      gm.dispose();
    });

    it('rim uniform values carry the configured fresnel power/intensity, and the rim color is blue-dominant', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1)]);
      const mat = (scene.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;

      const shader = makeFakeShader();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mat.onBeforeCompile!(shader as any, {} as any);

      const rimColor = shader.uniforms.rimColor!.value as THREE.Color;
      expect(rimColor.b).toBeGreaterThan(rimColor.r);
      expect(typeof shader.uniforms.rimPower!.value).toBe('number');
      expect(shader.uniforms.rimPower!.value).toBeGreaterThan(0);
      expect(typeof shader.uniforms.rimIntensity!.value).toBe('number');
      expect(shader.uniforms.rimIntensity!.value).toBeGreaterThan(0);
      gm.dispose();
    });

    it('onBeforeCompile injects fresnel GLSL into the fragment shader, changing it from the original', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1)]);
      const mat = (scene.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;

      const shader = makeFakeShader();
      const originalFragmentShader = shader.fragmentShader;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mat.onBeforeCompile!(shader as any, {} as any);

      expect(shader.fragmentShader).not.toBe(originalFragmentShader);
      // The fresnel term is a dot-product of view direction and normal — its
      // presence is the signature of a real fresnel injection, not just any
      // string append.
      expect(shader.fragmentShader).toContain('dot(');
      // A dot-product alone proves nothing if the result is never used —
      // assert it actually accumulates into totalEmissiveRadiance, the line
      // Three's Phong shader reads to make emissive glow visible on screen.
      // A no-op that computes rimFresnel but discards it would still pass
      // the assertions above; this one closes that loophole.
      expect(shader.fragmentShader).toContain('totalEmissiveRadiance += rimColor * rimIntensity * rimFresnel * rimOpacityCompensation;');
      // The injection must land immediately after the emissivemap_fragment
      // chunk — that's the point in Three's Phong fragment shader where
      // totalEmissiveRadiance exists and is still open to additive terms.
      const emissiveChunkIndex = shader.fragmentShader.indexOf('#include <emissivemap_fragment>');
      const rimTermIndex = shader.fragmentShader.indexOf('totalEmissiveRadiance += rimColor');
      expect(emissiveChunkIndex).toBeGreaterThanOrEqual(0);
      expect(rimTermIndex).toBeGreaterThan(emissiveChunkIndex);
      gm.dispose();
    });

    it('unclaimed and claimed materials get the same rim treatment — rim color/power/intensity do not diverge by claimed state', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1, { claimed: false }), makePreview(2, { claimed: true })]);

      const unclaimedMesh = scene.children.find(c => (c as THREE.Mesh).position.x === 3) as THREE.Mesh;
      const claimedMesh = scene.children.find(c => (c as THREE.Mesh).position.x === 6) as THREE.Mesh;
      const unclaimedMat = unclaimedMesh.material as THREE.MeshPhongMaterial;
      const claimedMat = claimedMesh.material as THREE.MeshPhongMaterial;

      const unclaimedShader = makeFakeShader();
      const claimedShader = makeFakeShader();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      unclaimedMat.onBeforeCompile!(unclaimedShader as any, {} as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      claimedMat.onBeforeCompile!(claimedShader as any, {} as any);

      const unclaimedColor = unclaimedShader.uniforms.rimColor!.value as THREE.Color;
      const claimedColor = claimedShader.uniforms.rimColor!.value as THREE.Color;
      expect(claimedColor.r).toBeCloseTo(unclaimedColor.r);
      expect(claimedColor.g).toBeCloseTo(unclaimedColor.g);
      expect(claimedColor.b).toBeCloseTo(unclaimedColor.b);
      expect(claimedShader.uniforms.rimPower!.value).toBe(unclaimedShader.uniforms.rimPower!.value);
      expect(claimedShader.uniforms.rimIntensity!.value).toBe(unclaimedShader.uniforms.rimIntensity!.value);
      gm.dispose();
    });

    it('update(dt) still only animates opacity — material base color is untouched by the pulse', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1)]);
      const mat = (scene.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;

      const colorBefore = mat.color.clone();
      for (let i = 0; i < 60; i++) {
        gm.update(1 / 60);
      }
      expect(mat.color.equals(colorBefore)).toBe(true);
      expect(mat.transparent).toBe(true);
      gm.dispose();
    });
  });

  // ── #556: construction-site ghosts span their full footprint ────────────
  // A `place_building` preview carries `footprint` (cell offsets from
  // targetX/targetZ) so the ghost reads as the real building's outline
  // instead of a single fixed-size marker box.

  describe('footprint rendering — construction site ghost spans its full footprint (#556)', () => {
    it('renders a mesh whose world-space extent covers exactly the footprint cells [x-0.5, x+sizeX-0.5] x [z-0.5, z+sizeZ-0.5] (#1198)', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      // 3-wide (x) by 2-deep (z) footprint, offsets from targetX/targetZ.
      const footprint: ReadonlyArray<readonly [number, number]> = [
        [0, 0], [1, 0], [2, 0],
        [0, 1], [1, 1], [2, 1],
      ];
      const targetX = 10, targetZ = 20, sizeX = 3, sizeZ = 2;
      gm.sync([makePreview(1, { type: 'place_building', targetX, targetZ, footprint })]);

      const mesh = scene.children[0] as THREE.Mesh;
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);

      expect(box.min.x).toBeCloseTo(targetX - 0.5);
      expect(box.max.x).toBeCloseTo(targetX + sizeX - 0.5);
      expect(box.min.z).toBeCloseTo(targetZ - 0.5);
      expect(box.max.z).toBeCloseTo(targetZ + sizeZ - 0.5);
      gm.dispose();
    });

    it('a preview with no footprint still renders the old fixed-size box (regression)', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1, { targetX: 5, targetZ: 5 })]);

      const mesh = scene.children[0] as THREE.Mesh;
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      const size = new THREE.Vector3();
      box.getSize(size);

      // Must NOT have grown to cover a multi-cell area just because
      // footprint-aware code exists elsewhere for other previews.
      expect(size.x).toBeLessThan(1.5);
      expect(size.z).toBeLessThan(1.5);
      gm.dispose();
    });

    it('a single-cell footprint still covers at least one whole grid cell', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1, { type: 'place_building', targetX: 0, targetZ: 0, footprint: [[0, 0]] })]);

      const mesh = scene.children[0] as THREE.Mesh;
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);
      const size = new THREE.Vector3();
      box.getSize(size);

      expect(size.x).toBeGreaterThanOrEqual(0.9);
      expect(size.z).toBeGreaterThanOrEqual(0.9);
      gm.dispose();
    });

    it('a footprint ghost world bounding box equals exactly [x-0.5, x+sizeX-0.5] x [z-0.5, z+sizeZ-0.5] (#1198)', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      const footprint: ReadonlyArray<readonly [number, number]> = [
        [0, 0], [1, 0], [2, 0], [3, 0],
        [0, 1], [1, 1], [2, 1], [3, 1],
      ]; // 4-wide x 2-deep, matches freight_warehouse T1 scale
      const targetX = 0, targetZ = 0, sizeX = 4, sizeZ = 2;
      gm.sync([makePreview(1, { type: 'place_building', targetX, targetZ, footprint })]);

      const mesh = scene.children[0] as THREE.Mesh;
      mesh.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(mesh);

      expect(box.min.x).toBeCloseTo(targetX - 0.5);
      expect(box.max.x).toBeCloseTo(targetX + sizeX - 0.5);
      expect(box.min.z).toBeCloseTo(targetZ - 0.5);
      expect(box.max.z).toBeCloseTo(targetZ + sizeZ - 0.5);
      gm.dispose();
    });

    it('claimed vs unclaimed footprint ghosts still read distinctly (dimmer when claimed), same as non-footprint ghosts', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      const footprint: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
      gm.sync([
        makePreview(1, { type: 'place_building', targetX: 0, targetZ: 0, footprint, claimed: false }),
        makePreview(2, { type: 'place_building', targetX: 10, targetZ: 10, footprint, claimed: true }),
      ]);

      // A footprint ghost is positioned at targetX/Z + sizeX/Z/2 (centred on
      // its own footprint, like BuildingMesh.ts), not at targetX/Z itself —
      // so look these two up by scene insertion order (sync() adds them in
      // preview order into an otherwise-empty scene) rather than by an exact
      // position.x match against the raw target coordinate.
      const unclaimedMesh = scene.children[0] as THREE.Mesh;
      const claimedMesh = scene.children[1] as THREE.Mesh;
      expect(unclaimedMesh).toBeDefined();
      expect(claimedMesh).toBeDefined();

      let unclaimedMax = -Infinity;
      let claimedMax = -Infinity;
      for (let i = 0; i < 180; i++) {
        gm.update(1 / 60);
        unclaimedMax = Math.max(unclaimedMax, (unclaimedMesh.material as THREE.MeshPhongMaterial).opacity);
        claimedMax = Math.max(claimedMax, (claimedMesh.material as THREE.MeshPhongMaterial).opacity);
      }
      expect(claimedMax).toBeLessThan(unclaimedMax);
      gm.dispose();
    });

    it('removing a footprint preview from the sync input removes its mesh', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      const footprint: ReadonlyArray<readonly [number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
      gm.sync([makePreview(1, { type: 'place_building', footprint })]);
      expect(gm.count).toBe(1);

      gm.sync([]);

      expect(gm.count).toBe(0);
      expect(scene.children.length).toBe(0);
      gm.dispose();
    });
  });

  // ── #1012: getGroup(id) — lets other renderer modules (TaskProgressBar)
  // anchor world-space UI to a construction site's own ghost transform.

  describe('getGroup(id) (#1012)', () => {
    it('returns the live THREE.Object3D for an active ghost id', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1)]);

      const group = gm.getGroup(1);

      expect(group).not.toBeNull();
      expect(group).toBe(scene.children[0]);
      gm.dispose();
    });

    it('returns null for an id with no ghost', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1)]);

      expect(gm.getGroup(999)).toBeNull();
      gm.dispose();
    });

    it('returns null once the ghost is removed from a later sync()', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1)]);
      expect(gm.getGroup(1)).not.toBeNull();

      gm.sync([]);

      expect(gm.getGroup(1)).toBeNull();
      gm.dispose();
    });
  });
});

// ── #1306: red (unreachable) variant and building-model holograms ─────────────

/** Building exit marker colour (BuildingMesh.ts EXIT_COLOR, not exported). */
const BUILDING_EXIT_MARKER_COLOR = 0xff4400;

/** GhostMesh takes the model library as an optional second argument (#1306). */
function makeGhostMesh(scene: THREE.Scene, library: ModelLibrary): GhostMesh {
  const Ctor = GhostMesh as unknown as new (s: THREE.Scene, l: ModelLibrary) => GhostMesh;
  return new Ctor(scene, library);
}

function hueDegrees(color: THREE.Color): number {
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  return hsl.h * 360;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
}

function peakOpacity(gm: GhostMesh, mat: THREE.MeshPhongMaterial, frames = 240): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < frames; i++) {
    gm.update(1 / 60);
    min = Math.min(min, mat.opacity);
    max = Math.max(max, mat.opacity);
  }
  return { min, max };
}

function makeFakeShader() {
  return {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: 'void main() {}',
    fragmentShader: '#include <common>\nvoid main() {\n#include <emissivemap_fragment>\n}',
  };
}

describe('unreachable (red) ghosts (#1306)', () => {
  it('an unreachable preview is drawn with a red-dominant, transparent material', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1, { unreachable: true })]);
    const mat = (scene.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;
    expect(mat).toBeInstanceOf(THREE.MeshPhongMaterial);
    expect(mat.transparent).toBe(true);
    expect(mat.color.r).toBeGreaterThan(mat.color.b * 1.5);
    expect(mat.color.r).toBeGreaterThan(mat.color.g * 1.5);
    gm.dispose();
  });

  it('a reachable (or unflagged) preview stays blue', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1, { unreachable: false }), makePreview(2)]);
    for (const mesh of scene.children as THREE.Mesh[]) {
      const mat = mesh.material as THREE.MeshPhongMaterial;
      expect(mat.color.b).toBeGreaterThan(mat.color.r);
    }
    gm.dispose();
  });

  it('the red look is clearly distinct from the ramp arrow yellow and the building exit marker', () => {
    const exit = new THREE.Color(BUILDING_EXIT_MARKER_COLOR);
    const arrow = new THREE.Color(RAMP_ARROW_COLOR);
    for (const red of [GHOST_UNREACHABLE_COLOR, GHOST_UNREACHABLE_RIM_COLOR]) {
      expect(hueDistance(hueDegrees(red), hueDegrees(exit))).toBeGreaterThanOrEqual(15);
      expect(hueDistance(hueDegrees(red), hueDegrees(arrow))).toBeGreaterThanOrEqual(30);
    }
  });

  it('flipping unreachable in place on the same id swaps the material on the SAME mesh (no recreation), both directions', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1, { unreachable: false })]);
    const meshBefore = scene.children[0] as THREE.Mesh;
    const blueMaterial = meshBefore.material;

    gm.sync([makePreview(1, { unreachable: true })]);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).toBe(meshBefore);
    expect(gm.count).toBe(1);
    expect(meshBefore.material).not.toBe(blueMaterial);
    expect((meshBefore.material as THREE.MeshPhongMaterial).color.r).toBeGreaterThan((meshBefore.material as THREE.MeshPhongMaterial).color.b);

    gm.sync([makePreview(1, { unreachable: false })]);
    expect(scene.children[0]).toBe(meshBefore);
    expect(meshBefore.material).toBe(blueMaterial);
    gm.dispose();
  });

  it('keeps the geometry when flipping (the mesh is not rebuilt)', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1)]);
    const mesh = scene.children[0] as THREE.Mesh;
    const geometry = mesh.geometry;
    gm.sync([makePreview(1, { unreachable: true })]);
    expect(mesh.geometry).toBe(geometry);
    gm.dispose();
  });

  it('red ghosts pulse inside the unreachable opacity range', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1, { unreachable: true })]);
    const mat = (scene.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;
    const { min, max } = peakOpacity(gm, mat);
    expect(max).toBeGreaterThan(min);
    expect(min).toBeGreaterThanOrEqual(GHOST_UNREACHABLE_OPACITY_MIN - 1e-9);
    expect(max).toBeLessThanOrEqual(GHOST_UNREACHABLE_OPACITY_MAX + 1e-9);
    gm.dispose();
  });

  it('red ghosts keep the fresnel rim, tinted with the red rim colour', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1, { unreachable: true })]);
    const mat = (scene.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;
    expect(typeof mat.onBeforeCompile).toBe('function');
    const shader = makeFakeShader();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mat.onBeforeCompile!(shader as any, {} as any);
    const rim = shader.uniforms.rimColor!.value as THREE.Color;
    expect(rim.r).toBeGreaterThan(rim.b);
    expect(rim.r).toBeGreaterThan(rim.g);
    expect(rim.equals(GHOST_UNREACHABLE_RIM_COLOR)).toBe(true);
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += rimColor * rimIntensity * rimFresnel * rimOpacityCompensation;');
    gm.dispose();
  });

  it('claimed previews are never red, even when flagged unreachable', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1, { claimed: true, unreachable: true }), makePreview(2, { claimed: true })]);
    const [flagged, plain] = scene.children as THREE.Mesh[];
    expect(flagged!.material).toBe(plain!.material);
    const mat = flagged!.material as THREE.MeshPhongMaterial;
    expect(mat.color.b).toBeGreaterThan(mat.color.r);
    gm.dispose();
  });

  it('a red ghost turns blue (claimed material) in place when it is claimed', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1, { unreachable: true })]);
    const mesh = scene.children[0] as THREE.Mesh;
    gm.sync([makePreview(1, { unreachable: true, claimed: true })]);
    expect(scene.children[0]).toBe(mesh);
    const mat = mesh.material as THREE.MeshPhongMaterial;
    expect(mat.color.b).toBeGreaterThan(mat.color.r);
    gm.dispose();
  });

  it('red and blue ghosts coexist: the red material is shared by red ghosts only', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1, { unreachable: true }), makePreview(2, { unreachable: true }), makePreview(3)]);
    const [a, b, c] = scene.children as THREE.Mesh[];
    expect(a!.material).toBe(b!.material);
    expect(a!.material).not.toBe(c!.material);
    gm.dispose();
  });

  it('dispose releases the red material too (a later sync-less dispose does not throw)', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1, { unreachable: true })]);
    const mat = (scene.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;
    let disposed = false;
    mat.addEventListener('dispose', () => { disposed = true; });
    gm.dispose();
    expect(disposed).toBe(true);
  });
});

describe('place_building ghost shows its own model as a hologram (#1306)', () => {
  const TYPE = 'management_office' as const;
  const TIER = 2 as const;
  const MODEL_ID = buildingModelId(TYPE, TIER);
  // Approach cell deliberately differs from the footprint origin: the model
  // must stand on the footprint, not on the cell the builder walks to.
  const building = { type: TYPE, tier: TIER, x: 20, z: 30 };
  const buildingPreview = (id: number, overrides: Partial<GhostPreview> = {}): GhostPreview => makePreview(id, {
    type: 'place_building',
    targetX: 18, targetZ: 29, targetY: 0,
    footprint: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]],
    building,
    ...overrides,
  });

  it('draws the building model, not a box, once the model is loaded', async () => {
    const library = await loadedModelLibrary([MODEL_ID]);
    const scene = new THREE.Scene();
    const gm = makeGhostMesh(scene, library);
    gm.sync([buildingPreview(1)]);
    const group = gm.getGroup(1)!;
    const meshes = meshesOf(group);
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) expect(mesh.geometry).not.toBeInstanceOf(THREE.BoxGeometry);
    gm.dispose();
  });

  it('every model mesh wears the shared ghost hologram material (the same one a plain unclaimed ghost uses)', async () => {
    const library = await loadedModelLibrary([MODEL_ID]);
    const scene = new THREE.Scene();
    const gm = makeGhostMesh(scene, library);
    gm.sync([buildingPreview(1), makePreview(2)]);
    const plain = gm.getGroup(2) as THREE.Mesh;
    const meshes = meshesOf(gm.getGroup(1)!);
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      expect(mesh.material).toBe(plain.material);
      const mat = mesh.material as THREE.MeshPhongMaterial;
      expect(mat.transparent).toBe(true);
      expect(typeof mat.onBeforeCompile).toBe('function');
    }
    gm.dispose();
  });

  it('stands exactly on the footprint cells the real building will occupy (same world x/z bounds as the real model)', async () => {
    const library = await loadedModelLibrary([MODEL_ID]);
    const scene = new THREE.Scene();
    const gm = makeGhostMesh(scene, library);
    gm.sync([buildingPreview(1)]);
    const ghostGroup = gm.getGroup(1)!;
    ghostGroup.updateMatrixWorld(true);
    const ghostBox = new THREE.Box3().setFromObject(ghostGroup);

    const realScene = new THREE.Scene();
    const real = new BuildingMesh(realScene, library);
    const realBuilding: Building = { id: 1, type: TYPE, tier: TIER, x: building.x, z: building.z, hp: 100, active: true, occupantIds: [] };
    real.addBuilding(realBuilding, 0);
    const realRoot = real.getInstance(1)!.root;
    realScene.updateMatrixWorld(true);
    const realBox = new THREE.Box3().setFromObject(realRoot);

    expect(ghostBox.min.x).toBeCloseTo(realBox.min.x, 3);
    expect(ghostBox.max.x).toBeCloseTo(realBox.max.x, 3);
    expect(ghostBox.min.z).toBeCloseTo(realBox.min.z, 3);
    expect(ghostBox.max.z).toBeCloseTo(realBox.max.z, 3);

    const { sizeX, sizeZ } = getDefSize(getBuildingDef(TYPE, TIER));
    expect(ghostBox.min.x).toBeGreaterThanOrEqual(building.x - 0.5 - 1e-6);
    expect(ghostBox.max.x).toBeLessThanOrEqual(building.x + sizeX - 0.5 + 1e-6);
    expect(ghostBox.min.z).toBeGreaterThanOrEqual(building.z - 0.5 - 1e-6);
    expect(ghostBox.max.z).toBeLessThanOrEqual(building.z + sizeZ - 0.5 + 1e-6);
    real.dispose();
    gm.dispose();
  });

  it('uses the ordered tier: a different tier draws different geometry', async () => {
    const library = await loadedModelLibrary([buildingModelId(TYPE, 1), buildingModelId(TYPE, 3)]);
    const scene = new THREE.Scene();
    const gm = makeGhostMesh(scene, library);
    gm.sync([
      buildingPreview(1, { building: { ...building, tier: 1 } }),
      buildingPreview(2, { building: { ...building, tier: 3 } }),
    ]);
    const vertexCount = (id: number) => meshesOf(gm.getGroup(id)!).reduce((n, m) => n + m.geometry.getAttribute('position').count, 0);
    expect(vertexCount(1)).toBeGreaterThan(0);
    expect(vertexCount(1)).not.toBe(vertexCount(2));
    gm.dispose();
  });

  it('while the model is not loaded the footprint box stands in, on the same footprint', () => {
    const scene = new THREE.Scene();
    const gm = makeGhostMesh(scene, new ModelLibrary());
    gm.sync([buildingPreview(1)]);
    const group = gm.getGroup(1)!;
    const meshes = meshesOf(group);
    expect(meshes).toHaveLength(1);
    expect(meshes[0]!.geometry).toBeInstanceOf(THREE.BoxGeometry);
    expect(meshes[0]!.material).toBeInstanceOf(THREE.MeshPhongMaterial);
    gm.dispose();
  });

  it('unreachable swaps the red variant in place on every model mesh, and back', async () => {
    const library = await loadedModelLibrary([MODEL_ID]);
    const scene = new THREE.Scene();
    const gm = makeGhostMesh(scene, library);
    gm.sync([buildingPreview(1)]);
    const group = gm.getGroup(1)!;
    const meshesBefore = meshesOf(group);
    const blue = meshesBefore[0]!.material;

    gm.sync([buildingPreview(1, { unreachable: true })]);
    expect(gm.getGroup(1)).toBe(group);
    expect(scene.children).toHaveLength(1);
    const meshesRed = meshesOf(group);
    expect(meshesRed).toHaveLength(meshesBefore.length);
    meshesRed.forEach((mesh, i) => {
      expect(mesh).toBe(meshesBefore[i]);
      expect(mesh.material).not.toBe(blue);
      const mat = mesh.material as THREE.MeshPhongMaterial;
      expect(mat.color.r).toBeGreaterThan(mat.color.b);
    });

    gm.sync([buildingPreview(1, { unreachable: false })]);
    for (const mesh of meshesOf(group)) expect(mesh.material).toBe(blue);
    gm.dispose();
  });

  it('a claimed building ghost is dimmer than an unclaimed one and never red', async () => {
    const library = await loadedModelLibrary([MODEL_ID]);
    const scene = new THREE.Scene();
    const gm = makeGhostMesh(scene, library);
    gm.sync([
      buildingPreview(1, { claimed: false }),
      buildingPreview(2, { claimed: true, unreachable: true, building: { ...building, x: 40 } }),
    ]);
    const unclaimed = meshesOf(gm.getGroup(1)!)[0]!.material as THREE.MeshPhongMaterial;
    const claimed = meshesOf(gm.getGroup(2)!)[0]!.material as THREE.MeshPhongMaterial;
    expect(claimed.color.b).toBeGreaterThan(claimed.color.r);
    let unclaimedMax = -Infinity;
    let claimedMax = -Infinity;
    for (let i = 0; i < 240; i++) {
      gm.update(1 / 60);
      unclaimedMax = Math.max(unclaimedMax, unclaimed.opacity);
      claimedMax = Math.max(claimedMax, claimed.opacity);
    }
    expect(claimedMax).toBeLessThan(unclaimedMax);
    gm.dispose();
  });

  it('removing the building ghost removes its whole model from the scene', async () => {
    const library = await loadedModelLibrary([MODEL_ID]);
    const scene = new THREE.Scene();
    const gm = makeGhostMesh(scene, library);
    gm.sync([buildingPreview(1)]);
    expect(scene.children.length).toBeGreaterThan(0);
    gm.sync([]);
    expect(gm.count).toBe(0);
    expect(scene.children).toHaveLength(0);
    gm.dispose();
  });

  it('a place_building preview without building info still draws the footprint box', () => {
    const scene = new THREE.Scene();
    const gm = makeGhostMesh(scene, new ModelLibrary());
    gm.sync([buildingPreview(1, { building: undefined })]);
    const meshes = meshesOf(gm.getGroup(1)!);
    expect(meshes).toHaveLength(1);
    expect(meshes[0]!.geometry).toBeInstanceOf(THREE.BoxGeometry);
    gm.dispose();
  });
});
