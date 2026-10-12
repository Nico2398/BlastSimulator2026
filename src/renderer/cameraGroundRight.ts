// BlastSimulator2026 — The camera's right-hand direction on the ground
// What a listener needs to pan a sound left or right: the camera's local +X axis flattened onto the
// ground plane and made a unit vector. Read from the world matrix's rotation only, so the shake that
// jitters the camera's position during a blast cannot wobble it.

/** The camera looks straight up or down, or its matrix is degenerate: pan to the screen's natural right. */
const FALLBACK_RIGHT: GroundDirection = { x: 1, z: 0 };

/** Below this length the flattened axis carries no direction. */
const MIN_AXIS_LENGTH = 1e-6;

interface GroundDirection {
  readonly x: number;
  readonly z: number;
}

/**
 * Unit right vector on the x/z ground plane of a camera whose world matrix is `matrixWorld` (column-major,
 * the layout of `THREE.Matrix4.elements`: the first column is the camera's local +X axis in world space).
 */
export function cameraGroundRight(matrixWorld: ArrayLike<number>): GroundDirection {
  const x = matrixWorld[0] ?? 0;
  const z = matrixWorld[2] ?? 0;
  const length = Math.hypot(x, z);
  if (!Number.isFinite(length) || length < MIN_AXIS_LENGTH) return FALLBACK_RIGHT;
  return { x: x / length, z: z / length };
}
