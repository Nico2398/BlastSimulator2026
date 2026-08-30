// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { BlastReportModal, BLAST_REPORT_DELAY_MS } from '../../../../src/ui/panels/BlastReportModal.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { resetHoleIds } from '../../../../src/core/mining/DrillPlan.js';
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
    hunger: 0, fatigue: 0, breakNeed: 0, collapsing: false, interruptedActionPayload: null,
    ticksWorked: 0, restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
    activeTaskSkill: null, destinationX: null, destinationZ: null,
    moveConsecutiveFailures: 0, isMoveStuck: false,
    pendingRestDuration: null, pendingRestNeedKey: null, pendingTaskDuration: null,
    pendingActionType: null, pendingActionPayload: null, pendingDriverVehicleId: null,
    taskQueue: [],
    ...overrides,
  };
  state.employees.employees.push(emp);
  return emp;
}

function makeAccident(overrides: Partial<AccidentRecord> = {}): AccidentRecord {
  return { tick: 0, type: 'injury', entityId: 1, fragmentId: 1, kineticEnergy: 200, ...overrides };
}

/**
 * Injects a fake, manually-advanced clock (#545) — `setNow()` drives the same
 * `now` closure variable the modal's constructor was handed, so tests control
 * real-time delay without a real timer.
 */
