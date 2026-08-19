// @vitest-environment jsdom
// BlastSimulator2026 — UIManager NavGrid overlay wiring (issue #407)
//
// Regression coverage: UIManager never fed the live NavGrid into the MiniMap,
// and toggleNavGridOverlay() was an empty stub, so there was no player-facing
// way to see the nav-grid overlay even though MiniMap's drawing code was correct.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIManager } from '../../../src/ui/UIManager.js';
import { MiniMap } from '../../../src/ui/MiniMap.js';
import { CrewPanel } from '../../../src/ui/panels/CrewPanel.js';
import { SurveyPanel } from '../../../src/ui/panels/SurveyPanel.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { t, setLocale, getLocale } from '../../../src/core/i18n/I18n.js';
import type { BlastReport } from '../../../src/core/mining/BlastExecution.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import { BLAST_REPORT_DELAY_MS } from '../../../src/ui/panels/BlastReportModal.js';
import { setupEvents } from '../../../src/core/events/index.js';

setupEvents();

function makeState() {
  const state = createGame({ seed: 1, mineType: 'desert' });
  // Give the state a real, non-null NavGrid so the assertion below verifies
  // actual object pass-through, not just a null default.
  const grid = new VoxelGrid(4, 4, 4);
  for (let z = 0; z < 4; z++)
    for (let x = 0; x < 4; x++)
      grid.setVoxel(x, 0, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
  state.navGrid = NavGrid.buildNavGrid(grid, [], []);
  return state;
}

describe('UIManager — NavGrid overlay wiring', () => {
  let container: HTMLElement;
  let uiManager: UIManager | null;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    uiManager = null;
  });

  afterEach(() => {
    uiManager?.dispose();
    container.remove();
    vi.restoreAllMocks();
  });

  it('update() feeds the current GameState.navGrid into the MiniMap', () => {
    // jsdom has no real canvas backend, so MiniMap.update()'s canvas drawing
    // would throw regardless of this fix — stub it out and verify only the
    // navGrid-feeding wiring under test.
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    const setNavGridSpy = vi.spyOn(MiniMap.prototype, 'setNavGrid');
    uiManager = new UIManager(container);
    const state = makeState();

    uiManager.update(state);

    expect(setNavGridSpy).toHaveBeenCalledWith(state.navGrid);
  });

  it('update() re-feeds the NavGrid on every call', () => {
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    const setNavGridSpy = vi.spyOn(MiniMap.prototype, 'setNavGrid');
    uiManager = new UIManager(container);
    const state = makeState();

    uiManager.update(state);
    uiManager.update(state);
    uiManager.update(state);

    expect(setNavGridSpy).toHaveBeenCalledTimes(3);
  });

  it('toggleNavGridOverlay() turns the overlay on from its default-off state', () => {
    const setVisibleSpy = vi.spyOn(MiniMap.prototype, 'setNavGridVisible');
    uiManager = new UIManager(container);

    uiManager.toggleNavGridOverlay();

    expect(setVisibleSpy).toHaveBeenCalledWith(true);
  });

  it('toggleNavGridOverlay() flips back off on a second call', () => {
    const setVisibleSpy = vi.spyOn(MiniMap.prototype, 'setNavGridVisible');
    uiManager = new UIManager(container);

    uiManager.toggleNavGridOverlay();
    uiManager.toggleNavGridOverlay();

    expect(setVisibleSpy).toHaveBeenNthCalledWith(1, true);
    expect(setVisibleSpy).toHaveBeenNthCalledWith(2, false);
  });

  it('toggleNavGridOverlay() alternates on repeated calls', () => {
    const setVisibleSpy = vi.spyOn(MiniMap.prototype, 'setNavGridVisible');
    uiManager = new UIManager(container);

    uiManager.toggleNavGridOverlay();
    uiManager.toggleNavGridOverlay();
    uiManager.toggleNavGridOverlay();

    expect(setVisibleSpy).toHaveBeenNthCalledWith(3, true);
  });
});

// ── Locale switch re-renders owned panels + toolbar (issue #457, bug 1) ───────
//
// Nothing wired SettingsMenu's language buttons into the rest of the app, so
// switching locale flipped I18n's global state but left every panel showing
// whatever locale was active when its constructor last called t(). These
// tests click the real DOM button a player uses (never call setLocale()
// directly) and check text that was baked in at construction time.

