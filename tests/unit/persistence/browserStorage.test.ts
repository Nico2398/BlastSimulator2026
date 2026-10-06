import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveStorage } from '../../../src/persistence/browserStorage';

describe('resolveStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an explicit storage as-is', () => {
    const s = { a: 1 };
    expect(resolveStorage(s)).toBe(s);
  });

  it('returns explicit null without consulting localStorage', () => {
    vi.stubGlobal('localStorage', { marker: true });
    expect(resolveStorage(null)).toBeNull();
  });

  it('falls back to global localStorage when none is given', () => {
    const ls = { marker: true };
    vi.stubGlobal('localStorage', ls);
    expect(resolveStorage()).toBe(ls);
  });

  it('returns null when localStorage is undefined', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(resolveStorage()).toBeNull();
  });

  it('returns null when accessing localStorage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(resolveStorage()).toBeNull();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
