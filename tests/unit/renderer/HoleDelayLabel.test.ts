// HoleDelayLabel — unit tests (#1420). Node env: no document, so the flat-colour fallback is exercised.

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { holeDelayLabelSpec, createHoleDelayLabel } from '../../../src/renderer/HoleDelayLabel.js';
import { BLAST_DELAY_LABEL_COLOR_BUCKET_MS, BLAST_DELAY_LABEL_COLORS } from '../../../src/core/config/balance.js';

describe('holeDelayLabelSpec', () => {
  it('formats the delay as "<n> ms"', () => {
    expect(holeDelayLabelSpec(25)!.text).toBe('25 ms');
  });

  it('treats 0 as a valid delay, not falsy', () => {
    expect(holeDelayLabelSpec(0)!.text).toBe('0 ms');
  });

  it('returns null for a negative (unsequenced) delay', () => {
    expect(holeDelayLabelSpec(-1)).toBeNull();
  });

  it('gives distinct texts for 25/50/75', () => {
    const texts = [25, 50, 75].map(d => holeDelayLabelSpec(d)!.text);
    expect(new Set(texts).size).toBe(3);
  });

  it('rounds fractional delays in the text', () => {
    expect(holeDelayLabelSpec(25.4)!.text).toBe('25 ms');
    expect(holeDelayLabelSpec(25.6)!.text).toBe('26 ms');
  });

  it('buckets colour at the 99/100 boundary', () => {
    expect(BLAST_DELAY_LABEL_COLOR_BUCKET_MS).toBe(100);
    expect(holeDelayLabelSpec(99)!.color).toBe(BLAST_DELAY_LABEL_COLORS[0]);
    expect(holeDelayLabelSpec(100)!.color).toBe(BLAST_DELAY_LABEL_COLORS[1]);
  });

  it('uses bucket index 4 at 400 and clamps beyond the ramp at 1000', () => {
    expect(holeDelayLabelSpec(400)!.color).toBe(BLAST_DELAY_LABEL_COLORS[4]);
    expect(holeDelayLabelSpec(1000)!.color).toBe(BLAST_DELAY_LABEL_COLORS[BLAST_DELAY_LABEL_COLORS.length - 1]);
  });

  it('cssColor matches the numeric colour', () => {
    const spec = holeDelayLabelSpec(100)!;
    expect(spec.cssColor.toLowerCase()).toBe('#' + spec.color.toString(16).padStart(6, '0'));
  });
});

describe('createHoleDelayLabel', () => {
  it('works without a document and records the text in userData', () => {
    expect(typeof document).toBe('undefined');
    const label = createHoleDelayLabel(holeDelayLabelSpec(25)!);
    expect(label).toBeInstanceOf(THREE.Mesh);
    expect(label.userData['delayLabelText']).toBe('25 ms');
  });

  it('is a flat plane, not a box', () => {
    const label = createHoleDelayLabel(holeDelayLabelSpec(50)!);
    expect(label.geometry).not.toBeInstanceOf(THREE.BoxGeometry);
  });
});

describe('createHoleDelayLabel canvas path', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function stubCanvas(textWidth: number) {
    const ctx = {
      fillStyle: '', font: '', textAlign: '', textBaseline: '',
      clearRect: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: textWidth })),
    };
    const canvas = { width: 0, height: 0, getContext: () => ctx };
    vi.stubGlobal('document', { createElement: () => canvas });
    return { ctx, canvas };
  }

  it('draws a short delay at the default font size with a canvas texture', () => {
    const { ctx, canvas } = stubCanvas(40);
    const label = createHoleDelayLabel(holeDelayLabelSpec(25)!);
    expect(canvas.width).toBe(128);
    expect(canvas.height).toBe(64);
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith('25 ms', 64, 32);
    expect(ctx.font).toBe('bold 38px sans-serif');
    expect(ctx.fillStyle).toBe(holeDelayLabelSpec(25)!.cssColor);
    const mat = label.material as THREE.MeshBasicMaterial;
    expect(mat.map).toBeInstanceOf(THREE.CanvasTexture);
    expect(label.userData['delayLabelText']).toBe('25 ms');
  });

  it('shrinks the font when the text is wider than the canvas padding', () => {
    const { ctx } = stubCanvas(224); // maxWidth 112 -> 38 * 112 / 224 = 19
    createHoleDelayLabel(holeDelayLabelSpec(12345)!);
    expect(ctx.font).toBe('bold 19px sans-serif');
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
  });

  it('never shrinks below the minimum font size', () => {
    const { ctx } = stubCanvas(100000);
    createHoleDelayLabel(holeDelayLabelSpec(12345)!);
    expect(ctx.font).toBe('bold 8px sans-serif');
  });
});
