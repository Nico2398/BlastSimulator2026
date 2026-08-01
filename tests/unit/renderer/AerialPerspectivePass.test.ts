// AerialPerspectivePass — unit tests (#458 T5.2)

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AerialPerspectivePass, BIOME_GRADES, NEUTRAL_GRADE } from '../../../src/renderer/post/AerialPerspectivePass.js';

function makePass(): AerialPerspectivePass {
  const depthTexture = new THREE.DepthTexture(64, 64);
  return new AerialPerspectivePass(depthTexture);
}

describe('AerialPerspectivePass (#458 T5.2/A21)', () => {
  it('wires the given depth texture into the tDepth uniform', () => {
    const depthTexture = new THREE.DepthTexture(64, 64);
    const pass = new AerialPerspectivePass(depthTexture);
    expect(pass.uniforms['tDepth']!.value).toBe(depthTexture);
  });

  it('defaults to the neutral grade and a sky-blue haze color', () => {
    const pass = makePass();
    expect(pass.uniforms['uGamma']!.value).toBe(NEUTRAL_GRADE.gamma);
    expect((pass.uniforms['uGain']!.value as THREE.Vector3).equals(NEUTRAL_GRADE.gain)).toBe(true);
    expect((pass.uniforms['uLift']!.value as THREE.Vector3).equals(NEUTRAL_GRADE.lift)).toBe(true);
    expect((pass.uniforms['uHazeColor']!.value as THREE.Color).getHex()).toBe(0x87ceeb);
  });

  it('setGrade() copies gamma/gain/lift from a BiomeGrade without swapping object identity', () => {
    const pass = makePass();
    const gainUniform = pass.uniforms['uGain']!.value as THREE.Vector3;
    const desert = BIOME_GRADES['desert_badlands']!;
    pass.setGrade(desert);
    expect(pass.uniforms['uGamma']!.value).toBe(desert.gamma);
    expect(gainUniform.equals(desert.gain)).toBe(true);
    expect(gainUniform).not.toBe(desert.gain); // copied, not aliased
  });

  it('setHeightRef() sets uHeightRef verbatim', () => {
    const pass = makePass();
    pass.setHeightRef(42.5);
    expect(pass.uniforms['uHeightRef']!.value).toBe(42.5);
  });

  it('setHazeColor() copies into the uHazeColor uniform without aliasing the input', () => {
    const pass = makePass();
    const color = new THREE.Color(0x223344);
    pass.setHazeColor(color);
    expect((pass.uniforms['uHazeColor']!.value as THREE.Color).getHex()).toBe(0x223344);
    expect(pass.uniforms['uHazeColor']!.value).not.toBe(color);
  });

  it('update() sets uProjInv to the inverse of the camera projection matrix', () => {
    const pass = makePass();
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000);
    camera.updateProjectionMatrix();
    pass.update(camera);
    const expected = camera.projectionMatrix.clone().invert();
    const actual = pass.uniforms['uProjInv']!.value as THREE.Matrix4;
    expect(actual.toArray()).toEqual(expected.toArray());
  });

  it('update() sets uViewInv to the camera world matrix (inverse of the view matrix)', () => {
    const pass = makePass();
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000);
    camera.position.set(10, 20, 30);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    pass.update(camera);
    const actual = pass.uniforms['uViewInv']!.value as THREE.Matrix4;
    expect(actual.toArray()).toEqual(camera.matrixWorld.toArray());
  });

  it('BIOME_GRADES has an entry for every biome the art pass has tuned, and omits red_canyon/green_foothills (fall back to NEUTRAL_GRADE)', () => {
    expect(Object.keys(BIOME_GRADES).sort()).toEqual(
      ['alpine_granite', 'desert_badlands', 'tropical_karst', 'volcanic_flats'].sort(),
    );
    expect(BIOME_GRADES['red_canyon']).toBeUndefined();
    expect(BIOME_GRADES['green_foothills']).toBeUndefined();
  });
});
