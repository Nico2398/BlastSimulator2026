// BlastSimulator2026 — 3D vector type and pure operations
// All functions are pure: no mutation, always returns a new Vec3.

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Create a Vec3. */
export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export const ZERO: Vec3 = vec3(0, 0, 0);

export function add(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function scale(v: Vec3, s: number): Vec3 {
  return vec3(v.x * s, v.y * s, v.z * s);
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return vec3(
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );
}

export function length(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len === 0) return ZERO;
  return scale(v, 1 / len);
}

/** Linear interpolation between a and b by factor t ∈ [0, 1]. */
export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return vec3(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  );
}

/** Clamp each component of v between min and max. */
export function clamp(v: Vec3, min: Vec3, max: Vec3): Vec3 {
  return vec3(
    Math.max(min.x, Math.min(max.x, v.x)),
    Math.max(min.y, Math.min(max.y, v.y)),
    Math.max(min.z, Math.min(max.z, v.z)),
  );
}

/** Component-wise equality check. */
export function equals(a: Vec3, b: Vec3): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
