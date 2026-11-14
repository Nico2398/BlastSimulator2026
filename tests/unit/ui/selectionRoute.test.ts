import { describe, it, expect } from 'vitest';
import { isSelected, selectionChanged, type ListSelection } from '../../../src/ui/selectionRoute.js';

describe('selectionRoute.isSelected (#1759)', () => {
  it('is true when kind and id both match', () => {
    expect(isSelected({ kind: 'building', id: 3 }, 'building', 3)).toBe(true);
  });

  it('is false for null selection', () => {
    expect(isSelected(null, 'building', 3)).toBe(false);
  });

  it('is false when the id differs', () => {
    expect(isSelected({ kind: 'building', id: 3 }, 'building', 4)).toBe(false);
  });

  it('is false when the kind differs but the id matches', () => {
    expect(isSelected({ kind: 'vehicle', id: 3 }, 'building', 3)).toBe(false);
  });

  it('treats id 0 as a real id', () => {
    expect(isSelected({ kind: 'building', id: 0 }, 'building', 0)).toBe(true);
    expect(isSelected(null, 'building', 0)).toBe(false);
  });
});

describe('selectionRoute with an order selection (#2266)', () => {
  const order: ListSelection = { kind: 'order', id: 12 };

  it('is a valid ListSelection that isSelected matches by kind and id', () => {
    expect(isSelected(order, 'order', 12)).toBe(true);
  });

  it('does not match another order, or another kind with the same id', () => {
    expect(isSelected(order, 'order', 13)).toBe(false);
    expect(isSelected(order, 'building', 12)).toBe(false);
    expect(isSelected({ kind: 'building', id: 12 }, 'order', 12)).toBe(false);
  });

  it('selectionChanged tells an order from nothing, from another order and from another kind', () => {
    expect(selectionChanged(order, { kind: 'order', id: 12 })).toBe(false);
    expect(selectionChanged(order, null)).toBe(true);
    expect(selectionChanged(order, { kind: 'order', id: 13 })).toBe(true);
    expect(selectionChanged(order, { kind: 'hole', id: 12 })).toBe(true);
  });
});
