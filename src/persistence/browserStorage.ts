// BlastSimulator2026 — shared localStorage resolution that never throws.

/** An explicit storage (including null) wins; otherwise localStorage, or null when absent or blocked. */
export function resolveStorage<S extends object>(storage?: S | null): S | null {
  if (storage !== undefined) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : (localStorage as unknown as S);
  } catch {
    return null;
  }
}
