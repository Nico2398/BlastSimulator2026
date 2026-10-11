import { describe, it, expect } from 'vitest';
import {
  IDLE_BLAST_PLAYBACK,
  isBlastReportDue,
  type BlastPlaybackSnapshot,
} from '../../../../src/core/mining/BlastPlayback.js';
import type { BlastReport } from '../../../../src/core/mining/BlastExecution.js';
import { BLAST_REPORT_MAX_PLAYBACK_S, BLAST_REPORT_MIN_PLAYBACK_S } from '../../../../src/core/config/balance.js';

function makeReport(tick = 1): BlastReport {
  return {
    tick, rating: 'good', clearedVoxels: 10, crackedVoxels: 5, fragmentCount: 3,
    oversizedFragments: 0, totalRockVolume: 10, projectionCount: 0, maxProjectionDistanceM: 0,
    totalOreValue: 100, spent: 50, destroyedBuildings: [],
  };
}

const REPORT = makeReport();

function snap(elapsedS: number, isPlaying: boolean, report: BlastReport | null = REPORT): BlastPlaybackSnapshot {
  return { report, elapsedS, durationS: 0, isPlaying };
}

function due(playback: BlastPlaybackSnapshot, report: BlastReport = REPORT): boolean {
  return isBlastReportDue(playback, report, 3, 8);
}

describe('isBlastReportDue (#1590)', () => {
  it('is true once the debris is at rest and the floor has elapsed', () => {
    expect(due(snap(5, false))).toBe(true);
  });

  it('opens exactly at the floor when the debris is at rest', () => {
    expect(due(snap(3, false))).toBe(true);
    expect(due(snap(2.999, false))).toBe(false);
  });

  it('waits while debris is still moving, up to the cap', () => {
    expect(due(snap(3, true))).toBe(false);
    expect(due(snap(7.999, true))).toBe(false);
  });

  it('opens at the cap even while debris is still moving', () => {
    expect(due(snap(8, true))).toBe(true);
    expect(due(snap(1e6, true))).toBe(true);
  });

  it('is never due on another blast\'s playback, however long it has run', () => {
    const previous = makeReport(0);
    expect(due(snap(1e6, false, previous))).toBe(false);
    expect(due(snap(1e6, true, previous))).toBe(false);
  });

  it('is never due before the renderer has played any blast', () => {
    expect(due(snap(1e6, false, null))).toBe(false);
    expect(due(IDLE_BLAST_PLAYBACK)).toBe(false);
  });

  it('matches by identity, not by equal contents', () => {
    expect(due(snap(10, false, makeReport()))).toBe(false);
  });

  it('the idle snapshot plays nothing', () => {
    expect(IDLE_BLAST_PLAYBACK).toEqual({ report: null, elapsedS: 0, durationS: 0, isPlaying: false });
  });

  it('the floor and cap are positive seconds, floor below cap', () => {
    expect(BLAST_REPORT_MIN_PLAYBACK_S).toBeGreaterThan(0);
    expect(BLAST_REPORT_MAX_PLAYBACK_S).toBeGreaterThan(BLAST_REPORT_MIN_PLAYBACK_S);
    expect(BLAST_REPORT_MAX_PLAYBACK_S).toBeLessThan(60);
  });
});