/** Clicks the Settings panel's French language button the way a player would. */
function clickFrenchButton(container: HTMLElement): void {
  const settingsPanel = container.querySelector('#bs-settings-panel');
  if (!settingsPanel) throw new Error('#bs-settings-panel not found');
  const frBtn = Array.from(settingsPanel.querySelectorAll<HTMLButtonElement>('button'))
    .find((b) => b.textContent === t('ui.settings.french'));
  if (!frBtn) throw new Error('French language button not found');
  frBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('UIManager — locale refresh on language switch (issue #457)', () => {
  let container: HTMLElement;
  let uiManager: UIManager | null;

  beforeEach(() => {
    setLocale('en');
    container = document.createElement('div');
    document.body.appendChild(container);
    uiManager = null;
  });

  afterEach(() => {
    uiManager?.dispose();
    container.remove();
    setLocale('en');
    vi.restoreAllMocks();
  });

  it('tool rail button captions switch language after clicking FR in Settings', () => {
    uiManager = new UIManager(container);
    const blastRailBtn = container.querySelector<HTMLButtonElement>(
      '#bs-toolbar [data-panel="blast"]',
    );
    expect(blastRailBtn?.textContent).toBe(t('shell.rail.blast'));

    clickFrenchButton(container);

    expect(getLocale()).toBe('fr');
    expect(blastRailBtn?.textContent).toBe(t('shell.rail.blast'));
    expect(blastRailBtn?.textContent).not.toBe('Blast');
  });

  it('every tool rail button caption switches language, not just one', () => {
    uiManager = new UIManager(container);
    const panelKeys: [string, string][] = [
      ['blast', 'shell.rail.blast'],
      ['contracts', 'shell.rail.contracts'],
      ['build', 'shell.rail.build'],
      ['vehicles', 'shell.rail.vehicles'],
      ['employees', 'shell.rail.employees'],
      ['survey', 'shell.rail.survey'],
      ['settings', 'shell.rail.settings'],
    ];
    const before = panelKeys.map(([panel]) =>
      container.querySelector<HTMLButtonElement>(`#bs-toolbar [data-panel="${panel}"]`)?.textContent,
    );

    clickFrenchButton(container);

    for (let i = 0; i < panelKeys.length; i++) {
      const [panel, key] = panelKeys[i]!;
      const btn = container.querySelector<HTMLButtonElement>(`#bs-toolbar [data-panel="${panel}"]`);
      expect(btn?.textContent, `tool rail button "${panel}" must switch language`).not.toBe(before[i]);
      expect(btn?.textContent).toBe(t(key));
    }
  });

  it('the currently shown panel\'s static title switches language', () => {
    uiManager = new UIManager(container);
    uiManager.showPanel('vehicles');
    const fleetPanel = container.querySelector('#bs-vehicle-panel') as HTMLElement;
    expect(fleetPanel.textContent).toContain(t('ui.fleet.title')); // English baseline
    expect(t('ui.fleet.title')).toBe('Fleet');

    clickFrenchButton(container);

    expect(fleetPanel.textContent).toContain(t('ui.fleet.title'));
    expect(fleetPanel.textContent).not.toContain('Fleet');
  });

  it('every owned panel with a .bs-panel-title re-renders to a different string after the switch', () => {
    uiManager = new UIManager(container);
    const titleEls = Array.from(container.querySelectorAll('.bs-panel-title'));
    // Sanity: UIManager owns at least one titled panel still on the legacy
    // .bs-panel-title class (minimap).
    // Blast (P4), Contracts/Finances/Operations (P5), Fleet/Crew (P6),
    // Survey (P7), the event modal (P8, EventModal replacing EventDialog),
    // and Build/Settings (P10) migrated to the redesign's own title markup
    // and no longer count here — each surface-by-surface migration shrinks
    // this number further, same as it did when Blast moved off .bs-panel-title.
    expect(titleEls.length).toBeGreaterThanOrEqual(1);
    const before = titleEls.map((el) => el.textContent);

    clickFrenchButton(container);

    const after = titleEls.map((el) => el.textContent);
    for (let i = 0; i < titleEls.length; i++) {
      expect(after[i], `panel title #${i} ("${before[i]}") must change on locale switch`).not.toBe(before[i]);
    }
  });

  it('setLanguageChangeHandler(cb) still receives the new language after UIManager wires its own refresh', () => {
    uiManager = new UIManager(container);
    const cb = vi.fn();
    uiManager.setLanguageChangeHandler(cb);

    clickFrenchButton(container);

    expect(cb).toHaveBeenCalledWith('fr');
  });

  it('external setLanguageChangeHandler callback does not suppress UIManager\'s own panel refresh', () => {
    uiManager = new UIManager(container);
    uiManager.setLanguageChangeHandler(() => {});
    // Build (P10) moved off the legacy .bs-panel-title class onto the
    // shared bsx-root header — its title has no dedicated selector anymore
    // (same as Fleet/Contracts above), so check the whole panel's text.
    const buildPanel = container.querySelector('#bs-build-panel') as HTMLElement;
    expect(buildPanel.textContent).toContain(t('ui.build.title'));

    clickFrenchButton(container);

    expect(buildPanel.textContent).toContain(t('ui.build.title'));
    expect(buildPanel.textContent).not.toContain('Build');
  });

  it('calling refreshLocale() directly re-renders every owned panel title to the current locale', () => {
    uiManager = new UIManager(container);
    setLocale('fr');

    uiManager.refreshLocale();

    const buildPanel = container.querySelector('#bs-build-panel') as HTMLElement;
    expect(buildPanel.textContent).toContain(t('ui.build.title'));
    expect(buildPanel.textContent).not.toContain('Build');
  });
});

describe('UIManager — showEmployeeDetail (scene selection DETAIL/TRAIN, P2)', () => {
  let container: HTMLDivElement;
  let uiManager: UIManager;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    uiManager?.dispose();
    container.remove();
    vi.restoreAllMocks();
  });

  it('opens the Crew panel', () => {
    uiManager = new UIManager(container);
    uiManager.showEmployeeDetail(3);
    const panel = container.querySelector('#bs-employee-panel') as HTMLElement;
    expect(panel.style.display).not.toBe('none');
  });

  it('expands the given employee\'s card in the Crew panel', () => {
    const expandSpy = vi.spyOn(CrewPanel.prototype, 'expandEmployee');
    uiManager = new UIManager(container);

    uiManager.showEmployeeDetail(3);

    expect(expandSpy).toHaveBeenCalledWith(3);
  });
});