function makeModal(): { modal: BlastReportModal; container: HTMLElement; setNow: (v: number) => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let now = 0;
  const modal = new BlastReportModal(container, () => now);
  return { modal, container, setNow: (v: number) => { now = v; } };
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
function openReport(modal: BlastReportModal, state: GameState, setNow: (v: number) => void): void {
  modal.update(state);
  setNow(BLAST_REPORT_DELAY_MS);
  modal.update(state);
}

beforeEach(() => resetHoleIds());

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

    modal.update(state);

    expect(modal.visible).toBe(false);
    expect(modal.pending).toBe(true);
  });

  it('stays closed just before the open delay has elapsed (#545)', () => {
    const { modal, setNow } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    modal.update(state);

    setNow(BLAST_REPORT_DELAY_MS - 1);
    modal.update(state);

    expect(modal.visible).toBe(false);
    expect(modal.pending).toBe(true);
  });

  it('opens once the delay has elapsed, rendering the held report\'s real stats (#545)', () => {
    const { modal, setNow } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();

    openReport(modal, state, setNow);

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
    const { modal, setNow } = makeModal();
    const state = makeState();
    const reportA = makeReport({ fragmentCount: 47, totalOreValue: 16020 });
    state.lastBlastReport = reportA;
    modal.update(state); // arms A at now=0
    expect(modal.visible).toBe(false);
    expect(modal.root.textContent).not.toContain('16,020');

    setNow(1000);
    const reportB = makeReport({ fragmentCount: 12, totalOreValue: 12345 });
    state.lastBlastReport = reportB;
    modal.update(state); // B replaces A well before A's own deadline (3000)

    expect(modal.visible).toBe(false); // A never opened
    expect(modal.root.textContent).not.toContain('16,020'); // A's stat never rendered

    // B's own fresh full window, counted from when B was armed (now=1000).
    setNow(1000 + BLAST_REPORT_DELAY_MS);
    modal.update(state);

    expect(modal.visible).toBe(true);
    expect(modal.pending).toBe(false);
    expect(modal.root.textContent).toContain('12,345');
    expect(modal.root.textContent).not.toContain('16,020');
  });

  it('Close hides the modal', () => {
    const { modal, setNow } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    openReport(modal, state, setNow);

    (modal.root.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();

    expect(modal.visible).toBe(false);
  });

  it('does not reopen on the next tick for the same report once closed', () => {
    const { modal, setNow } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    openReport(modal, state, setNow);
    (modal.root.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();

    modal.update(state); // same report object, time unchanged

    expect(modal.visible).toBe(false);
  });

  it('opens again for a genuinely new report (different tick)', () => {
    const { modal, setNow } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport({ tick: 100 });
    openReport(modal, state, setNow);
    (modal.root.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();

    setNow(BLAST_REPORT_DELAY_MS + 1);
    state.lastBlastReport = makeReport({ tick: 200 });
    modal.update(state); // arms the new report

    expect(modal.visible).toBe(false);

    setNow(BLAST_REPORT_DELAY_MS + 1 + BLAST_REPORT_DELAY_MS);
    modal.update(state);

    expect(modal.visible).toBe(true);
  });

  it('opens again for a second blast fired on the same tick', () => {
    // Nothing forces the clock to advance between two plans — a player (or a
    // scripted sequence) can drill/charge/sequence/fire twice with no tick
    // command in between, so both reports land on the same state.tickCount.
    // Gating on tick equality alone made the second report never reopen; the
    // fix compares report identity instead (buildBlastReport in mining.ts
    // always returns a fresh object, so two distinct blasts are always two
    // distinct references even when their tick matches). Issue #479.
    const { modal, setNow } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport({ tick: 100, fragmentCount: 47 });
    openReport(modal, state, setNow);
    (modal.root.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();
    expect(modal.visible).toBe(false);

    setNow(BLAST_REPORT_DELAY_MS + 1);
    state.lastBlastReport = makeReport({ tick: 100, fragmentCount: 12 });
    modal.update(state); // arms the second blast's report

    expect(modal.visible).toBe(false); // still waiting out its own delay

    setNow(BLAST_REPORT_DELAY_MS + 1 + BLAST_REPORT_DELAY_MS);
    modal.update(state);

    expect(modal.visible).toBe(true);
    expect(modal.root.textContent).toContain('12');
  });

  it('shows the ore report card with real percentage and breakdown when a survey estimate exists', () => {
    const { modal, setNow } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    state.lastOreReport = {
      oreYields: { craktonite: 3900, rustite: 1320 },
      totalYieldKg: 5220, estimatedYieldKg: 6100, yieldRatio: 5220 / 6100,
      hasTreranium: false, absurdiumFraction: 0,
    };

    openReport(modal, state, setNow);

    expect(modal.root.textContent).toContain('86%');
    expect(modal.root.textContent).toContain('5220 kg');
    expect(modal.root.textContent).toContain('6100 kg');
  });

  it('omits the ore report card when there was no survey estimate to compare against', () => {
    const { modal, setNow } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    state.lastOreReport = {
      oreYields: {}, totalYieldKg: 0, estimatedYieldKg: 0, yieldRatio: 1,
      hasTreranium: false, absurdiumFraction: 0,
    };

    openReport(modal, state, setNow);

    expect(modal.root.textContent).not.toContain('Ore Report');
  });

  it('shows one card per destroyed building', () => {
    const { modal, setNow } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport({
      destroyedBuildings: [{ buildingId: 3, type: 'freight_warehouse', x: 5, z: 5 }],
    });

    openReport(modal, state, setNow);

    expect(modal.root.textContent).toContain('Freight Warehouse #3');
    expect(modal.root.textContent).toContain('was destroyed');
  });

  it('shows the oversized-fragments hint, naming the real rock_fragmenter vehicle, only when there are any', () => {
    const { modal: modalA, setNow: setNowA } = makeModal();
    const stateA = makeState();
    stateA.lastBlastReport = makeReport({ oversizedFragments: 0 });
    openReport(modalA, stateA, setNowA);
    expect(modalA.root.textContent).not.toContain('too large for standard haulers');

    const { modal: modalB, setNow: setNowB } = makeModal();
    const stateB = makeState();
    stateB.lastBlastReport = makeReport({ oversizedFragments: 6 });
    openReport(modalB, stateB, setNowB);
    expect(modalB.root.textContent).toContain('6 fragments are too large for standard haulers');
    expect(modalB.root.textContent).toContain('Rock Fragmenter');
  });

  it('reset() clears a pending report so it never opens (#545)', () => {
    const { modal, setNow } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    modal.update(state); // arms the report at now=0
    expect(modal.pending).toBe(true);

    modal.reset();

    expect(modal.pending).toBe(false);
    expect(modal.visible).toBe(false);

    // Level-transition sequence: a fresh GameState (new_game/campaign/sandbox
    // entry), whose lastBlastReport always starts null — mirrors the real
    // enteredNewLevel guard, not a reuse of the same stale state object.
    const freshState = makeState();
    setNow(BLAST_REPORT_DELAY_MS * 10);
    modal.update(freshState);

    expect(modal.visible).toBe(false);
    expect(modal.pending).toBe(false);
  });

  it('reset() also hides an already-open modal (#545)', () => {
    const { modal, setNow } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport();
    openReport(modal, state, setNow);
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
    const { modal, setNow } = makeModal();
    const state = makeState();
    const original = makeReport({ tick: 100 });
    state.lastBlastReport = original;
    openReport(modal, state, setNow);
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
    modal.update(newState);

    expect(modal.pending).toBe(false);
    expect(modal.visible).toBe(false);

    // Stays closed even once the report's would-be open delay fully elapses.
    setNow(BLAST_REPORT_DELAY_MS * 20);
    modal.update(newState);

    expect(modal.pending).toBe(false);
    expect(modal.visible).toBe(false);
  });

  it('reset() with no argument leaves lastShownReport at null, same as before — a later new report still arms and opens normally (#571)', () => {
    const { modal, setNow } = makeModal();
    const state = makeState();
    state.lastBlastReport = makeReport({ tick: 100 });
    modal.update(state); // arms it (pending)

    modal.reset(); // no argument — the pre-#571 call shape

    expect(modal.pending).toBe(false);
    expect(modal.visible).toBe(false);

    const freshState = makeState();
    freshState.lastBlastReport = makeReport({ tick: 999 }); // genuinely new report
    modal.update(freshState);
    expect(modal.pending).toBe(true); // arms normally — nothing was wrongly suppressed

    setNow(BLAST_REPORT_DELAY_MS);
    modal.update(freshState);
    expect(modal.visible).toBe(true);
  });

  it('reset(currentReport) discards an actively pending report outright — it does not resurrect once discarded, even when currentReport is that exact pending report (#571)', () => {
    const { modal, setNow } = makeModal();
    const state = makeState();
    const pending = makeReport({ tick: 50 });
    state.lastBlastReport = pending;
    modal.update(state); // arms `pending`, still waiting out its delay
    expect(modal.pending).toBe(true);

    // A level transition / save-load lands mid-delay: currentReport here is
    // that exact same pending report reference (e.g. an immediate reload
    // before the report ever had a chance to open) — it must never surface.
    modal.reset(pending);

    expect(modal.pending).toBe(false);
    expect(modal.visible).toBe(false);

    // Even once its original deadline would have elapsed, on the same state
    // object with the same report reference, it stays suppressed.
    setNow(BLAST_REPORT_DELAY_MS);
    modal.update(state);

    expect(modal.pending).toBe(false);
    expect(modal.visible).toBe(false);
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
      const { modal, setNow } = makeModal();
      const state = makeState();
      const emp = addEmployee(state, { name: 'Oz Trill' });
      state.lastBlastReport = makeReport({ accidents: [makeAccident({ type: 'death', entityId: emp.id })] });

      openReport(modal, state, setNow);

      expect(modal.root.textContent).toContain('Oz Trill was killed by a projection');
      expect(modal.root.querySelector('bs-icon[name="skull"]')).not.toBeNull();
    });

    it('renders an injury note-card with the real employee name and injured icon', () => {
      const { modal, setNow } = makeModal();
      const state = makeState();
      const emp = addEmployee(state, { name: 'Dorian Kask' });
      state.lastBlastReport = makeReport({ accidents: [makeAccident({ type: 'injury', entityId: emp.id })] });

      openReport(modal, state, setNow);

      expect(modal.root.textContent).toContain('Dorian Kask was injured by a projection');
      expect(modal.root.querySelector('bs-icon[name="injured"]')).not.toBeNull();
    });

    it('renders a vehicle_destroyed note-card naming the real vehicle type, with vehicle icon', () => {
      const { modal, setNow } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport({
        accidents: [makeAccident({ type: 'vehicle_destroyed', entityId: 12, entityLabel: 'debris_hauler' })],
      });

      openReport(modal, state, setNow);

      expect(modal.root.textContent).toContain('Debris Hauler was destroyed by a projection');
      expect(modal.root.querySelector('bs-icon[name="vehicle"]')).not.toBeNull();
    });

    it('renders a vehicle_damage note-card naming the real vehicle type', () => {
      const { modal, setNow } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport({
        accidents: [makeAccident({ type: 'vehicle_damage', entityId: 12, entityLabel: 'rock_fragmenter' })],
      });

      openReport(modal, state, setNow);

      expect(modal.root.textContent).toContain('Rock Fragmenter took projection damage');
    });

    it('falls back to a generic worker label when the accident\'s employee can\'t be found', () => {
      const { modal, setNow } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport({ accidents: [makeAccident({ type: 'injury', entityId: 999 })] });

      openReport(modal, state, setNow);

      expect(modal.root.textContent).toContain('A worker was injured by a projection');
    });

    it('does not render a note-card for a building accident — destroyedBuildings has its own dedicated card, and OperationsPanel covers the full incident history', () => {
      const { modal, setNow } = makeModal();
      const state = makeState();
      state.lastBlastReport = makeReport({
        accidents: [makeAccident({ type: 'building_destroyed', entityId: 3, entityLabel: 'living_quarters' })],
      });

      openReport(modal, state, setNow);

      expect(modal.root.textContent).not.toContain('Living Quarters was destroyed');
    });

    it('renders one note-card per accident when several land on the same blast', () => {
      const { modal, setNow } = makeModal();
      const state = makeState();
      const empA = addEmployee(state, { name: 'Oz Trill' });
      const empB = addEmployee(state, { name: 'Dorian Kask' });
      state.lastBlastReport = makeReport({
        accidents: [
          makeAccident({ type: 'death', entityId: empA.id }),
          makeAccident({ type: 'injury', entityId: empB.id }),
        ],
      });

      openReport(modal, state, setNow);

      expect(modal.root.textContent).toContain('Oz Trill was killed by a projection');
      expect(modal.root.textContent).toContain('Dorian Kask was injured by a projection');
    });
  });
});
