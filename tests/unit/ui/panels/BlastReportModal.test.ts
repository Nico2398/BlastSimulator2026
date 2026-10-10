// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { BlastReportModal } from '../../../../src/ui/panels/BlastReportModal.js';
import { BLAST_REPORT_MIN_PLAYBACK_S } from '../../../../src/core/config/balance.js';
import type { BlastPlaybackSnapshot } from '../../../../src/core/mining/BlastPlayback.js';
import { t } from '../../../../src/core/i18n/I18n.js';
import { createGame } from '../../../../src/core/state/GameState.js';

import type { GameState } from '../../../../src/core/state/GameState.js';
import type { BlastReport } from '../../../../src/core/mining/BlastExecution.js';
import type { AccidentRecord } from '../../../../src/core/entities/Damage.js';
import type { Employee } from '../../../../src/core/entities/Employee.js';

function makeState(): GameState {
  return createGame({ seed: 1, mineType: 'desert' });
}

function addEmployee(state: GameState, overrides: Partial<Employee> = {}): Employee {
  const emp: Employee = {
    id: state.employees.nextId++, name: 'Walt Diggins', role: 'driller', salary: 500,
    morale: 60, unionized: false, injured: false, alive: true, x: 5, z: 5,
    qualifications: [], trainingState: null, activeActionId: null,
    fatigue: 0, collapsing: false, interruptedActionPayload: null,
    ticksWorked: 0, restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
    activeTaskSkill: null, destinationX: null, destinationZ: null,
    moveConsecutiveFailures: 0, isMoveStuck: false,
    pendingRestDuration: null, pendingRestNeedKey: null, pendingTaskDuration: null,
    pendingActionType: null, pendingActionPayload: null, pendingDriverVehicleId: null,
    taskQueue: [], locomotion: { kind: 'on_foot' },
    itinerary: null,
    vehicleWaitingTicks: 0,
    ...overrides,
  };
  state.employees.employees.push(emp);
  return emp;
}

function makeAccident(overrides: Partial<AccidentRecord> = {}): AccidentRecord {
  return { tick: 0, type: 'injury', entityId: 1, fragmentId: 1, kineticEnergy: 200, ...overrides };
}

// The modal reads the renderer's playback snapshot (#1590), never a wall clock.
// `setPlayback(s)` drives the shared snapshot every `update(state, playback())`
// call in this file passes: s rendered seconds elapsed, playback finished.
let currentPlayback: BlastPlaybackSnapshot = { elapsedS: 0, durationS: 0, isPlaying: false };
function playback(): BlastPlaybackSnapshot { return currentPlayback; }
function setPlayback(elapsedS: number, extra: Partial<BlastPlaybackSnapshot> = {}): void {
  currentPlayback = { elapsedS, durationS: 0, isPlaying: false, ...extra };
}

function makeModal(): { modal: BlastReportModal; container: HTMLElement; setPlayback: typeof setPlayback } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  setPlayback(0);
  const modal = new BlastReportModal(container);
  return { modal, container, setPlayback };
}

function makeReport(overrides: Partial<BlastReport> = {}): BlastReport {
  return {
    tick: 100, rating: 'good', clearedVoxels: 1842, crackedVoxels: 610,
    fragmentCount: 47, oversizedFragments: 0, totalRockVolume: 1240,
    projectionCount: 0, maxProjectionDistanceM: 0, totalOreValue: 16020,
    spent: 960, destroyedBuildings: [],
    ...overrides,
  };
}

/**
 * Arms the modal's current `state.lastBlastReport` and forces it open by
 * running out the full delay (#545) — the arm-then-open sequence most tests
 * need before asserting on already-open content, factored out of the ~9
 * call sites that repeated it verbatim.
 */
function openReport(modal: BlastReportModal, state: GameState, setPlayback: (v: number) => void): void {
  modal.update(state, playback());
  setPlayback(BLAST_REPORT_MIN_PLAYBACK_S);
  modal.update(state, playback());
}

