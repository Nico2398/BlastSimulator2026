// BlastSimulator2026 — WAV encoder, downmix, base64

import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../../../../src/audio/lab/base64.js';
import { downmixToMono } from '../../../../src/audio/lab/downmix.js';
import { encodeWav16 } from '../../../../src/audio/lab/wav.js';

function readHeader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number): string => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  return {
    riff: text(0), riffSize: view.getUint32(4, true), wave: text(8), fmt: text(12), fmtSize: view.getUint32(16, true),
    format: view.getUint16(20, true), channels: view.getUint16(22, true), sampleRate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true), blockAlign: view.getUint16(32, true), bits: view.getUint16(34, true),
    data: text(36), dataSize: view.getUint32(40, true), view,
  };
}

describe('encodeWav16', () => {
  const left = Float32Array.from([0, 0.5, -0.5, 1, -1]);
  const right = Float32Array.from([1, -1, 0.25, 0, 0]);
  const bytes = encodeWav16([left, right], 44100);
  const header = readHeader(bytes);

  it('writes a canonical 44-byte PCM header', () => {
    expect(header.riff).toBe('RIFF');
    expect(header.wave).toBe('WAVE');
    expect(header.fmt).toBe('fmt ');
    expect(header.fmtSize).toBe(16);
    expect(header.format).toBe(1);
    expect(header.channels).toBe(2);
    expect(header.sampleRate).toBe(44100);
    expect(header.byteRate).toBe(44100 * 4);
    expect(header.blockAlign).toBe(4);
    expect(header.bits).toBe(16);
    expect(header.data).toBe('data');
  });

  it('has the length its header promises', () => {
    expect(header.dataSize).toBe(5 * 2 * 2);
    expect(header.riffSize).toBe(bytes.length - 8);
    expect(bytes.length).toBe(44 + 20);
  });

  it('interleaves the channels frame by frame', () => {
    const samples = Array.from({ length: 10 }, (_, i) => header.view.getInt16(44 + i * 2, true));
    expect(samples).toEqual([0, 32767, 16384, -32768, -16384, 8192, 32767, 0, -32768, 0]);
  });

  it('round-trips a signal to within one 16-bit step', () => {
    const signal = Float32Array.from({ length: 200 }, (_, i) => 0.9 * Math.sin(i / 7));
    const out = encodeWav16([signal], 8000);
    const view = new DataView(out.buffer);
    for (let i = 0; i < signal.length; i++) expect(view.getInt16(44 + i * 2, true) / 32768).toBeCloseTo(signal[i] ?? 0, 3);
  });

  it('saturates out-of-range samples and writes silence for non-finite ones', () => {
    const out = encodeWav16([Float32Array.from([2, -2, Number.NaN, Number.POSITIVE_INFINITY])], 8000);
    const view = new DataView(out.buffer);
    expect([0, 1, 2, 3].map(i => view.getInt16(44 + i * 2, true))).toEqual([32767, -32768, 0, 0]);
  });

  it('writes a valid empty file', () => {
    const empty = encodeWav16([], 48000);
    expect(empty.length).toBe(44);
    expect(readHeader(empty).dataSize).toBe(0);
  });
});

describe('downmixToMono', () => {
  it('averages the channels', () => {
    const mono = downmixToMono([Float32Array.from([1, 0, -1]), Float32Array.from([0, 1, -1])]);
    expect(Array.from(mono)).toEqual([0.5, 0.5, -1]);
  });

  it('cancels out-of-phase channels', () => {
    const tone = Float32Array.from([0.3, -0.7, 0.1]);
    const mono = downmixToMono([tone, tone.map(v => -v)]);
    expect(Array.from(mono)).toEqual([0, 0, 0]);
  });

  it('passes a single channel through and returns nothing for none', () => {
    expect(Array.from(downmixToMono([Float32Array.from([0.25, -0.5])]))).toEqual([0.25, -0.5]);
    expect(downmixToMono([]).length).toBe(0);
  });
});

describe('bytesToBase64', () => {
  it('matches the platform encoder, including across chunk boundaries', () => {
    const bytes = Uint8Array.from({ length: 0x8000 * 2 + 5 }, (_, i) => (i * 31) % 256);
    expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
  });
});
