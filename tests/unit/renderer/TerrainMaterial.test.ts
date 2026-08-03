// TerrainMaterial — unit tests (#458 T4.1/D9/A19)
// Construction and onBeforeCompile injection must be exercisable without a
// browser: onBeforeCompile only runs at first WebGL render, so the material
// itself is Node-test safe (#458 A19 "Construct-time rule").

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TerrainMaterial, COVER_BLEND_SKIP_SHARE } from '../../../src/renderer/terrain/TerrainMaterial.js';
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

  it('uCloudCoverage defaults to 0 — inert until T7.1 (#458 T4.1 scope)', () => {
    const mat = makeMaterial();
    expect(mat.customUniforms['uCloudCoverage']!.value).toBe(0);
    const offset = mat.customUniforms['uCloudOffset']!.value as THREE.Vector2;
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
  });

  it('no longer darkens the ground at the site edge — WorldBorderWall marks it', () => {
    // The band shaded a 5m strip of terrain, which read as a smudge rather
    // than a boundary and was on screen whether or not the player cared.
    const mat = makeMaterial();
    expect(mat.customUniforms['uBandStrength']).toBeUndefined();
    expect(mat.customUniforms['uPlayRect']).toBeUndefined();
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
        fragmentShader: '#include <common>\nvoid main() {\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_begin>\n}',
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
      expect(shader.fragmentShader).not.toContain('boundaryBand');
      expect(shader.fragmentShader).toContain('float cloudShadow(vec2 p)');
      expect(shader.fragmentShader).toContain('diffuseColor.rgb = clamp(col, 0.0, 1.0) * cloudShadow(vWorldPos.xz)');
      expect(shader.fragmentShader).not.toContain('#include <color_fragment>');
    });

    describe('surface shading', () => {
      // The original albedo modulated one flat rock colour by a single noise
      // value, so every surface shared a hue and only varied in brightness.
      // These pin the four things that replaced it.
      it('carries a world-space normal through to the fragment stage', () => {
        const mat = makeMaterial();
        const shader = makeFakeShader();
        mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);

        expect(shader.vertexShader).toContain('varying vec3 vWorldNormal');
        expect(shader.fragmentShader).toContain('varying vec3 vWorldNormal');
        // Instanced fragments are rotated per instance, so their normal has to
        // go through instanceMatrix or debris would shade as if world-aligned.
        expect(shader.vertexShader).toContain('mat3(instanceMatrix) * objectNormal');
      });

      it('splits shading by surface slope rather than treating all ground alike', () => {
        const mat = makeMaterial();
        const shader = makeFakeShader();
        mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
        expect(shader.fragmentShader).toContain('float flatness = smoothstep');
      });

      it('varies hue across the macro field instead of only brightness', () => {
        const mat = makeMaterial();
        const shader = makeFakeShader();
        mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
        expect(shader.fragmentShader).toContain('vec3(1.13, 0.99, 0.79)'); // warm crest tint
        expect(shader.fragmentShader).toContain('vec3(0.80, 0.89, 1.06)'); // cool hollow tint
        expect(shader.fragmentShader).toContain('rockCol = mix('); // the two tints are mixed, not just scaled
      });

      it('adds bedding planes that only show on exposed faces', () => {
        const mat = makeMaterial();
        const shader = makeFakeShader();
        mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
        // Multiplying by (1 - flatness) is what confines strata to cut faces.
        expect(shader.fragmentShader).toContain('(1.0 - flatness)');
      });

      it('perturbs the normal so the mesh triangulation stops reading through', () => {
        const mat = makeMaterial();
        const shader = makeFakeShader();
        mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);

        expect(shader.fragmentShader).toContain('vec3 vnoiseGrad(vec3 p, float e)');
        expect(shader.fragmentShader).not.toContain('#include <normal_fragment_begin>\n}');
        // viewMatrix, not normalMatrix: the gradient is world-space, and this
        // is what keeps it correct on rotated instances.
        expect(shader.fragmentShader).toContain('mat3(viewMatrix) * g');
      });

      it('modulates roughness so large lit areas do not turn into one sheen', () => {
        const mat = makeMaterial();
        const shader = makeFakeShader();
        mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
        expect(shader.fragmentShader).toContain('roughnessFactor = clamp(roughnessFactor');
      });

      it('bumps the program cache key so the old compiled shader is not reused', () => {
        const mat = makeMaterial();
        expect(mat.customProgramCacheKey()).toBe('terrain-material-v5');
      });
    });

    describe('cover-blend flat-colour skip for runner-up material (#475)', () => {
      // The runner-up cover used to always pay a full materialAlbedo() eval
      // (recipe + noise), even when its blend share was negligible. These pin
      // the cheap materialFlatColor() stand-in that replaces it once share
      // exceeds COVER_BLEND_SKIP_SHARE; below the threshold the blend is
      // skipped entirely and only the winner's colour shows.
      it('declares materialFlatColor(int i, ...) alongside materialAlbedo', () => {
        const mat = makeMaterial();
        const shader = makeFakeShader();
        mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);

        expect(shader.fragmentShader).toContain('vec3 materialFlatColor(int i');
      });

      it('the winner material still gets a full materialAlbedo(bestI, ...) evaluation', () => {
        const mat = makeMaterial();
        const shader = makeFakeShader();
        mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);

        expect(shader.fragmentShader).toContain('materialAlbedo(bestI');
      });

      it('the runner-up cover is shaded via materialFlatColor(secondI, ...), not materialAlbedo', () => {
        const mat = makeMaterial();
        const shader = makeFakeShader();
        mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);

        expect(shader.fragmentShader).toContain('materialFlatColor(secondI');
      });

      it('no longer unconditionally calls materialAlbedo(secondI, ...) for the runner-up (regression pin)', () => {
        const mat = makeMaterial();
        const shader = makeFakeShader();
        mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);

        expect(shader.fragmentShader).not.toContain('materialAlbedo(secondI');
      });

      it('gates the runner-up eval on share exceeding the exported COVER_BLEND_SKIP_SHARE constant', () => {
        const mat = makeMaterial();
        const shader = makeFakeShader();
        mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);

        expect(shader.fragmentShader).toContain(`share > ${COVER_BLEND_SKIP_SHARE}`);
      });
    });
  });

  describe('attachCSM (#458 T5.1/D11)', () => {
    function makeFakeShader(): THREE.WebGLProgramParametersWithUniforms {
      return {
        vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
        fragmentShader: '#include <common>\nvoid main() {\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_begin>\n}',
        uniforms: {},
      } as unknown as THREE.WebGLProgramParametersWithUniforms;
    }

    function makeFakeCSM(cascades = 3) {
      return {
        cascades,
        maxFar: 1200,
        camera: { near: 0.5, far: 4000 },
        getExtendedBreaks: (target: THREE.Vector2[]) => {
          target.length = 0;
          target.push(new THREE.Vector2(0, 1));
        },
        shaders: new Map(),
      };
    }

    it('sets USE_CSM/CSM_CASCADES defines matching the CSM instance', () => {
      const mat = makeMaterial();
      const csm = makeFakeCSM(4);
      mat.attachCSM(csm as any);
      expect(mat.defines?.['USE_CSM']).toBe(1);
      expect(mat.defines?.['CSM_CASCADES']).toBe(4);
    });

    it('composes with the existing onBeforeCompile rather than replacing it — A19 albedo still runs', () => {
      const mat = makeMaterial();
      mat.attachCSM(makeFakeCSM() as any);

      const shader = makeFakeShader();
      mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);

      // A19's own injection still ran — this would fail if attachCSM had
      // replaced onBeforeCompile instead of wrapping it.
      expect(shader.fragmentShader).toContain('float fbm3(vec3 p)');
      expect(shader.fragmentShader).toContain('cloudShadow(vWorldPos.xz)');
      // ...and the CSM uniforms it needs got added on top.
      expect(shader.uniforms['CSM_cascades']).toBeDefined();
      expect(shader.uniforms['cameraNear']).toEqual({ value: 0.5 });
      // shadowFar = min(camera.far, maxFar) — the fake CSM's maxFar (1200) is
      // tighter than camera.far (4000), so the cap applies here too.
      expect(shader.uniforms['shadowFar']).toEqual({ value: 1200 });
    });

    it('registers the compiled shader with csm.shaders so csm.updateUniforms() can refresh it', () => {
      const mat = makeMaterial();
      const csm = makeFakeCSM();
      mat.attachCSM(csm as any);

      const shader = makeFakeShader();
      mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);

      expect(csm.shaders.get(mat)).toBe(shader);
    });

    it('caps shadowFar at csm.maxFar even when camera.far is larger', () => {
      const mat = makeMaterial();
      const csm = makeFakeCSM();
      csm.camera.far = 9000; // exceeds maxFar
      mat.attachCSM(csm as any);

      const shader = makeFakeShader();
      mat.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
      expect(shader.uniforms['shadowFar']).toEqual({ value: csm.maxFar });
    });
  });
});