describe('BlastReportModal', () => {
  it('is hidden until a blast report appears', () => {
    const { modal } = makeModal();
    expect(modal.visible).toBe(false);
  });

  it('stays hidden when update() runs with no lastBlastReport', () => {
    const { modal } = makeModal();
    modal.update(makeState());
    expect(modal.visible).toBe(false);
  });

  it('does not open on the same update() call that first observes a report (#545)', () => {
    const { modal } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();

    modal.update(state, playback());

    expect(modal.visible).toBe(false);
    expect(modal.pending).toBe(true);
  });

  it('stays closed just before the open delay has elapsed (#545)', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    modal.update(state, playback());

    setPlayback(BLAST_REPORT_MIN_PLAYBACK_S - 0.01);
    modal.update(state, playback());

    expect(modal.visible).toBe(false);
    expect(modal.pending).toBe(true);
  });

  it('opens once the delay has elapsed, rendering the held report\'s real stats (#545)', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();

    openReport(modal, state, setPlayback);

    expect(modal.visible).toBe(true);
    expect(modal.pending).toBe(false);
    expect(modal.root.textContent).toContain('1842');
    expect(modal.root.textContent).toContain('610');
    expect(modal.root.textContent).toContain('47');
    expect(modal.root.textContent).toContain('$960');
    expect(modal.root.textContent).toContain('$16,020');
    expect(modal.root.textContent).toContain('Good');
  });

  it('a second report inside the delay window replaces the first — only the latest is ever rendered (#545)', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    const reportA = makeReport({ fragmentCount: 47, totalOreValue: 16020 });
    state.lastBlastReport = reportA;
    modal.update(state, playback()); // arms A
    expect(modal.visible).toBe(false);
    expect(modal.root.textContent).not.toContain('16,020');

    setPlayback(1);
    const reportB = makeReport({ fragmentCount: 12, totalOreValue: 12345 });
    state.lastBlastReport = reportB;
    modal.update(state, playback()); // B replaces A well before A's own deadline (3000)

    expect(modal.visible).toBe(false); // A never opened
    expect(modal.root.textContent).not.toContain('16,020'); // A's stat never rendered

    // B's own window: playback elapsed reaches the floor.
    setPlayback(1 + BLAST_REPORT_MIN_PLAYBACK_S);
    modal.update(state, playback());

    expect(modal.visible).toBe(true);
    expect(modal.pending).toBe(false);
    expect(modal.root.textContent).toContain('12,345');
    expect(modal.root.textContent).not.toContain('16,020');
  });

  it('Close hides the modal', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    openReport(modal, state, setPlayback);

    (modal.root.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();

    expect(modal.visible).toBe(false);
  });

  it('does not reopen on the next tick for the same report once closed', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    openReport(modal, state, setPlayback);
    (modal.root.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();

    modal.update(state, playback()); // same report object, time unchanged

    expect(modal.visible).toBe(false);
  });

  it('opens again for a genuinely new report (different tick)', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport({ tick: 100 });
    openReport(modal, state, setPlayback);
    (modal.root.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();

    setPlayback(BLAST_REPORT_MIN_PLAYBACK_S + 1);
    state.lastBlastReport = makeReport({ tick: 200 });
    modal.update(state, playback()); // arms the new report

    expect(modal.visible).toBe(false);

    setPlayback(BLAST_REPORT_MIN_PLAYBACK_S + 1 + BLAST_REPORT_MIN_PLAYBACK_S);
    modal.update(state, playback());

    expect(modal.visible).toBe(true);
  });

  it('opens again for a second blast fired on the same tick', () => {
    // Nothing forces the clock to advance between two plans — a player (or a
    // scripted sequence) can drill/charge/fire twice with no tick
    // command in between, so both reports land on the same state.tickCount.
    // Gating on tick equality alone made the second report never reopen; the
    // fix compares report identity instead (buildBlastReport in mining.ts
    // always returns a fresh object, so two distinct blasts are always two
    // distinct references even when their tick matches). Issue #479.
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport({ tick: 100, fragmentCount: 47 });
    openReport(modal, state, setPlayback);
    (modal.root.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();
    expect(modal.visible).toBe(false);

    setPlayback(BLAST_REPORT_MIN_PLAYBACK_S + 1);
    state.lastBlastReport = makeReport({ tick: 100, fragmentCount: 12 });
    modal.update(state, playback()); // arms the second blast's report

    expect(modal.visible).toBe(false); // still waiting out its own delay

    setPlayback(BLAST_REPORT_MIN_PLAYBACK_S + 1 + BLAST_REPORT_MIN_PLAYBACK_S);
    modal.update(state, playback());

    expect(modal.visible).toBe(true);
    expect(modal.root.textContent).toContain('12');
  });

  it('shows the ore report card with real percentage and breakdown when a survey estimate exists', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    state.lastOreReport = {
      oreYields: { craktonite: 3900, rustite: 1320 },
      totalYieldKg: 5220, estimatedYieldKg: 6100, yieldRatio: 5220 / 6100,
      hasTreranium: false, absurdiumFraction: 0,
    };

    openReport(modal, state, setPlayback);

    expect(modal.root.textContent).toContain('86%');
    expect(modal.root.textContent).toContain('5220 kg');
    expect(modal.root.textContent).toContain('6100 kg');
  });

  it('omits the ore report card when there was no survey estimate to compare against', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    state.lastOreReport = {
      oreYields: {}, totalYieldKg: 0, estimatedYieldKg: 0, yieldRatio: 1,
      hasTreranium: false, absurdiumFraction: 0,
    };

    openReport(modal, state, setPlayback);

    expect(modal.root.textContent).not.toContain('Ore Report');
  });

  it('shows one card per destroyed building', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport({
      destroyedBuildings: [{ buildingId: 3, type: 'freight_warehouse', x: 5, z: 5 }],
    });

    openReport(modal, state, setPlayback);

    expect(modal.root.textContent).toContain('Freight Warehouse #3');
    expect(modal.root.textContent).toContain('was destroyed');
  });

  it('shows the oversized-fragments hint, naming the real rock_fragmenter vehicle, only when there are any', () => {
    const { modal: modalA, setPlayback: setPlaybackA } = makeModal();
    const stateA = makeState();
    stateA.lastBlastReport = makeReport({ oversizedFragments: 0 });
    openReport(modalA, stateA, setPlaybackA);
    expect(modalA.root.textContent).not.toContain('too large for standard haulers');

    const { modal: modalB, setPlayback: setPlaybackB } = makeModal();
    const stateB = makeState();
    stateB.lastBlastReport = makeReport({ oversizedFragments: 6 });
    openReport(modalB, stateB, setPlaybackB);
    expect(modalB.root.textContent).toContain('6 fragments are too large for standard haulers');
    expect(modalB.root.textContent).toContain('Rock Fragmenter');
  });

  it('reset() clears a pending report so it never opens (#545)', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    modal.update(state, playback()); // arms the report
    expect(modal.pending).toBe(true);

    modal.reset();

    expect(modal.pending).toBe(false);
    expect(modal.visible).toBe(false);

    // Level-transition sequence: a fresh GameState (new_game/campaign/sandbox
    // entry), whose lastBlastReport always starts null — mirrors the real
    // enteredNewLevel guard, not a reuse of the same stale state object.
    const freshState = makeState();
    setPlayback(BLAST_REPORT_MIN_PLAYBACK_S * 10);
    modal.update(freshState, playback());

    expect(modal.visible).toBe(false);
    expect(modal.pending).toBe(false);
  });

  it('reset() also hides an already-open modal (#545)', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    openReport(modal, state, setPlayback);
    expect(modal.visible).toBe(true);

    modal.reset();

    expect(modal.visible).toBe(false);
  });

  // ── reset(currentReport) threads state.lastBlastReport through so a
  // save/load round trip doesn't re-arm the modal (#571) ─────────────────
  //
  // Bug: reset() never stamped lastShownReport, so closeStaleLevelOverlays()
  // (called whenever ctx.state is replaced — including after `load`, whose
  // deserialized state carries a reference-distinct but structurally
  // identical lastBlastReport) left the modal thinking it had never shown
  // that report, and the very next update() tick re-armed it.

  it('reset(currentReport) stamps lastShownReport so a subsequent update() call with that same-identity report does not re-arm (#571)', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    const original = makeReport({ tick: 100 });
    state.lastBlastReport = original;
    openReport(modal, state, setPlayback);
    (modal.root.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();
    expect(modal.visible).toBe(false);

    // Simulate closeStaleLevelOverlays(newState) passing the freshly
    // deserialized state's lastBlastReport — a reference-distinct but
    // structurally identical report, mirroring a save/load round trip.
    const reloaded = makeReport({ tick: 100 });
    modal.reset(reloaded);

    expect(modal.pending).toBe(false);
    expect(modal.visible).toBe(false);

    const newState = makeState();
    newState.lastBlastReport = reloaded; // same reference just passed to reset()
    modal.update(newState, playback());

    expect(modal.pending).toBe(false);
    expect(modal.visible).toBe(false);

    // Stays closed even once the report's would-be open delay fully elapses.
    setPlayback(BLAST_REPORT_MIN_PLAYBACK_S * 20);
    modal.update(newState, playback());

    expect(modal.pending).toBe(false);
    expect(modal.visible).toBe(false);
  });

  it('reset() with no argument leaves lastShownReport at null, same as before — a later new report still arms and opens normally (#571)', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport({ tick: 100 });
    modal.update(state, playback()); // arms it (pending)

    modal.reset(); // no argument — the pre-#571 call shape

    expect(modal.pending).toBe(false);
    expect(modal.visible).toBe(false);

    const freshState = makeState();
    freshState.lastBlastReport = makeReport({ tick: 999 }); // genuinely new report
    modal.update(freshState, playback());
    expect(modal.pending).toBe(true); // arms normally — nothing was wrongly suppressed

    setPlayback(BLAST_REPORT_MIN_PLAYBACK_S);
    modal.update(freshState, playback());
    expect(modal.visible).toBe(true);
  });

  it('reset(currentReport) discards an actively pending report outright — it does not resurrect once discarded, even when currentReport is that exact pending report (#571)', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    const pending = makeReport({ tick: 50 });
    state.lastBlastReport = pending;
    modal.update(state, playback()); // arms `pending`, still waiting out its delay
    expect(modal.pending).toBe(true);

    // A level transition / save-load lands mid-delay: currentReport here is
    // that exact same pending report reference (e.g. an immediate reload
    // before the report ever had a chance to open) — it must never surface.
    modal.reset(pending);

    expect(modal.pending).toBe(false);
    expect(modal.visible).toBe(false);

    // Even once its original deadline would have elapsed, on the same state
    // object with the same report reference, it stays suppressed.
    setPlayback(BLAST_REPORT_MIN_PLAYBACK_S);
    modal.update(state, playback());

    expect(modal.pending).toBe(false);
    expect(modal.visible).toBe(false);
  });

  // ── playback-gated opening (#1590, supersedes #545 wall clock / #950) ──
  // The delay is measured in rendered playback seconds (the renderer's capped-dt
  // clock), never wall time: the report opens only when playback has stopped
  // AND at least BLAST_REPORT_MIN_PLAYBACK_S rendered seconds have elapsed.

  describe('playback-gated opening (#1590)', () => {
    it('stays closed while the collapse is still playing, however much playback time has elapsed', () => {
      const { modal } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport();
      for (const elapsedS of [0, 1, BLAST_REPORT_MIN_PLAYBACK_S, 10, 1000]) {
        setPlayback(elapsedS, { durationS: 2000, isPlaying: true });
        modal.update(state, playback());
        expect(modal.visible).toBe(false);
        expect(modal.pending).toBe(true);
      }
    });

    it('opens once playback has stopped and the floor was reached, even if the collapse outlasted the floor', () => {
      const { modal } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport();
      setPlayback(5, { durationS: 5, isPlaying: true });
      modal.update(state, playback());
      expect(modal.visible).toBe(false);

      setPlayback(5, { durationS: 5, isPlaying: false });
      modal.update(state, playback());
      expect(modal.visible).toBe(true);
      expect(modal.pending).toBe(false);
    });

    it('stays closed when playback stopped early (short collapse) but the floor is not yet reached', () => {
      const { modal } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport();
      setPlayback(1, { durationS: 1 });
      modal.update(state, playback());
      expect(modal.visible).toBe(false);
      expect(modal.pending).toBe(true);

      setPlayback(BLAST_REPORT_MIN_PLAYBACK_S - 0.01, { durationS: 1 });
      modal.update(state, playback());
      expect(modal.visible).toBe(false);

      setPlayback(BLAST_REPORT_MIN_PLAYBACK_S, { durationS: 1 });
      modal.update(state, playback());
      expect(modal.visible).toBe(true);
    });

    it('opens when elapsed is exactly at the floor with duration 0 (headless, nothing animated)', () => {
      const { modal } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport();
      setPlayback(BLAST_REPORT_MIN_PLAYBACK_S, { durationS: 0 });
      modal.update(state, playback());
      expect(modal.visible).toBe(true);
    });

    it('the arming update does not need to differ from the opening one: a snapshot already complete opens at once', () => {
      const { modal } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport();
      setPlayback(BLAST_REPORT_MIN_PLAYBACK_S + 1);
      modal.update(state, playback());
      expect(modal.visible).toBe(true);
    });

    it('slow frames: a huge wall-clock jump with few 0.1 s-capped frames keeps the modal closed until accumulated playback reaches the floor', () => {
      const wall = vi.spyOn(performance, 'now');
      const date = vi.spyOn(Date, 'now');
      try {
        wall.mockReturnValue(0);
        date.mockReturnValue(0);
        const { modal } = makeModal();
        const state = makeState();
        state.lastBlastReport = makeReport();
        modal.update(state, playback());

        // 60 s of wall time pass, but the renderer only produced 5 frames
        // (each capped to 0.1 s): 0.5 s of rendered playback.
        wall.mockReturnValue(60_000);
        date.mockReturnValue(60_000);
        let elapsed = 0;
        for (let i = 0; i < 5; i++) {
          elapsed += 0.1;
          setPlayback(elapsed, { durationS: 6, isPlaying: true });
          modal.update(state, playback());
          expect(modal.visible).toBe(false);
        }
        expect(modal.pending).toBe(true);

        // Collapse finished early but floor not met: still closed.
        setPlayback(elapsed, { durationS: 6, isPlaying: false });
        modal.update(state, playback());
        expect(modal.visible).toBe(false);

        setPlayback(BLAST_REPORT_MIN_PLAYBACK_S);
        modal.update(state, playback());
        expect(modal.visible).toBe(true);
      } finally {
        wall.mockRestore();
        date.mockRestore();
      }
    });

    it('hidden-tab gap: wall time passes with zero frames, modal stays closed', () => {
      const wall = vi.spyOn(performance, 'now');
      try {
        wall.mockReturnValue(0);
        const { modal } = makeModal();
        const state = makeState();
        state.lastBlastReport = makeReport();
        setPlayback(0.2, { durationS: 4, isPlaying: true });
        modal.update(state, playback());

        wall.mockReturnValue(10 * 60_000);
        for (let i = 0; i < 3; i++) modal.update(state, playback()); // same snapshot, no frames
        expect(modal.visible).toBe(false);
        expect(modal.pending).toBe(true);
      } finally {
        wall.mockRestore();
      }
    });

    it('stamps data-opened-at-playback-s with the elapsed playback seconds (2 decimals) on open', () => {
      const { modal } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport();
      setPlayback(BLAST_REPORT_MIN_PLAYBACK_S, { durationS: 1 });
      modal.update(state, playback());
      expect(modal.root.dataset['openedAtPlaybackS']).toBe(BLAST_REPORT_MIN_PLAYBACK_S.toFixed(2));

      const second = makeModal();
      const s2 = makeState();
      s2.lastBlastReport = makeReport();
      setPlayback(4.567, { durationS: 4.567 });
      second.modal.update(s2, playback());
      expect(second.modal.root.dataset['openedAtPlaybackS']).toBe('4.57');
    });

    it('does not stamp openedAtPlaybackS while the report is only pending', () => {
      const { modal } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport();
      setPlayback(1, { isPlaying: true });
      modal.update(state, playback());
      expect(modal.root.dataset['openedAtPlaybackS']).toBeUndefined();
    });

    it('a blast replacing a pending one while playing is armed afresh and only opens on its own completed playback', () => {
      const { modal } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport({ fragmentCount: 47, totalOreValue: 16020 });
      setPlayback(2, { isPlaying: true });
      modal.update(state, playback());

      state.lastBlastReport = makeReport({ fragmentCount: 12, totalOreValue: 12345 });
      setPlayback(0, { isPlaying: true }); // renderer reset the clock for blast B
      modal.update(state, playback());
      expect(modal.visible).toBe(false);

      setPlayback(BLAST_REPORT_MIN_PLAYBACK_S);
      modal.update(state, playback());
      expect(modal.visible).toBe(true);
      expect(modal.root.textContent).toContain('12,345');
      expect(modal.root.textContent).not.toContain('16,020');
    });

    it('update(state) with the snapshot omitted never opens (idle snapshot has elapsed 0)', () => {
      const { modal } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport();
      modal.update(state);
      modal.update(state);
      expect(modal.visible).toBe(false);
      expect(modal.pending).toBe(true);
    });

    it('does not extend or reset the wait when update() is pumped every frame with an unchanged report', () => {
      const { modal } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport();
      for (let s = 0; s < BLAST_REPORT_MIN_PLAYBACK_S; s += 0.25) {
        setPlayback(s, { durationS: 3, isPlaying: s < 2 });
        modal.update(state, playback());
        expect(modal.visible).toBe(false);
      }
      setPlayback(BLAST_REPORT_MIN_PLAYBACK_S, { durationS: 3 });
      modal.update(state, playback());
      expect(modal.visible).toBe(true);
    });

    it('data-outstanding stays true while playing and pending, and flips false only once dismissed', () => {
      const { modal } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport();

      setPlayback(1, { isPlaying: true });
      modal.update(state, playback());
      expect(modal.root.dataset['outstanding']).toBe('true');

      setPlayback(BLAST_REPORT_MIN_PLAYBACK_S + 2, { isPlaying: true });
      modal.update(state, playback());
      expect(modal.root.dataset['outstanding']).toBe('true');
      expect(modal.visible).toBe(false);

      setPlayback(BLAST_REPORT_MIN_PLAYBACK_S + 2);
      modal.update(state, playback());
      expect(modal.root.dataset['outstanding']).toBe('true');
      expect(modal.visible).toBe(true);

      (modal.root.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();
      expect(modal.root.dataset['outstanding']).toBe('false');
    });

    it('level end clears a pending report: it never opens afterwards (guard kept)', () => {
      const { modal } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport();
      setPlayback(1, { isPlaying: true });
      modal.update(state, playback());
      state.levelEndReason = 'bankruptcy';
      modal.update(state, playback());
      expect(modal.pending).toBe(false);
      expect(modal.root.dataset['outstanding']).toBe('false');

      state.levelEndReason = null;
      setPlayback(BLAST_REPORT_MIN_PLAYBACK_S * 5);
      modal.update(state, playback());
      expect(modal.visible).toBe(false);
    });
  });

  it('refreshLocale() does not throw', () => {
    const { modal } = makeModal();
    expect(() => modal.refreshLocale()).not.toThrow();
  });

  it('dispose() removes the modal from the DOM', () => {
    const { modal, container } = makeModal();
    modal.dispose();
    expect(container.contains(modal.root)).toBe(false);
  });

  // ── casualty/loss note-cards (#557, item #5) ────────────────────────────
  // Icon + text come from accidentLookup.ts, shared with OperationsPanel's
  // incident log — these prove the report card's own rendering (icon choice,
  // which 4 of the 8 accident types get a card here) rather than the shared
  // lookup's text resolution, which OperationsPanel.test.ts already covers
  // for all 8 types.

  describe('casualty/loss note-cards (#557)', () => {
    it('renders a death note-card with the real employee name and skull icon', () => {
      const { modal, setPlayback } = makeModal();
      const state = makeState();
      const emp = addEmployee(state, { name: 'Oz Trill' });
      state.lastBlastReport = makeReport({ accidents: [makeAccident({ type: 'death', entityId: emp.id })] });

      openReport(modal, state, setPlayback);

      expect(modal.root.textContent).toContain('Oz Trill was killed by flying rock');
      expect(modal.root.querySelector('bs-icon[name="skull"]')).not.toBeNull();
    });

    it('renders an injury note-card with the real employee name and injured icon', () => {
      const { modal, setPlayback } = makeModal();
      const state = makeState();
      const emp = addEmployee(state, { name: 'Dorian Kask' });
      state.lastBlastReport = makeReport({ accidents: [makeAccident({ type: 'injury', entityId: emp.id })] });

      openReport(modal, state, setPlayback);

      expect(modal.root.textContent).toContain('Dorian Kask was injured by flying rock');
      expect(modal.root.querySelector('bs-icon[name="injured"]')).not.toBeNull();
    });

    it('renders a vehicle_destroyed note-card naming the real vehicle type, with vehicle icon', () => {
      const { modal, setPlayback } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport({
        accidents: [makeAccident({ type: 'vehicle_destroyed', entityId: 12, entityLabel: 'debris_hauler' })],
      });

      openReport(modal, state, setPlayback);

      expect(modal.root.textContent).toContain('Debris Hauler was destroyed by flying rock');
      expect(modal.root.querySelector('bs-icon[name="vehicle"]')).not.toBeNull();
    });

    it('renders a vehicle_damage note-card naming the real vehicle type', () => {
      const { modal, setPlayback } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport({
        accidents: [makeAccident({ type: 'vehicle_damage', entityId: 12, entityLabel: 'rock_fragmenter' })],
      });

      openReport(modal, state, setPlayback);

      expect(modal.root.textContent).toContain('Rock Fragmenter took flying rock damage');
    });

    it('falls back to a generic worker label when the accident\'s employee can\'t be found', () => {
      const { modal, setPlayback } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport({ accidents: [makeAccident({ type: 'injury', entityId: 999 })] });

      openReport(modal, state, setPlayback);

      expect(modal.root.textContent).toContain('A worker was injured by flying rock');
    });

    it('does not render a note-card for a building accident — destroyedBuildings has its own dedicated card, and OperationsPanel covers the full incident history', () => {
      const { modal, setPlayback } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport({
        accidents: [makeAccident({ type: 'building_destroyed', entityId: 3, entityLabel: 'living_quarters' })],
      });

      openReport(modal, state, setPlayback);

      expect(modal.root.textContent).not.toContain('Living Quarters was destroyed');
    });

    it('renders one note-card per accident when several land on the same blast', () => {
      const { modal, setPlayback } = makeModal();
      const state = makeState();
      const empA = addEmployee(state, { name: 'Oz Trill' });
      const empB = addEmployee(state, { name: 'Dorian Kask' });
      state.lastBlastReport = makeReport({
        accidents: [
          makeAccident({ type: 'death', entityId: empA.id }),
          makeAccident({ type: 'injury', entityId: empB.id }),
        ],
      });

      openReport(modal, state, setPlayback);

      expect(modal.root.textContent).toContain('Oz Trill was killed by flying rock');
      expect(modal.root.textContent).toContain('Dorian Kask was injured by flying rock');
    });
  });
});

