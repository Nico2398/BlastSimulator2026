// TerrainMaterial — unit tests (#458 T4.1/D9/A19)
// Construction and onBeforeCompile injection must be exercisable without a
// browser: onBeforeCompile only runs at first WebGL render, so the material
// itself is Node-test safe (#458 A19 "Construct-time rule").

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TerrainMaterial } from '../../../src/renderer/terrain/TerrainMaterial.js';
import { getAllRocks } from '../../../src/core/world/RockCatalog.js';
import { getAllOres } from '../../../src/core/world/OreCatalog.js';

const PLAY_RECT = { minX: 10, minZ: 20, maxX: 74, maxZ: 148 };

function makeMaterial(): TerrainMaterial {
  return new TerrainMaterial({ playRect: PLAY_RECT });
}

describe('TerrainMaterial', () => {
  it('constructs without touching DOM/WebGL', () => {
    expect(() => makeMaterial()).not.toThrow();
  });

  it('is a MeshStandardMaterial with roughness 0.9 / metalness 0.0 (#458 A19 base)', () => {
    const mat = makeMaterial();
    expect(mat).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(mat.roughness).toBe(0.9);
    expect(mat.metalness).toBe(0.0);
  });

  it('uRockColor/uRockParams follow getAllRocks() order, sized with headroom (#458 A19.2)', () => {
    const mat = makeMaterial();
    const rocks = getAllRocks();
    const colors = mat.customUniforms['uRockColor']!.value as THREE.Color[];
    const params = mat.customUniforms['uRockParams']!.value as THREE.Vector4[];

    expect(colors.length).toBe(12); // getAllRocks() has 10 today; headroom to 12
    expect(params.length).toBe(12);

    for (let i = 0; i < rocks.length; i++) {
      const rock = rocks[i]!;
      expect(colors[i]!.getHex()).toBe(new THREE.Color(rock.color).getHex());
      expect(params[i]!.x).toBeCloseTo(rock.macroFreq, 6);
      expect(params[i]!.y).toBeCloseTo(rock.detailFreq, 6);
      expect(params[i]!.z).toBeCloseTo(rock.veinStrength, 6);
      expect(params[i]!.w).toBeCloseTo(rock.contrast, 6);
    }
    // Headroom slots beyond the real rock count still hold defined fallback values.
    for (let i = rocks.length; i < 12; i++) {
      expect(colors[i]).toBeInstanceOf(THREE.Color);
      expect(params[i]).toBeInstanceOf(THREE.Vector4);
    }
  });

  it('uOreColor follows getAllOres() order, sized with the same headroom convention (#458 A19.2)', () => {
    const mat = makeMaterial();
    const ores = getAllOres();
    const colors = mat.customUniforms['uOreColor']!.value as THREE.Color[];

    expect(colors.length).toBe(10); // getAllOres() has 8 today; headroom to 10
    for (let i = 0; i < ores.length; i++) {
      expect(colors[i]!.getHex()).toBe(new THREE.Color(ores[i]!.color).getHex());
    }
  });

  it('uPlayRect matches the constructor rect as (minX, minZ, maxX, maxZ)', () => {
    const mat = makeMaterial();
    const rect = mat.customUniforms['uPlayRect']!.value as THREE.Vector4;
    expect(rect.x).toBe(PLAY_RECT.minX);
    expect(rect.y).toBe(PLAY_RECT.minZ);
    expect(rect.z).toBe(PLAY_RECT.maxX);
    expect(rect.w).toBe(PLAY_RECT.maxZ);
  });

  it('uBandStrength and uCloudCoverage default to 0 — inert until T5.3/T7.1 (#458 T4.1 scope)', () => {
    const mat = makeMaterial();
    expect(mat.customUniforms['uBandStrength']!.value).toBe(0);
    expect(mat.customUniforms['uCloudCoverage']!.value).toBe(0);
    const offset = mat.customUniforms['uCloudOffset']!.value as THREE.Vector2;
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
  });

  it('customProgramCacheKey returns a constant string (#458 A19 injection mechanics)', () => {
    const mat = makeMaterial();
    expect(mat.customProgramCacheKey()).toBe(mat.customProgramCacheKey());
    expect(typeof mat.customProgramCacheKey()).toBe('string');
  });

  describe('onBeforeCompile injection', () => {
    function makeFakeShader(): THREE.WebGLProgramParametersWithUniforms {
      return {
        vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
        fragmentShader: '#include <common>\nvoid main() {\n#include <color_fragment>\n}',
        uniforms: {},
      } as unknown as THREE.WebGLProgramParametersWithUniforms;
    }

    it('copies customUniforms into shader.uniforms', () => {
      const mat = makeMaterial();
      const shader = makeFakeShader();
      mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
      expect(shader.uniforms['uPlayRect']).toBe(mat.customUniforms['uPlayRect']);
      expect(shader.uniforms['uRockColor']).toBe(mat.customUniforms['uRockColor']);
    });

    it('injects the vertex declarations and the instancing-aware vWorldPos assignment', () => {
      const mat = makeMaterial();
      const shader = makeFakeShader();
      mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);

      expect(shader.vertexShader).toContain('attribute float aRockA');
      expect(shader.vertexShader).toContain('varying vec3 vWorldPos');
      // Must branch on USE_INSTANCING: begin_vertex never applies instanceMatrix
      // itself, and the built-in worldpos_vertex chunk that does is compiled
      // out unless envmap/shadow/transmission are active (#458 T4.1 finding).
      expect(shader.vertexShader).toContain('#ifdef USE_INSTANCING');
      expect(shader.vertexShader).toContain('modelMatrix * instanceMatrix * vec4(transformed, 1.0)');
      expect(shader.vertexShader).toContain('modelMatrix * vec4(transformed, 1.0)');
      // Original include markers must still be present so three.js's own
      // chunk expansion still runs (we append after, never replace).
      expect(shader.vertexShader).toContain('#include <common>');
      expect(shader.vertexShader).toContain('#include <begin_vertex>');
    });

    it('injects the noise library, uniforms, and albedo block in place of <color_fragment>', () => {
      const mat = makeMaterial();
      const shader = makeFakeShader();
      mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);

      expect(shader.fragmentShader).toContain('float fbm3(vec3 p)');
      expect(shader.fragmentShader).toContain('uniform vec3 uRockColor[12]');
      expect(shader.fragmentShader).toContain('float boundaryBand(vec2 p)');
      expect(shader.fragmentShader).toContain('float cloudShadow(vec2 p)');
      expect(shader.fragmentShader).toContain('diffuseColor.rgb = col * cloudShadow(vWorldPos.xz) * boundaryBand(vWorldPos.xz)');
      expect(shader.fragmentShader).not.toContain('#include <color_fragment>');
    });
  });
});
