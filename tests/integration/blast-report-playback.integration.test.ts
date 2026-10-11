// @vitest-environment jsdom
// BlastSimulator2026 — Integration: the blast report opens on rendered
// playback time, never wall time (#1590, third regression of #545/#950).
//
// Real FragmentAnimator + real BlastReportModal, driven by seeded frame-time
// sequences the way GameRenderer.update(dt) drives them: the playback clock
// and the animator advance by the SAME dt. Wall clocks are mocked to run far
// ahead to prove they play no part.
//
// Invariant under every dt sequence:  modal.visible  =>  the playback is the
//   shown report's own  &&  ((!animator.isPlaying && elapsed >= floor) || elapsed >= cap)
//
// A sliced blast (#1603) writes its report to the state frames before the
// renderer starts playing it, with the UI updated every frame in between:
// `reportLands` / `rendererStarts` replay that order, which `blast` (both at
// once) never exercised.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { FragmentAnimator } from '../../src/renderer/FragmentAnimator.js';
import { BlastReportModal } from '../../src/ui/panels/BlastReportModal.js';
import { BLAST_REPORT_MAX_PLAYBACK_S, BLAST_REPORT_MIN_PLAYBACK_S } from '../../src/core/config/balance.js';
import { createGame } from '../../src/core/state/GameState.js';
import { Random } from '../../src/core/math/Random.js';
import type { GameState } from '../../src/core/state/GameState.js';
import type { BlastReport } from '../../src/core/mining/BlastExecution.js';
import type { BlastPlaybackSnapshot } from '../../src/core/mining/BlastPlayback.js';
import type { FragmentFlight } from '../../src/core/mining/BlastResolve.js';
import type { FragmentMesh } from '../../src/renderer/FragmentMesh.js';

const MAX_FRAME_DT = 0.1; // SceneManager caps dt at 0.1 s

function makeAnimator(): FragmentAnimator {
  const mesh = { updateTransforms: vi.fn() } as unknown as FragmentMesh;
  return new FragmentAnimator(mesh);
}

function flights(durationS: number, count = 3): FragmentFlight[] {
  return Array.from({ length: count }, (_, i) => ({
    fragmentId: i,
    from: { x: i, y: 20, z: 0 },
    to: { x: i, y: 0, z: 0 },
    delayS: i * 0.2,
    durationS,
    impactSpeed: 10,
    thrown: false,
  }));
}

function makeReport(tick = 1): BlastReport {
  return {
    tick, rating: 'good', clearedVoxels: 10, crackedVoxels: 5, fragmentCount: 3,
    oversizedFragments: 0, totalRockVolume: 10, projectionCount: 0, maxProjectionDistanceM: 0,
    totalOreValue: 100, spent: 50, destroyedBuildings: [],
  };
}

interface Rig {
  animator: FragmentAnimator;
  modal: BlastReportModal;
  state: GameState;
  elapsed: () => number;
  /** The report lands and the renderer starts its playback in the same frame (unsliced blast). */
  blast: (fl: FragmentFlight[], report: BlastReport) => void;
  /** The simulation writes the report to the state; the renderer has not started on it yet. */
  reportLands: (report: BlastReport) => void;
  /** The renderer starts playing the blast whose report the state holds (GameRenderer.onBlastSteps). */
  rendererStarts: (fl: FragmentFlight[]) => void;
  frame: (dt: number) => void;
  snapshot: () => BlastPlaybackSnapshot;
}

/** Mirrors GameRenderer: onBlast resets the clock + begins; update(dt) advances both by dt. */
function makeRig(): Rig {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const animator = makeAnimator();
  const modal = new BlastReportModal(container);
  const state = createGame({ seed: 42, mineType: 'desert' });
  let elapsed = 0;
  let playingReport: BlastReport | null = null;
  const snapshot = (): BlastPlaybackSnapshot => ({
    report: playingReport, elapsedS: elapsed, durationS: animator.durationS, isPlaying: animator.isPlaying,
  });
  const rendererStarts = (fl: FragmentFlight[]): void => {
    elapsed = 0;
    playingReport = state.lastBlastReport;
    animator.begin(fl);
  };
  return {
    animator, modal, state, snapshot, rendererStarts,
    elapsed: () => elapsed,
    blast(fl, report) {
      state.lastBlastReport = report;
      rendererStarts(fl);
      modal.update(state, snapshot());
    },
    reportLands(report) {
      state.lastBlastReport = report;
      modal.update(state, snapshot());
    },
    frame(dt) {
      animator.update(dt);
      if (Number.isFinite(dt) && dt > 0) elapsed += dt;
      modal.update(state, snapshot());
    },
  };
}

function expectInvariant(rig: Rig): void {
  if (rig.modal.visible) {
    expect(rig.snapshot().report).toBe(rig.state.lastBlastReport);
    if (rig.elapsed() < BLAST_REPORT_MAX_PLAYBACK_S) {
      expect(rig.animator.isPlaying).toBe(false);
      expect(rig.elapsed()).toBeGreaterThanOrEqual(BLAST_REPORT_MIN_PLAYBACK_S);
    }
  }
}

