// BlastSimulator2026 — Shared THREE.js disposal/color helpers for renderer mesh factories.

import * as THREE from 'three';

/** Disposes geometry and material(s) of every Mesh/Line child of a group. */
export function disposeGroup(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        (child.material as THREE.Material).dispose();
      }
    }
  }
}

/**
 * Linearly brighten a packed hex color toward white.
 * @param hex   - e.g. 0xff6600
 * @param shift - 0 = unchanged, 1 = white
 */
export function brightenColor(hex: number, shift: number): number {
  if (shift <= 0) return hex;
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8)  & 0xff;
  const b =  hex        & 0xff;
  return (
    (Math.round(r + (0xff - r) * shift) << 16) |
    (Math.round(g + (0xff - g) * shift) << 8)  |
     Math.round(b + (0xff - b) * shift)
  );
}
