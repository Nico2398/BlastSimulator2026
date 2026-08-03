// BlastSimulator2026 — Water surfaces: river strips + lake discs from
// StructureSet, animated ripple/sparkle, bank foam (#458 T7.2/D12/A26)
//
// Follows TerrainMaterial's own convention (#458 A19): animated noise
// modulates diffuse color/emissive rather than perturbing the lighting
// normal — nothing else in this renderer does true normal-mapping either,
// and it reads convincingly as moving water at this scale without the extra
// derivative math a real normal perturbation needs.

import * as THREE from 'three';
import type { RiverPath, Landmark } from '../../core/world/Structures.js';
import type { WindVector } from './WindState.js';

const FOAM_BAND_METRES = 1.0;
const FLOW_SPEED = 0.4; // m/s, the river's own downstream scroll
const WIND_SCROLL_FACTOR = 0.2;
const LAKE_SEGMENTS = 24;
/** Foam opacity pulses slowly so the bank line doesn't look static. */
const FOAM_PULSE_SPEED = 1.3;
const FOAM_PULSE_AMOUNT = 0.15;

const BIOME_WATER_COLOR: Record<string, number> = {
  desert_badlands: 0x4a7a8c,
  red_canyon: 0x3f7288,
  alpine_granite: 0x5c9fc9,
  green_foothills: 0x3d8f7a,
  tropical_karst: 0x2fa6a1,
  volcanic_flats: 0x36707a,
};
const DEFAULT_WATER_COLOR = 0x4a7a8c;

const NOISE_GLSL = `
float hash13w(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
float vnoisew(vec3 p){
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13w(i), hash13w(i+vec3(1,0,0)), f.x), mix(hash13w(i+vec3(0,1,0)), hash13w(i+vec3(1,1,0)), f.x), f.y),
    mix(mix(hash13w(i+vec3(0,0,1)), hash13w(i+vec3(1,0,1)), f.x), mix(hash13w(i+vec3(0,1,1)), hash13w(i+vec3(1,1,1)), f.x), f.y),
    f.z);
}
`;

const FRAGMENT_EXTRA = `
${NOISE_GLSL}
uniform vec2 uFlowOffset;
uniform float uTime;
uniform float uFoamPulse;
varying vec3 vWorldPos;
varying float vFoam;
`;

const ALBEDO_GLSL = `
vec2 p = vWorldPos.xz * 0.08 + uFlowOffset;
float ripple = vnoisew(vec3(p, 0.0)) * 0.5 + vnoisew(vec3(p * 2.1, 3.0)) * 0.3;
vec3 col = diffuseColor.rgb * (0.9 + 0.2 * ripple);
float sparkle = step(0.97, vnoisew(vec3(vWorldPos.xz * 8.0 + uFlowOffset * 3.0, uTime)));
diffuseColor.rgb = mix(col, vec3(1.0), sparkle * 0.6);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vFoam * (0.85 + uFoamPulse));
`;

const VERTEX_EXTRA = `
varying vec3 vWorldPos;
varying float vFoam;
attribute float aFoam;
`;

const VERTEX_BEGIN_EXTRA = `
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vFoam = aFoam;
`;

interface RiverPolyResult {
  positions: number[];
  foam: number[];
  indices: number[];
}

/**
 * Triangulated strip along a river's centreline: 4 vertices per ring (left
 * edge, left inner, right inner, right edge). Foam is 1 only at the two edge
 * vertices and 0 at the inner pair placed FOAM_BAND_METRES in from each
 * edge, so linear interpolation across a triangle confines the foam gradient
 * to that outer band instead of smearing it across the whole channel width —
 * a wide river reads as open water in the middle, foam only at the banks.
 */