describe('blast report vs real playback (#1590)', () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('opens only after the collapse finished and the floor elapsed (steady 60 fps)', () => {
    const rig = makeRig();
    rig.blast(flights(4), makeReport());
    let openedAt = -1;
    for (let i = 0; i < 2000 && openedAt < 0; i++) {
      rig.frame(1 / 60);
      expectInvariant(rig);
      if (rig.modal.visible) openedAt = rig.elapsed();
    }
    expect(openedAt).toBeGreaterThanOrEqual(rig.animator.durationS);
    expect(openedAt).toBeGreaterThanOrEqual(BLAST_REPORT_MIN_PLAYBACK_S);
    expect(rig.modal.visible).toBe(true);
  });

  it('a short collapse still waits for the floor', () => {
    const rig = makeRig();
    rig.blast(flights(0.2, 1), makeReport());
    const shortEnd = rig.animator.durationS;
    expect(shortEnd).toBeLessThan(BLAST_REPORT_MIN_PLAYBACK_S);
    let opened = false;
    for (let i = 0; i < 1000 && !opened; i++) {
      rig.frame(1 / 30);
      expectInvariant(rig);
      opened = rig.modal.visible;
    }
    expect(opened).toBe(true);
    expect(rig.elapsed()).toBeGreaterThanOrEqual(BLAST_REPORT_MIN_PLAYBACK_S);
  });

  it('slow frames (every dt capped at 0.1 s) with wall time racing ahead: stays closed until the rendered playback completes', () => {
    const wall = vi.spyOn(performance, 'now').mockReturnValue(0);
    const date = vi.spyOn(Date, 'now').mockReturnValue(0);
    const rig = makeRig();
    rig.blast(flights(5), makeReport());

    let frames = 0;
    while (!rig.modal.visible && frames < 5000) {
      wall.mockReturnValue(frames * 1000); // one wall second per (stalled) frame
      date.mockReturnValue(frames * 1000);
      rig.frame(MAX_FRAME_DT);
      frames++;
      expectInvariant(rig);
      if (frames === 5) expect(rig.modal.visible).toBe(false); // 5 s of wall time but only 0.5 s rendered
    }
    expect(rig.modal.visible).toBe(true);
    expect(rig.elapsed()).toBeGreaterThanOrEqual(rig.animator.durationS);
    expect(frames).toBeGreaterThanOrEqual(Math.ceil(rig.animator.durationS / MAX_FRAME_DT));
  });

  it('a hidden-tab gap (wall time passes, zero frames) leaves the modal closed', () => {
    const wall = vi.spyOn(performance, 'now').mockReturnValue(0);
    const rig = makeRig();
    rig.blast(flights(5), makeReport());
    rig.frame(MAX_FRAME_DT);
    rig.frame(MAX_FRAME_DT);

    wall.mockReturnValue(30 * 60_000); // tab hidden for 30 minutes; rAF paused
    expect(rig.modal.visible).toBe(false);
    expectInvariant(rig);
    expect(rig.modal.pending).toBe(true);

    // Tab returns: first frame carries the capped dt, not the 30 minutes.
    rig.frame(MAX_FRAME_DT);
    expect(rig.modal.visible).toBe(false);
    expectInvariant(rig);
  });

  it('invariant holds for seeded random dt sequences, including stalls and zero-length frames', () => {
    for (const seed of [1, 2, 3, 7, 42, 99, 2026]) {
      const rng = new Random(seed);
      const rig = makeRig();
      rig.blast(flights(rng.nextFloat(0.5, 8), rng.nextInt(1, 6)), makeReport(seed));
      for (let i = 0; i < 1500; i++) {
        const roll = rng.next();
        const dt = roll < 0.1 ? 0 : roll < 0.4 ? MAX_FRAME_DT : rng.nextFloat(0.001, MAX_FRAME_DT);
        rig.frame(dt);
        expectInvariant(rig);
      }
      // Liveness: ~1500 frames of mixed dt is far beyond the longest collapse.
      expect(rig.modal.visible).toBe(true);
    }
  });

  it('a second blast mid-collapse restarts the clock; the first report never shows', () => {
    const rig = makeRig();
    rig.blast(flights(4), makeReport(1));
    for (let i = 0; i < 20; i++) rig.frame(MAX_FRAME_DT);
    expect(rig.modal.visible).toBe(false);

    const second = makeReport(2);
    second.fragmentCount = 777;
    rig.blast(flights(4), second);
    expect(rig.elapsed()).toBe(0);

    for (let i = 0; i < 3000 && !rig.modal.visible; i++) {
      rig.frame(1 / 60);
      expectInvariant(rig);
    }
    expect(rig.modal.visible).toBe(true);
    expect(rig.modal.root.textContent).toContain('777');
    expect(rig.elapsed()).toBeGreaterThanOrEqual(rig.animator.durationS);
  });

  it('a seek that holds the collapse mid-flight keeps the report closed until the cap', () => {
    const rig = makeRig();
    rig.blast(flights(6), makeReport());
    rig.animator.seek(rig.animator.durationS / 2);
    while (rig.elapsed() + MAX_FRAME_DT < BLAST_REPORT_MAX_PLAYBACK_S) {
      rig.frame(MAX_FRAME_DT); // the loop keeps ticking the clock; the animator is held
      expect(rig.modal.visible).toBe(false);
    }
    for (let i = 0; i < 3 && !rig.modal.visible; i++) rig.frame(MAX_FRAME_DT);
    expect(rig.modal.visible).toBe(true);
    expect(rig.animator.isPlaying).toBe(true);
  });

  it('a collapse longer than the cap opens the report at the cap, debris still moving', () => {
    const rig = makeRig();
    rig.blast(flights(20), makeReport());
    expect(rig.animator.durationS).toBeGreaterThan(BLAST_REPORT_MAX_PLAYBACK_S);
    let openedAt = -1;
    for (let i = 0; i < 2000 && openedAt < 0; i++) {
      rig.frame(1 / 60);
      expectInvariant(rig);
      if (rig.modal.visible) openedAt = rig.elapsed();
    }
    expect(openedAt).toBeGreaterThanOrEqual(BLAST_REPORT_MAX_PLAYBACK_S);
    expect(openedAt).toBeLessThan(BLAST_REPORT_MAX_PLAYBACK_S + 1 / 30);
    expect(rig.animator.isPlaying).toBe(true);
  });

  it('a sliced blast\'s report, landing frames before its playback starts, waits for that playback — first blast of the session', () => {
    const rig = makeRig();
    // The page has been up a while: the clock is far past every threshold, nothing playing.
    for (let i = 0; i < 200; i++) rig.frame(MAX_FRAME_DT);
    expect(rig.elapsed()).toBeGreaterThan(BLAST_REPORT_MAX_PLAYBACK_S);

    rig.reportLands(makeReport());
    for (let i = 0; i < 10; i++) {
      rig.frame(1 / 60); // the blast job and its landing still resolving
      expect(rig.modal.visible).toBe(false);
    }

    rig.rendererStarts(flights(4));
    let openedAt = -1;
    for (let i = 0; i < 2000 && openedAt < 0; i++) {
      rig.frame(1 / 60);
      expectInvariant(rig);
      if (rig.modal.visible) openedAt = rig.elapsed();
    }
    expect(openedAt).toBeGreaterThanOrEqual(rig.animator.durationS);
  });

  it('a sliced blast\'s report waits for its own playback, not the previous blast\'s finished one', () => {
    const rig = makeRig();
    rig.blast(flights(1, 1), makeReport(1));
    for (let i = 0; i < 2000 && !rig.modal.visible; i++) rig.frame(1 / 60);
    expect(rig.modal.visible).toBe(true);
    rig.modal.hide();
    for (let i = 0; i < 100; i++) rig.frame(MAX_FRAME_DT); // first collapse long settled

    const second = makeReport(2);
    second.fragmentCount = 777;
    rig.reportLands(second);
    for (let i = 0; i < 10; i++) {
      rig.frame(1 / 60);
      expect(rig.modal.visible).toBe(false);
    }

    rig.rendererStarts(flights(4));
    for (let i = 0; i < 2000 && !rig.modal.visible; i++) {
      rig.frame(1 / 60);
      expectInvariant(rig);
    }
    expect(rig.modal.visible).toBe(true);
    expect(rig.modal.root.textContent).toContain('777');
    expect(rig.elapsed()).toBeGreaterThanOrEqual(rig.animator.durationS);
  });

  it('finish() (harness skip) completes playback; the report then opens once the floor of rendered time has passed', () => {
    const rig = makeRig();
    rig.blast(flights(6), makeReport());
    rig.animator.finish();
    rig.frame(MAX_FRAME_DT);
    expect(rig.modal.visible).toBe(false); // floor not reached yet
    for (let i = 0; i < Math.ceil(BLAST_REPORT_MIN_PLAYBACK_S / MAX_FRAME_DT) + 1; i++) rig.frame(MAX_FRAME_DT);
    expect(rig.modal.visible).toBe(true);
    expectInvariant(rig);
  });

  it('stamps the opening playback time on the overlay', () => {
    const rig = makeRig();
    rig.blast(flights(1, 1), makeReport());
    for (let i = 0; i < 2000 && !rig.modal.visible; i++) rig.frame(0.05);
    expect(rig.modal.visible).toBe(true);
    expect(rig.modal.root.dataset['openedAtPlaybackS']).toBe(rig.elapsed().toFixed(2));
  });
});
