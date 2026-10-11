// IdIndex — findById answers exactly what a linear find answers, across
// every way the game's arrays change between lookups (#1603).

import { describe, it, expect } from 'vitest';
import { findById } from '../../../src/core/state/IdIndex.js';

interface Item { id: number; tag: string }
const idOf = (item: Item): number => item.id;
const item = (id: number, tag = `#${id}`): Item => ({ id, tag });
const find = (items: Item[], id: number) => items.find(i => i.id === id);

describe('findById', () => {
  it('returns the very element a linear find returns, and undefined for an unknown id', () => {
    const items = [item(1), item(2), item(3)];
    expect(findById(items, idOf, 2)).toBe(items[1]);
    expect(findById(items, idOf, 9)).toBeUndefined();
    expect(findById([], idOf, 1)).toBeUndefined();
  });

  it('keeps the first occurrence of a duplicated id, like find', () => {
    const items = [item(7, 'first'), item(7, 'second')];
    expect(findById(items, idOf, 7)?.tag).toBe('first');
  });

  it('sees pushes, splices, and a splice plus a push that keeps the length', () => {
    const items = [item(1), item(2), item(3)];
    expect(findById(items, idOf, 3)).toBe(items[2]);
    items.push(item(4));
    expect(findById(items, idOf, 4)).toBe(items[3]);
    items.splice(0, 1);
    expect(findById(items, idOf, 1)).toBeUndefined();
    expect(findById(items, idOf, 3)).toBe(find(items, 3));
    items.splice(1, 1);
    items.push(item(5));
    for (const id of [1, 2, 3, 4, 5]) expect(findById(items, idOf, id), `id ${id}`).toBe(find(items, id));
  });

  it('matches a linear find over a long random sequence of edits', () => {
    const items: Item[] = [];
    let nextId = 1;
    let seed = 1603;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let step = 0; step < 2000; step++) {
      if (items.length === 0 || rand(3) > 0) items.push(item(nextId++));
      else items.splice(rand(items.length), 1);
      const probe = 1 + rand(nextId);
      expect(findById(items, idOf, probe), `step ${step}, id ${probe}`).toBe(find(items, probe));
    }
  });

  it('keeps one index per array, so separate arrays never answer for each other', () => {
    const a = [item(1, 'a')];
    const b = [item(1, 'b')];
    expect(findById(a, idOf, 1)?.tag).toBe('a');
    expect(findById(b, idOf, 1)?.tag).toBe('b');
  });

  it('re-indexes when the same array is read through a different id', () => {
    const items = [item(1, 'x'), item(2, 'y')];
    expect(findById(items, idOf, 2)?.tag).toBe('y');
    const byTagLength = (i: Item) => i.tag.length * 10 + i.id;
    expect(findById(items, byTagLength, 12)?.tag).toBe('y');
  });
});
