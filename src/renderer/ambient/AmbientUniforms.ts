// BlastSimulator2026 — Shared ambient shader uniforms (#458 T7.2/D12/A26)
//
// One `{ uTime, uWind }` object, created once by GameRenderer and passed by
// reference into every ambient material's onBeforeCompile. Each material's
// compiled shader ends up holding the SAME uniform objects (not copies), so
// GameRenderer updating `.uTime.value`/`.uWind.value` once per frame reaches
// every material that referenced them — vegetation sway, and any future
// ambient module that needs wind/time, all move in lockstep for free.

import * as THREE from 'three';

export interface AmbientUniforms {
  uTime: THREE.IUniform<number>;
  uWind: THREE.IUniform<THREE.Vector2>;
}

export function createAmbientUniforms(): AmbientUniforms {
  return {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(0, 0) },
  };
}
