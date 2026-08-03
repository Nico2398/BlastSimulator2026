// BlastSimulator2026 — World border wall
//
// Marks the edge of the playable site. This replaces the shader's old
// boundary band, which darkened the ground in a 5m strip: that read as a
// smudge on the terrain rather than as a limit, and it was permanently
// visible whether or not the player cared where the edge was.
//
// The wall is a containment field standing on the site's perimeter. It is
// invisible in ordinary play and lights up only where the player is actually
// looking — the glow is a pool centred on the camera's view target, so
// approaching a corner lights that corner and nothing else. Nobody working in
// the middle of the pit ever sees it.

import * as THREE from 'three';
import type { Rect } from '../core/world/WorldGen.js';

/** Metres above the site's high point the field reaches. */
const WALL_HEIGHT = 22;
/** Metres below the low point the base is buried, so terrain always occludes its foot. */
const WALL_SINK = 25;

/**
 * How far the lit pool reaches, as a fraction of the site's shorter side.
 *
 * A fixed radius does not work across the level range: 78m lit the entire
 * perimeter of a 32m tutorial pit at once, which is a wall, not a hint. Tying
 * it to the site keeps the pool a local patch on every size.
 */
const GLOW_SPAN_FRACTION = 0.42;
const GLOW_FAR_MIN = 16;
const GLOW_FAR_MAX = 70;
/** Full brightness within this fraction of the outer radius. */
const GLOW_NEAR_FRACTION = 0.3;

const VERTEX_SHADER = /* glsl */`
varying vec3 vWorld;
varying float vUpFrac;
uniform float uBaseY;
uniform float uSpan;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vUpFrac = clamp((world.y - uBaseY) / uSpan, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT_SHADER = /* glsl */`
precision highp float;
varying vec3 vWorld;
varying float vUpFrac;

uniform vec3 uColor;
uniform vec3 uEdgeColor;
uniform vec3 uViewTarget;
uniform float uTime;
uniform float uGroundFrac;
uniform float uGlowNear;
uniform float uGlowFar;

// Nearest-cell offset on a hex lattice, used for the honeycomb.
vec2 hexCell(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 a = mod(p, r) - r * 0.5;
  vec2 b = mod(p - r * 0.5, r) - r * 0.5;
  return dot(a, a) < dot(b, b) ? a : b;
}
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}

void main() {
  // Distance from what the camera is looking at, measured on the ground plane
  // so the pool does not change size as the view tilts.
  float d = distance(vWorld.xz, uViewTarget.xz);
  float glow = 1.0 - smoothstep(uGlowNear, uGlowFar, d);
  if (glow <= 0.001) discard; // fully transparent away from the player's focus

  // Solid along the ground line, thinning as it rises so the field has no lid.
  float up = clamp((vUpFrac - uGroundFrac) / max(1.0 - uGroundFrac, 0.001), 0.0, 1.0);
  float height = pow(1.0 - up, 2.6);

  // Honeycomb cells, drifting slowly upward.
  vec2 cellUv = vec2(vWorld.x + vWorld.z, vWorld.y - uTime * 0.45) * 0.42;
  float cell = hexDist(hexCell(cellUv));
  float lattice = smoothstep(0.36, 0.5, cell);

  // A brighter band sweeping up the wall, so it reads as powered rather than painted.
  float sweep = exp(-pow((up - fract(uTime * 0.09)) * 5.5, 2.0));

  // Hard bright line where the field meets the ground.
  float footing = exp(-up * 26.0);

  // Deliberately faint: this is a hint at the limit of the site, not a
  // barrier the player has to look through to work.
  float a = glow * (height * (0.030 + 0.085 * lattice) + 0.06 * sweep * height + 0.11 * footing);
  vec3 col = mix(uColor, uEdgeColor, clamp(lattice * 0.8 + sweep * 0.6 + footing, 0.0, 1.0));

  gl_FragColor = vec4(col * (0.6 + 0.8 * glow), clamp(a, 0.0, 1.0));
}
`;

export interface WorldBorderWallOptions {
  rect: Rect;
  /** Lowest and highest terrain height across the site, in world units. */
  minGroundY: number;
  maxGroundY: number;
}

export class WorldBorderWall {
  private readonly scene: THREE.Scene;
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, options: WorldBorderWallOptions) {
    this.scene = scene;

    const { rect } = options;
    const baseY = options.minGroundY - WALL_SINK;
    const topY = options.maxGroundY + WALL_HEIGHT;
    const span = topY - baseY;
    // Where the ground sits within the wall's own vertical span, so the shader
    // can put its bright footing on the terrain line rather than at the buried
    // bottom edge.
    const groundFrac = (options.minGroundY - baseY) / span;

    const site = Math.min(rect.maxX - rect.minX, rect.maxZ - rect.minZ);
    const glowFar = Math.min(GLOW_FAR_MAX, Math.max(GLOW_FAR_MIN, site * GLOW_SPAN_FRACTION));

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uColor: { value: new THREE.Color(0xffb347) },
        uEdgeColor: { value: new THREE.Color(0xfff0c0) },
        uViewTarget: { value: new THREE.Vector3(0, 0, 0) },
        uTime: { value: 0 },
        uBaseY: { value: baseY },
        uSpan: { value: span },
        uGroundFrac: { value: groundFrac },
        uGlowNear: { value: glowFar * GLOW_NEAR_FRACTION },
        uGlowFar: { value: glowFar },
      },
      transparent: true,
      // Additive so the field adds light instead of tinting the terrain behind
      // it, and depth-write off so four coplanar-ish panels never fight.
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(buildWallGeometry(rect, baseY, topY), this.material);
    this.mesh.name = 'world-border-wall';
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** The wall's mesh, so the post pipeline can exclude it from the GTAO prepass. */
  get object3d(): THREE.Object3D {
    return this.mesh;
  }

  /**
   * `viewTarget` is the point the camera is looking at, not the camera itself.
   * Using the camera position would light the far border whenever the player
   * pulled back, which is the opposite of the intent.
   */
  update(dt: number, viewTarget: THREE.Vector3): void {
    const u = this.material.uniforms;
    u['uTime']!.value += dt;
    (u['uViewTarget']!.value as THREE.Vector3).copy(viewTarget);
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/** Four vertical panels, one per side of the rect, as a single geometry. */
function buildWallGeometry(rect: Rect, baseY: number, topY: number): THREE.BufferGeometry {
  const { minX, minZ, maxX, maxZ } = rect;
  const corners: [number, number][] = [
    [minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ],
  ];

  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x0, z0] = corners[i]!;
    const [x1, z1] = corners[(i + 1) % 4]!;
    const base = positions.length / 3;
    positions.push(
      x0, baseY, z0,
      x1, baseY, z1,
      x1, topY, z1,
      x0, topY, z0,
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
