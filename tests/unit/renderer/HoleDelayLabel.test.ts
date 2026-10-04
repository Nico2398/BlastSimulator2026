// HoleDelayLabel — unit tests (#1420). Node env: no document, so the flat-colour fallback is exercised.

import { describe, it, expect } from 'vitest';
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
