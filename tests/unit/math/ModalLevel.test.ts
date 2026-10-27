import { describe, it, expect } from 'vitest';
import { modalLevel, nearestLevel } from '../../../src/core/math/ModalLevel.js';

describe('modalLevel (#2045)', () => {
  it('is the level most heights share, not the lowest: a hole bottom beside a floor is not the floor', () => {
    expect(modalLevel([2.5, 0.5, 2.5], 0.5)).toBe(2.5);
  });

  it('is not the highest either: a lump beside a floor is not the floor', () => {
    expect(modalLevel([9.5, 11.5, 9.5], 0.5)).toBe(9.5);
  });

  it('groups heights within the tolerance of a level\'s lowest into that level and names it by its lowest', () => {
    expect(modalLevel([3.1, 3.4, 0.5, 3.2], 0.5)).toBe(3.1);
  });

  it('a height just past the tolerance starts another level', () => {
    expect(modalLevel([1, 1.51, 1.51], 0.5)).toBe(1.51);
    expect(modalLevel([1, 1.5, 1.5], 0.5)).toBe(1);
  });

  it('takes the lower level on a tie, and the lowest when every height stands alone', () => {
    expect(modalLevel([6, 2, 6, 2], 0.5)).toBe(2);
    expect(modalLevel([7.5, 4.5, 5.5], 0.5)).toBe(4.5);
  });

  it('skips non-finite heights, and is NaN when none is finite', () => {
    expect(modalLevel([NaN, 6, Infinity], 0.5)).toBe(6);
    expect(Number.isNaN(modalLevel([], 0.5))).toBe(true);
    expect(Number.isNaN(modalLevel([NaN], 0.5))).toBe(true);
  });
});

describe('nearestLevel (#2045)', () => {
  it('is the level nearest the aim, however few heights it holds', () => {
    expect(nearestLevel([0.5, 2.5, 2.5], 0.5, 0.7)).toBe(0.5);
    expect(nearestLevel([0.5, 2.5, 2.5], 0.5, 2.2)).toBe(2.5);
  });

  it('on a tie in distance, the level more heights share, then the lower', () => {
    expect(nearestLevel([9.5, 11.5, 9.5], 0.5, 10.5)).toBe(9.5);
    expect(nearestLevel([9.5, 11.5], 0.5, 10.5)).toBe(9.5);
  });

  it('is the modal level without a finite aim, and NaN with no finite height', () => {
    expect(nearestLevel([2.5, 0.5, 2.5], 0.5, NaN)).toBe(2.5);
    expect(Number.isNaN(nearestLevel([NaN], 0.5, 1))).toBe(true);
  });
});
