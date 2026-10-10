import { describe, it, expect } from 'vitest';
import {
  IDLE_BLAST_PLAYBACK,
  isBlastPlaybackComplete,
  type BlastPlaybackSnapshot,
} from '../../../../src/core/mining/BlastPlayback.js';
import { BLAST_REPORT_MIN_PLAYBACK_S } from '../../../../src/core/config/balance.js';

function snap(elapsedS: number, isPlaying: boolean, durationS = 0): BlastPlaybackSnapshot {
  return { elapsedS, durationS, isPlaying };
}

describe('isBlastPlaybackComplete (#1590)', () => {
  it('is true when playback stopped and elapsed is past the floor', () => {
    expect(isBlastPlaybackComplete(snap(5, false, 4), 3)).toBe(true);
  });

  it('is true exactly at the floor (boundary opens)', () => {
    expect(isBlastPlaybackComplete(snap(3, false), 3)).toBe(true);
    expect(isBlastPlaybackComplete(snap(BLAST_REPORT_MIN_PLAYBACK_S, false), BLAST_REPORT_MIN_PLAYBACK_S)).toBe(true);
  });

  it('is false just below the floor', () => {
    expect(isBlastPlaybackComplete(snap(2.999, false), 3)).toBe(false);
  });

  it('is false while still playing, however much time elapsed', () => {
    expect(isBlastPlaybackComplete(snap(3, true, 10), 3)).toBe(false);
    expect(isBlastPlaybackComplete(snap(1e6, true, 1e7), 3)).toBe(false);
  });

  it('a zero floor completes as soon as playback stops', () => {
    expect(isBlastPlaybackComplete(snap(0, false), 0)).toBe(true);
    expect(isBlastPlaybackComplete(snap(0, true), 0)).toBe(false);
  });

  it('the idle snapshot is not complete against a positive floor, and is not playing', () => {
    expect(IDLE_BLAST_PLAYBACK).toEqual({ elapsedS: 0, durationS: 0, isPlaying: false });
    expect(isBlastPlaybackComplete(IDLE_BLAST_PLAYBACK, BLAST_REPORT_MIN_PLAYBACK_S)).toBe(false);
  });

  it('the floor constant is a positive number of seconds', () => {
    expect(BLAST_REPORT_MIN_PLAYBACK_S).toBeGreaterThan(0);
    expect(BLAST_REPORT_MIN_PLAYBACK_S).toBeLessThan(60);
  });
});
