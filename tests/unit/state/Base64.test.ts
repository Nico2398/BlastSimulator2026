import { describe, it, expect } from 'vitest';
import { bytesToBase64, base64ToBytes } from '../../../src/core/state/Base64.js';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe('Base64', () => {
  it('round-trips an empty array', () => {
    expect(base64ToBytes(bytesToBase64(bytes()))).toEqual(bytes());
  });

  it('round-trips a single byte (1-byte tail, 2 pad chars)', () => {
    const b = bytes(65);
    expect(bytesToBase64(b)).toBe('QQ==');
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
  });

  it('round-trips two bytes (2-byte tail, 1 pad char)', () => {
    const b = bytes(65, 66);
    expect(bytesToBase64(b)).toBe('QUI=');
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
  });

  it('round-trips three bytes (full chunk, no padding)', () => {
    const b = bytes(65, 66, 67);
    expect(bytesToBase64(b)).toBe('QUJD');
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
  });

  it('round-trips multiple full chunks plus a tail', () => {
    const b = bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
  });

  it('round-trips boundary byte values 0x00 and 0xff', () => {
    const b = bytes(0, 0xff, 0, 0xff, 0x00);
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
  });

  it('round-trips a long run of identical bytes', () => {
    const b = new Uint8Array(300).fill(0x7a);
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
  });

  it('produces a string with no characters outside the base64 alphabet plus padding', () => {
    const b = bytes(1, 2, 3, 4, 5);
    const encoded = bytesToBase64(b);
    expect(encoded).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
  });
});
