// InstancedProp — instanced surfaces + outline from one prototype

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { InstancedProp, type InstancedPropOptions } from '../../../../src/renderer/models/InstancedProp.js';
import { ModelLibrary } from '../../../../src/renderer/models/ModelLibrary.js';
import { buildPrototype } from '../../../../src/renderer/models/ModelMerge.js';
import { createAmbientUniforms } from '../../../../src/renderer/ambient/AmbientUniforms.js';

function rockPrototype() {
  const scene = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'Body';
  const tint = new THREE.MeshStandardMaterial({ color: 0x808080 });
  tint.name = 'TintRock';
  const moss = new THREE.MeshStandardMaterial({ color: 0x338833 });
  moss.name = 'Moss';
  body.add(new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), tint), new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), moss));
  scene.add(body);
  return buildPrototype(scene);
}

describe('InstancedProp', () => {
  it('builds one InstancedMesh per surface plus the outline, all sharing a single instance-matrix buffer', () => {
    const lib = new ModelLibrary();
    const options: InstancedPropOptions = { count: 3, name: 'rocks' };
    const prop = new InstancedProp(rockPrototype(), lib, options);
    expect(prop.meshes.map(m => m.name).sort()).toEqual(['rocks', 'rocks', 'rocks-outline']);
    expect(prop.count).toBe(3);
    for (const mesh of prop.meshes) expect(mesh.instanceMatrix).toBe(prop.instanceMatrix);
    const m = new THREE.Matrix4().makeTranslation(5, 0, 7);
    prop.setMatrixAt(2, m);
    prop.commit();
    const read = new THREE.Matrix4();
    prop.meshes[0]!.getMatrixAt(2, read);
    expect(read.elements[12]).toBe(5);
    expect(read.elements[14]).toBe(7);
    expect(prop.instanceMatrix.needsUpdate || prop.instanceMatrix.version > 0).toBe(true);
  });

  it('tints only the Tint* surface, leaves painted surfaces alone, and applies the library material hook', () => {
    const lib = new ModelLibrary();
    const hooked: THREE.Material[] = [];
    lib.setMaterialSetup(mat => { hooked.push(mat); });
    const prop = new InstancedProp(rockPrototype(), lib, { count: 1, name: 'rocks', tint: new THREE.Color(0xff0000) });
    const surfaces = prop.meshes.filter(m => m.name === 'rocks');
    const colors = surfaces.map(m => (m.material as THREE.MeshToonMaterial).color.getHex()).sort();
    expect(colors).toContain(0xff0000);
    expect(colors).toContain(0xffffff); // painted (vertex-coloured) surface keeps white
    expect(hooked).toHaveLength(2); // both surfaces, never the hull
  });

  it('with sway, surfaces and outline read the same ambient uniforms', () => {
    const lib = new ModelLibrary();
    const ambient = createAmbientUniforms();
    const prop = new InstancedProp(rockPrototype(), lib, {
      count: 1, name: 'trees', sway: { uTime: ambient.uTime, uWind: ambient.uWind, canopyHeight: 4 },
    });
    const outline = prop.meshes.find(m => m.name === 'trees-outline')!;
    const om = outline.material as THREE.ShaderMaterial;
    expect(om.uniforms['uTime']).toBe(ambient.uTime);
    expect(om.uniforms['uWind']).toBe(ambient.uWind);
    expect(om.uniforms['uCanopyHeight']!.value).toBe(4);
    expect(om.vertexShader).toContain('instanceMatrix');
    // The toon surface splices sway in at compile time; its cache key names the canopy height.
    const surface = prop.meshes.find(m => m.name === 'trees')!.material as THREE.MeshToonMaterial;
    expect(surface.customProgramCacheKey()).toContain('sway-4');
    const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader: '#include <common>\n#include <begin_vertex>\n', fragmentShader: '' };
    surface.onBeforeCompile(shader as never, {} as never);
    expect(shader.uniforms['uWind']).toBe(ambient.uWind);
    expect(shader.vertexShader).toContain('transformed.xz += uWind * sway');
  });

  it('dispose removes every mesh from the scene and runs the hook teardowns', () => {
    const lib = new ModelLibrary();
    let torn = 0;
    lib.setMaterialSetup(() => () => { torn++; });
    const scene = new THREE.Scene();
    const prop = new InstancedProp(rockPrototype(), lib, { count: 2, name: 'rocks' });
    prop.addTo(scene);
    expect(scene.children).toHaveLength(3);
    prop.dispose(scene);
    expect(scene.children).toHaveLength(0);
    expect(torn).toBe(2);
  });
});