function buildRiverStrip(river: RiverPath): RiverPolyResult | null {
  const { points, widths, waterLevels } = river;
  if (points.length < 2) return null;

  const positions: number[] = [];
  const foam: number[] = [];
  const ringCount = points.length;

  for (let i = 0; i < ringCount; i++) {
    const p = points[i]!;
    const w = widths[i] ?? 0;
    const y = waterLevels[i] ?? 0;
    // Inner band can't cross past the centreline on a narrow channel.
    const innerW = Math.max(0, w - FOAM_BAND_METRES);

    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(ringCount - 1, i + 1)]!;
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const perpX = -dz / len;
    const perpZ = dx / len;

    positions.push(p.x + perpX * w, y, p.z + perpZ * w);       // left edge
    foam.push(1);
    positions.push(p.x + perpX * innerW, y, p.z + perpZ * innerW); // left inner
    foam.push(0);
    positions.push(p.x - perpX * innerW, y, p.z - perpZ * innerW); // right inner
    foam.push(0);
    positions.push(p.x - perpX * w, y, p.z - perpZ * w);       // right edge
    foam.push(1);
  }

  const indices: number[] = [];
  for (let i = 0; i < ringCount - 1; i++) {
    const base = i * 4;
    const next = (i + 1) * 4;
    // Three quads per segment: left-edge band, open middle, right-edge band.
    for (let v = 0; v < 3; v++) {
      indices.push(base + v, next + v, base + v + 1, base + v + 1, next + v, next + v + 1);
    }
  }

  return { positions, foam, indices };
}

/** Flat disc fan for a crater-lake landmark. */
function buildLakeDisc(cx: number, cz: number, radius: number, y: number): RiverPolyResult {
  const positions: number[] = [cx, y, cz];
  const foam: number[] = [0];
  for (let i = 0; i <= LAKE_SEGMENTS; i++) {
    const a = (i / LAKE_SEGMENTS) * Math.PI * 2;
    positions.push(cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius);
    foam.push(1); // rim reads as bank/foam
  }
  const indices: number[] = [];
  for (let i = 1; i <= LAKE_SEGMENTS; i++) {
    indices.push(0, i, i + 1);
  }
  return { positions, foam, indices };
}

function mergePolyResults(parts: readonly RiverPolyResult[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const foam: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;

  for (const part of parts) {
    positions.push(...part.positions);
    foam.push(...part.foam);
    for (const idx of part.indices) indices.push(idx + vertexOffset);
    vertexOffset += part.positions.length / 3;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aFoam', new THREE.Float32BufferAttribute(foam, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export class WaterSurface {
  private readonly scene: THREE.Scene;
  private readonly mesh: THREE.Mesh | null = null;
  private readonly material: THREE.MeshStandardMaterial | null = null;
  private time = 0;
  private readonly flowOffset = new THREE.Vector2(0, 0);

  constructor(
    scene: THREE.Scene,
    biomeId: string,
    rivers: readonly RiverPath[],
    landmarks: readonly Landmark[],
  ) {
    this.scene = scene;

    const parts: RiverPolyResult[] = [];
    for (const river of rivers) {
      const strip = buildRiverStrip(river);
      if (strip) parts.push(strip);
    }
    for (const landmark of landmarks) {
      if (landmark.kind !== 'crater_lake' || landmark.waterLevel === undefined) continue;
      parts.push(buildLakeDisc(landmark.x, landmark.z, landmark.radius, landmark.waterLevel));
    }

    if (parts.length === 0) return; // nothing to render this level — mesh stays null

    const geo = mergePolyResults(parts);
    const color = BIOME_WATER_COLOR[biomeId] ?? DEFAULT_WATER_COLOR;

    this.material = new THREE.MeshStandardMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      roughness: 0.15,
      metalness: 0.0,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms['uFlowOffset'] = { value: this.flowOffset };
      shader.uniforms['uTime'] = { value: 0 };
      shader.uniforms['uFoamPulse'] = { value: 0 };
      this.shaderUniforms = shader.uniforms;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_EXTRA}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BEGIN_EXTRA}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_EXTRA}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${ALBEDO_GLSL}`);
    };
    this.material.customProgramCacheKey = () => 'water-surface-v1';

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'water-surface';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.scene.add(this.mesh);
  }

  private shaderUniforms: Record<string, THREE.IUniform> | null = null;

  update(dt: number, wind: WindVector): void {
    if (!this.mesh) return;
    this.time += dt;
    this.flowOffset.x += wind.x * WIND_SCROLL_FACTOR * dt;
    this.flowOffset.y += (FLOW_SPEED + wind.z * WIND_SCROLL_FACTOR) * dt;
    if (this.shaderUniforms) {
      this.shaderUniforms['uTime']!.value = this.time;
      this.shaderUniforms['uFoamPulse']!.value = FOAM_PULSE_AMOUNT * Math.sin(this.time * FOAM_PULSE_SPEED);
    }
  }

  dispose(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material!.dispose();
  }
}

// Re-export for tests that want to exercise the pure geometry builders directly.
export { buildRiverStrip as _buildRiverStrip, buildLakeDisc as _buildLakeDisc, FOAM_BAND_METRES };