// ── Survey confidence overlay toggle wiring (#496) ──────────────────────────
describe('UIManager — survey overlay toggle wiring (#496)', () => {
  let container: HTMLDivElement;
  let uiManager: UIManager;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    uiManager?.dispose();
    container.remove();
    vi.restoreAllMocks();
  });

  it('setSurveyOverlayToggleHandler(cb) + a real click on the open panel\'s toggle button invokes cb with the new boolean', () => {
    uiManager = new UIManager(container);
    const cb = vi.fn();
    uiManager.setSurveyOverlayToggleHandler(cb);
    uiManager.showPanel('survey');

    const btn = container.querySelector<HTMLButtonElement>('[data-role="overlay-toggle"]')!;
    expect(btn).not.toBeNull();
    btn.click();

    expect(cb).toHaveBeenCalledWith(false);
  });

  it('setSurveyOverlayVisible(visible) delegates to SurveyPanel.setOverlayVisible', () => {
    const setOverlaySpy = vi.spyOn(SurveyPanel.prototype, 'setOverlayVisible');
    uiManager = new UIManager(container);

    uiManager.setSurveyOverlayVisible(false);

    expect(setOverlaySpy).toHaveBeenCalledWith(false);
  });

  it('setSurveyOverlayVisible(false) updates the panel\'s toggle button state (mirrors the NavGrid overlay wiring)', () => {
    uiManager = new UIManager(container);
    uiManager.showPanel('survey');
    const btn = container.querySelector<HTMLButtonElement>('[data-role="overlay-toggle"]')!;
    const before = btn.outerHTML;

    uiManager.setSurveyOverlayVisible(false);

    expect(btn.outerHTML).not.toBe(before);
  });
});

// ── closeStaleLevelOverlays: BlastReportModal left open across a level
// re-entry (#504) ─────────────────────────────────────────────────────────
//
// A second `sandbox start` (or any direct level-entry command) previously
// left the FIRST site's Blast Report modal stuck open over the new site's
// terrain — nothing ever closed it, since BlastReportModal.update() only
// ever opens itself on a fresh report and a new GameState's lastBlastReport
// starts null. closeStaleLevelOverlays() is main.ts's fix, wired into the
// same `enteredNewLevel` guard that also hides the main menu.

