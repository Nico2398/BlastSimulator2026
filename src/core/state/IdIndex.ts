// BlastSimulator2026 — id lookup over the game's append-or-splice arrays (#1603)
//
// Fragments, pending actions and ghost previews live in plain arrays that only
// ever grow at the end (a push) or lose an element (a splice), or are replaced
// wholesale. Finding one by id is a linear scan, and a per-tick pass that
// rebuilt a Map of thousands of them to look a few up — after a large blast —
// spent a frame's budget on the map alone. This index outlives the pass and
// is checked on every lookup instead: any membership change moves the array's
// length or its last id (ids are never reused), which triggers a rebuild, and
// every hit is checked against the element actually at its position.

interface IdIndex {
  idOf: (item: never) => number;
  length: number;
  lastId: number | undefined;
  positions: Map<number, number>;
}

const indexes = new WeakMap<readonly unknown[], IdIndex>();

/**
 * The first element of `items` whose `idOf` is `id` — exactly what
 * `items.find(item => idOf(item) === id)` returns — in O(1) between
 * membership changes. `idOf` should be one stable function per array.
 */
export function findById<T>(items: readonly T[], idOf: (item: T) => number, id: number): T | undefined {
  let at = positionsOf(items, idOf).get(id);
  if (at !== undefined && idOf(items[at]!) !== id) at = rebuild(items, idOf).get(id);
  return at === undefined ? undefined : items[at];
}

function positionsOf<T>(items: readonly T[], idOf: (item: T) => number): Map<number, number> {
  const index = indexes.get(items);
  const last = items[items.length - 1];
  if (index !== undefined && index.idOf === idOf && index.length === items.length
    && index.lastId === (last === undefined ? undefined : idOf(last))) return index.positions;
  return rebuild(items, idOf);
}

function rebuild<T>(items: readonly T[], idOf: (item: T) => number): Map<number, number> {
  const positions = new Map<number, number>();
  items.forEach((item, at) => {
    const id = idOf(item);
    if (!positions.has(id)) positions.set(id, at);
  });
  const last = items[items.length - 1];
  indexes.set(items, {
    idOf: idOf as (item: never) => number,
    length: items.length,
    lastId: last === undefined ? undefined : idOf(last),
    positions,
  });
  return positions;
}
