import { describe, it, expect } from 'vitest';
import { isSelected } from '../../../src/ui/selectionRoute.js';

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