describe('BlastReportModal wet holes note (#1348)', () => {
  it('shows wet and fizzled counts plus the tubing hint when holes fizzled', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport({ wetHoleIds: ['H1', 'H2', 'H3'], fizzledHoleIds: ['H1', 'H2'] });
    openReport(modal, state, setPlayback);

    const text = modal.root.textContent ?? '';
    expect(text).toMatch(/wet holes: 3 \(2 fizzled\)/i);
    expect(text).toMatch(/tubing/i);
  });

  it('shows no wet note for a dry report', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    openReport(modal, state, setPlayback);

    expect(modal.root.textContent ?? '').not.toMatch(/wet holes/i);
  });

  it('shows the ok variant when holes were wet but none fizzled', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport({ wetHoleIds: ['H1', 'H2'], fizzledHoleIds: [] });
    openReport(modal, state, setPlayback);

    const text = modal.root.textContent ?? '';
    expect(text).toMatch(/wet holes: 2/i);
    expect(text).not.toMatch(/fizzled/i);
  });
});

describe('BlastReportModal rating cap note (#1349)', () => {
  for (const cap of ['death', 'casualty_or_destruction', 'wet_holes', 'oversize'] as const) {
    it(`renders the ${cap} cap note`, () => {
      const { modal, setPlayback } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport({ ratingCap: cap });
      openReport(modal, state, setPlayback);
      expect(modal.root.textContent).toContain(t(`ui.blast_workshop.report.rating_cap_${cap}`));
    });
  }

  it('renders no cap note without ratingCap', () => {
    const { modal, setPlayback } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    openReport(modal, state, setPlayback);
    for (const cap of ['death', 'casualty_or_destruction', 'wet_holes', 'oversize']) {
      expect(modal.root.textContent).not.toContain(t(`ui.blast_workshop.report.rating_cap_${cap}`));
    }
  });
});