function makeBlastReport(tick: number): BlastReport {
  return {
    tick,
    rating: 'good',
    clearedVoxels: 12,
    crackedVoxels: 3,
    fragmentCount: 6,
    oversizedFragments: 0,
    totalRockVolume: 24,
    projectionCount: 0,
    maxProjectionDistanceM: 0,
    totalOreValue: 500,
    spent: 200,
    destroyedBuildings: [],
  };
}

function makeStateWithReport(tick: number): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.lastBlastReport = makeBlastReport(tick);
  return state;
}

describe('UIManager — closeStaleLevelOverlays (#504)', () => {
  let container: HTMLDivElement;
  let uiManager: UIManager;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    uiManager?.dispose();
    container.remove();
    vi.restoreAllMocks();
  });

  it('closes a BlastReportModal left open from a previous site\'s last blast', () => {
    // jsdom has no real canvas backend — stub MiniMap.update() the same way
    // the NavGrid overlay tests above do, since UIManager.update() also
    // drives the minimap.
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    // Blast reports arm on first sight and only open once real time (via
    // performance.now()) advances past BLAST_REPORT_DELAY_MS (#545) — mock
    // the clock so this test can reach a genuinely visible modal before
    // testing that closeStaleLevelOverlays() closes it.
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    uiManager = new UIManager(container);
    // Simulate the first site's blast report arriving, the way a real
    // `blast` command's uiManager.update(state) call does.
    const state = makeStateWithReport(10);
    uiManager.update(state); // arms the report (pending)

    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS);
    uiManager.update(state); // delay elapsed — report opens
    expect(uiManager.blastReportModalVisible).toBe(true);

    uiManager.closeStaleLevelOverlays();

    expect(uiManager.blastReportModalVisible).toBe(false);
  });

  it('is a no-op when no BlastReportModal is open', () => {
    uiManager = new UIManager(container);
    expect(uiManager.blastReportModalVisible).toBe(false);

    expect(() => uiManager.closeStaleLevelOverlays()).not.toThrow();

    expect(uiManager.blastReportModalVisible).toBe(false);
  });

  it('clears a pending (not yet opened) report too, and a fresh level state stays closed/non-pending as time advances (#545)', () => {
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    uiManager = new UIManager(container);
    // Report has arrived but is still waiting out its real-time open delay —
    // never actually opened the modal.
    uiManager.update(makeStateWithReport(10));
    expect(uiManager.blastReportModalPending).toBe(true);
    expect(uiManager.blastReportModalVisible).toBe(false);

    uiManager.closeStaleLevelOverlays();

    expect(uiManager.blastReportModalPending).toBe(false);

    // Level-transition semantics: a genuinely fresh GameState, whose
    // lastBlastReport starts null (mirrors the real enteredNewLevel guard) —
    // not a reuse of the same stale state object.
    const freshState = createGame({ seed: 1, mineType: 'desert' });
    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS * 10);
    uiManager.update(freshState);

    expect(uiManager.blastReportModalPending).toBe(false);
    expect(uiManager.blastReportModalVisible).toBe(false);
  });
});

// ── Blast report deferral holds off the event modal (#545) ─────────────────
//
// Both BlastReportModal and EventModal are auto-triggered off GameState, and
// eventModal is deferred while blastReportModal.visible is true so a
// same-tick scripted follow-up event can't render on top of the report and
// hide its Close button. The deferral has to key off "still on screen or
// about to be" (pending OR visible), not just visible — otherwise a report
// that has arrived but not yet opened (still waiting out its real-time
// delay) lets the event modal open underneath it.

function makeStateWithReportAndEvent(tick: number): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.lastBlastReport = makeBlastReport(tick);
  state.events.pendingEvent = { eventId: 'tutorial_synergy_consultant', firedAtTick: tick };
  return state;
}

