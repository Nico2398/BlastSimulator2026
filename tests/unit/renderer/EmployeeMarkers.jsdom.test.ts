// @vitest-environment jsdom
//
// EmployeeMarkers — the canvas path. The sibling suite (EmployeeMarkers.test.ts) runs in plain Node,
// where there is no `document` and a pin falls back to a flat role colour. A browser draws a real
// pin texture per role. jsdom has a `document` but no canvas implementation (its getContext returns
// null, as EmployeePictograms.jsdom.test.ts pins down), so the 2D context is a recording stand-in.

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { EmployeeMarkers, drawPin } from '../../../src/renderer/EmployeeMarkers.js';
import { ROLE_COLORS } from '../../../src/renderer/CharacterMesh.js';
import { OVERLAY_Y_KEY } from '../../../src/renderer/TaskProgressBar.js';

interface Call { op: string; args: unknown[] }

/** A 2D context that records every call and property set, in order. */
function recordingContext(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy({}, {
    get: (_target, prop: string) => (prop in props ? props[prop] : (...args: unknown[]) => { calls.push({ op: prop, args }); }),
    set: (_target, prop: string, value: unknown) => {
      props[prop] = value;
      calls.push({ op: `set:${prop}`, args: [value] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

/** The style each `fill` / `stroke` call drew with, in order. */
function paintedWith(calls: Call[]): { op: 'fill' | 'stroke'; style: unknown }[] {
  const out: { op: 'fill' | 'stroke'; style: unknown }[] = [];
  let fillStyle: unknown;
  let strokeStyle: unknown;
  for (const { op, args } of calls) {
    if (op === 'set:fillStyle') fillStyle = args[0];
    else if (op === 'set:strokeStyle') strokeStyle = args[0];
    else if (op === 'fill') out.push({ op, style: fillStyle });
    else if (op === 'stroke') out.push({ op, style: strokeStyle });
  }
  return out;
}

function makeAnchor(scene: THREE.Scene): THREE.Group {
  const anchor = new THREE.Group();
  anchor.userData[OVERLAY_Y_KEY] = 1.8;
  scene.add(anchor);
  return anchor;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('drawPin', () => {
  it('paints a dark line, then a white rim, then the role colour, then a white dot in the head', () => {
    const { ctx, calls } = recordingContext();

    drawPin(ctx, '#22cc88');

    expect(paintedWith(calls)).toEqual([
      { op: 'stroke', style: '#1c1420' },
      { op: 'stroke', style: '#ffffff' },
      { op: 'fill', style: '#22cc88' },
      { op: 'fill', style: '#ffffff' },
    ]);
  });

  it('starts from a clean canvas and traces one closed teardrop whose tip is the bottom centre', () => {
    const { ctx, calls } = recordingContext();

    drawPin(ctx, '#2266ff');

    expect(calls[0]!.op).toBe('clearRect');
    const moveTo = calls.find(c => c.op === 'moveTo')!;
    const [tipX, tipY] = moveTo.args as [number, number];
    expect(tipX).toBe(64);
    expect(tipY).toBeGreaterThan(110); // near the bottom of the 128 px canvas
    expect(tipY).toBeLessThan(128);
    expect(calls.filter(c => c.op === 'closePath')).toHaveLength(1);
    // The head arc goes the long way round, over the top: anticlockwise from one tangent to the other.
    const head = calls.find(c => c.op === 'arc')!;
    expect(head.args[5]).toBe(true);
  });

  it('keeps the head round and above the tip, so the pin points down', () => {
    const { ctx, calls } = recordingContext();

    drawPin(ctx, '#ffffff');

    const moveTo = calls.find(c => c.op === 'moveTo')!;
    const head = calls.find(c => c.op === 'arc')!;
    const [, headY, radius] = [head.args[0], head.args[1], head.args[2]] as [number, number, number];
    expect(headY + radius).toBeLessThan(moveTo.args[1] as number);
    expect(radius).toBeGreaterThan(0);
  });
});

describe('EmployeeMarkers with a canvas', () => {
  /** Hand every canvas the recording context, as a browser would hand it a real one. */
  function withCanvas(): void {
    const { ctx } = recordingContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
  }

  it('draws a pin texture instead of a flat colour, in sRGB, leaving the sprite colour white', () => {
    withCanvas();
    const scene = new THREE.Scene();
    const markers = new EmployeeMarkers(new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000));

    markers.sync([{ id: 1, role: 'surveyor' }], () => makeAnchor(scene));

    const material = markers.pinOf(1)!.material as THREE.SpriteMaterial;
    expect(material.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(material.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(material.color.getHex()).toBe(0xffffff);
    markers.dispose();
  });

  it('draws each role once and shares the texture between workers of that role', () => {
    withCanvas();
    const scene = new THREE.Scene();
    const markers = new EmployeeMarkers(new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000));

    markers.sync([
      { id: 1, role: 'surveyor' }, { id: 2, role: 'surveyor' }, { id: 3, role: 'driller' },
    ], () => makeAnchor(scene));

    const mapOf = (id: number) => (markers.pinOf(id)!.material as THREE.SpriteMaterial).map;
    expect(mapOf(1)).toBe(mapOf(2));
    expect(mapOf(3)).not.toBe(mapOf(1));
    markers.dispose();
  });

  it('releases the textures on dispose, once each', () => {
    withCanvas();
    const scene = new THREE.Scene();
    const markers = new EmployeeMarkers(new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000));
    markers.sync([{ id: 1, role: 'surveyor' }, { id: 2, role: 'manager' }], () => makeAnchor(scene));
    const textures = [1, 2].map(id => (markers.pinOf(id)!.material as THREE.SpriteMaterial).map!);
    const spies = textures.map(texture => vi.spyOn(texture, 'dispose'));

    markers.dispose();

    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it('falls back to the flat role colour where jsdom gives no 2D context at all', () => {
    const scene = new THREE.Scene();
    const markers = new EmployeeMarkers(new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000));

    markers.sync([{ id: 1, role: 'blaster' }], () => makeAnchor(scene));

    const material = markers.pinOf(1)!.material as THREE.SpriteMaterial;
    expect(material.map).toBeNull();
    expect(material.color.getHex()).toBe(ROLE_COLORS.blaster);
    markers.dispose();
  });
});