describe('UIManager — blast report deferral holds the event modal (#545)', () => {
  let container: HTMLDivElement;
  let uiManager: UIManager;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
  });

  afterEach(() => {
    uiManager?.dispose();
    container.remove();
    vi.restoreAllMocks();
  });

  it('event modal stays closed while the report is pending (arrived but not yet opened)', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    uiManager = new UIManager(container);
    const state = makeStateWithReportAndEvent(10);

    uiManager.update(state);

    expect(uiManager.blastReportModalPending).toBe(true);
    expect(uiManager.blastReportModalVisible).toBe(false);
    const eventDialog = container.querySelector('#bs-event-dialog') as HTMLElement;
    expect(eventDialog.style.display).toBe('none');
  });

  it('event modal opens once the report is closed', () => {
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    uiManager = new UIManager(container);
    const state = makeStateWithReportAndEvent(10);
    uiManager.update(state); // arms the report

    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS);
    uiManager.update(state); // report opens

    expect(uiManager.blastReportModalVisible).toBe(true);
    let eventDialog = container.querySelector('#bs-event-dialog') as HTMLElement;
    expect(eventDialog.style.display).toBe('none');

    (container.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();
    uiManager.update(state);

    expect(uiManager.blastReportModalVisible).toBe(false);
    eventDialog = container.querySelector('#bs-event-dialog') as HTMLElement;
    expect(eventDialog.style.display).not.toBe('none');
  });
});

// ── Fleet panel vehicle-select delegation (#512) ────────────────────────────
//
// A 3+ vehicle fleet gets snapped onto the same NavGrid cell by `vehicle
// buy`, so scene-raycast selection can only ever hit one of them.
// setSelectVehicleHandler delegates to FleetPanel, whose rows are clickable
// and route through ScenePicking.select() (main.ts owns that wiring). This
// only proves UIManager's own delegation plumbing — FleetPanel's click
// behavior itself is covered by FleetPanel.test.ts.

function makeVehicle(id: number): Vehicle {
  return {
    id, type: 'debris_hauler', tier: 1, x: 5, z: 5, hp: 100, task: 'idle',
    targetX: 5, targetZ: 5, driverId: null, state: 'idle', payloadKg: 0,
    waitingTicks: 0, moveConsecutiveFailures: 0, isMoveStuck: false,
    haulingFragmentId: null, haulingPhase: null, haulingDepotBuildingId: null,
  };
}

describe('UIManager — Fleet panel vehicle-select delegation (#512)', () => {
  let container: HTMLDivElement;
  let uiManager: UIManager;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    uiManager?.dispose();
    container.remove();
    vi.restoreAllMocks();
  });

  it('setSelectVehicleHandler(cb) + a real click on a Fleet panel vehicle row invokes cb with that vehicle\'s real id', () => {
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    uiManager = new UIManager(container);
    const cb = vi.fn();
    uiManager.setSelectVehicleHandler(cb);
    uiManager.showPanel('vehicles');

    const state = createGame({ seed: 1, mineType: 'desert' });
    state.vehicles.vehicles = [makeVehicle(1), makeVehicle(2), makeVehicle(3)];
    state.vehicles.nextId = 4;
    uiManager.update(state);

    const row = container.querySelector('#bs-vehicle-panel [data-vehicle-id="2"]') as HTMLElement;
    expect(row).not.toBeNull();
    row.click();

    expect(cb).toHaveBeenCalledWith(2);
  });
});

// blastActiveStep (PR #616 review round, item 7): the scenario harness's
// __uiState() bridge (main.ts) reads this to drive the new ensureStep
// interaction action, which asserts-or-clicks a Blast Workshop step tab
// instead of a scenario assuming what a preceding step left active.
describe('UIManager — blastActiveStep (#616 review round, item 7)', () => {
  let container: HTMLDivElement;
  let uiManager: UIManager;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    uiManager?.dispose();
    container.remove();
    vi.restoreAllMocks();
  });

  it('defaults to the Drill step (1)', () => {
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    uiManager = new UIManager(container);
    expect(uiManager.blastActiveStep).toBe(1);
  });

  it('tracks a real tab click inside the Blast Workshop panel', () => {
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    uiManager = new UIManager(container);
    uiManager.showPanel('blast');

    const chargeTab = Array.from(container.querySelectorAll('#bs-blast-panel button'))
      .find(b => b.textContent?.includes('Charge')) as HTMLButtonElement;
    expect(chargeTab).not.toBeUndefined();
    chargeTab.click();

    expect(uiManager.blastActiveStep).toBe(2);
  });
});
