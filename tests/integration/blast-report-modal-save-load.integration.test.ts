// @vitest-environment jsdom
// BlastSimulator2026 — Integration: BlastReportModal does not re-arm after a
// save/load round trip once already dismissed (#571)
//
// Bug: BlastReportModal.reset() never stamped lastShownReport. main.ts's
// enteredNewLevel guard (ctx.state !== prevState) fires on any ctx.state
// identity change — including `load`, whose loadCommand (saveload.ts)
// deserializes into a fresh state object whose lastBlastReport is
// structurally identical to, but a different reference than, the one that
// was already dismissed before saving — and calls
// uiManager.closeStaleLevelOverlays(ctx.state). Because reset() dropped the
// report it was handed on the floor, the very next update() tick treated the
// reloaded report as new (reference inequality against the untouched
// lastShownReport) and re-armed the modal, popping it back open ~3s
// (BLAST_REPORT_DELAY_MS) after the load with no blast having actually
// happened.
//
// This test drives the real console command layer (createRunner, real
// ticks) exactly the way src/main.ts does, then replicates main.ts's own
// enteredNewLevel branch by hand (see runGameCommand in src/main.ts) rather
// than instantiating the full renderer, matching the established pattern in
// tests/integration/tutorial-pause.integration.test.ts.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { MiningContext } from '../../src/console/commands/mining.js';
import { UIManager } from '../../src/ui/UIManager.js';
import { MiniMap } from '../../src/ui/MiniMap.js';
import { BLAST_REPORT_DELAY_MS } from '../../src/ui/panels/BlastReportModal.js';
import type { ConsoleRunner } from '../../src/console/ConsoleRunner.js';
import type { BlastReport } from '../../src/core/mining/BlastExecution.js';

/**
 * Fires one real blast through the console command layer — drill, charge,
 * sequence, blast — draining the queued PendingActions between each planning
 * command the same way tests/integration/tutorial-pause.integration.test.ts's
 * haul-debris test does (#552/#554: drilling and charging are real,
 * worker-gated work, not instant). Needs are topped up every tick so a solo
 * staffed crew can't be derailed by a needs collapse mid-drive.
 */
function fireBlast(runner: ConsoleRunner, ctx: MiningContext): void {
  expect(runner.run('new_game seed:42 size:32 staffed:true').success).toBe(true);
  expect(runner.run('drill_plan grid rows:2 cols:2 spacing:5 depth:6 start:14,14').success).toBe(true);
  for (let i = 0; i < 400 && ctx.state!.plannedDrillHoles.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.fatigue = 100;
    }
    runner.run('tick 1');
  }
  expect(ctx.state!.plannedDrillHoles.length).toBe(0);

  expect(runner.run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
  for (let i = 0; i < 400 && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.fatigue = 100;
    }
    runner.run('tick 1');
  }
  expect(Object.keys(ctx.state!.plannedChargesByHole).length).toBe(0);

  expect(runner.run('sequence auto delay_step:25').success).toBe(true);
  expect(runner.run('blast').success).toBe(true);
  expect(ctx.state!.lastBlastReport).not.toBeNull();
}

/**
 * Replicates main.ts's runGameCommand enteredNewLevel branch by hand:
 * whenever ctx.state's identity changes (new_game/campaign/sandbox entry —
 * and `load`), main.ts calls uiManager.closeStaleLevelOverlays(ctx.state).
 */
function simulateEnteredNewLevel(uiManager: UIManager, ctx: MiningContext): void {
  uiManager.closeStaleLevelOverlays(ctx.state!);
}

describe('BlastReportModal — does not re-arm after save/load once dismissed (#571)', () => {
  let container: HTMLDivElement;
  let uiManager: UIManager;

  afterEach(() => {
    uiManager?.dispose();
    container?.remove();
    vi.restoreAllMocks();
  });

  it('dismiss → save → load → advancing real time past the open delay leaves the modal closed', () => {
    // jsdom has no real canvas backend (no `canvas` npm package) — stub
    // MiniMap.update() the same way tests/unit/ui/UIManager.test.ts does,
    // since UIManager.update() unconditionally drives the minimap.
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    container = document.createElement('div');
    document.body.appendChild(container);
    uiManager = new UIManager(container);

    const { runner, ctx } = createRunner();
    fireBlast(runner, ctx);

    // Arm + open the report the same way main.ts's per-frame uiManager.update(ctx.state) does.
    uiManager.update(ctx.state!);
    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS);
    uiManager.update(ctx.state!);
    expect(uiManager.blastReportModalVisible).toBe(true);

    // Player dismisses before saving.
    (container.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();
    expect(uiManager.blastReportModalVisible).toBe(false);

    expect(runner.run('save').success).toBe(true);

    const prevState = ctx.state;
    expect(runner.run('load').success).toBe(true);
    expect(ctx.state).not.toBe(prevState); // loadCommand replaced the object
    expect(ctx.state!.lastBlastReport).not.toBeNull();
    expect(ctx.state!.lastBlastReport).not.toBe(prevState!.lastBlastReport); // reference-distinct
    expect(ctx.state!.lastBlastReport).toEqual(prevState!.lastBlastReport); // structurally identical

    simulateEnteredNewLevel(uiManager, ctx);

    // Advance real time well past the open delay across several frames, the
    // way the render loop's per-frame update() calls do.
    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS * 2);
    uiManager.update(ctx.state!);
    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS * 10);
    uiManager.update(ctx.state!);

    expect(uiManager.blastReportModalPending).toBe(false);
    expect(uiManager.blastReportModalVisible).toBe(false);
  });

  it('a genuinely new blast fired after the save/load round trip still arms and opens on its normal delay', () => {
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    container = document.createElement('div');
    document.body.appendChild(container);
    uiManager = new UIManager(container);

    const { runner, ctx } = createRunner();
    fireBlast(runner, ctx);

    uiManager.update(ctx.state!);
    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS);
    uiManager.update(ctx.state!);
    (container.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();

    expect(runner.run('save').success).toBe(true);
    expect(runner.run('load').success).toBe(true);
    simulateEnteredNewLevel(uiManager, ctx);

    // A genuinely new blast landing on the reloaded state — a fresh,
    // reference-distinct BlastReport object (buildBlastReport, mining.ts,
    // always returns a new object per blast; constructed directly here
    // rather than re-running a full worker-driven drill/charge/blast cycle,
    // which is already covered end-to-end by fireBlast() above and by
    // tests/integration/blast-enhanced.integration.test.ts — this test's
    // concern is the modal's reaction to the state transition, not the
    // blast pipeline itself).
    const newReport: BlastReport = {
      ...(ctx.state!.lastBlastReport as BlastReport),
      tick: (ctx.state!.lastBlastReport as BlastReport).tick + 50,
      fragmentCount: 3,
    };
    ctx.state!.lastBlastReport = newReport;

    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS * 100);
    uiManager.update(ctx.state!); // arms the new report
    expect(uiManager.blastReportModalVisible).toBe(false);
    expect(uiManager.blastReportModalPending).toBe(true);

    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS * 100 + BLAST_REPORT_DELAY_MS);
    uiManager.update(ctx.state!);

    expect(uiManager.blastReportModalVisible).toBe(true);
  });

  it('entering a fresh level (lastBlastReport === null) leaves the modal closed/non-pending — unchanged from current behavior', () => {
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    container = document.createElement('div');
    document.body.appendChild(container);
    uiManager = new UIManager(container);

    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:7 size:32 staffed:true').success).toBe(true);
    expect(ctx.state!.lastBlastReport).toBeNull();

    simulateEnteredNewLevel(uiManager, ctx);
    uiManager.update(ctx.state!);
    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS * 10);
    uiManager.update(ctx.state!);

    expect(uiManager.blastReportModalPending).toBe(false);
    expect(uiManager.blastReportModalVisible).toBe(false);
  });

  it('a save/load round trip while the report is still open (not yet dismissed) closes it and does not reopen', () => {
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    container = document.createElement('div');
    document.body.appendChild(container);
    uiManager = new UIManager(container);

    const { runner, ctx } = createRunner();
    fireBlast(runner, ctx);

    uiManager.update(ctx.state!);
    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS);
    uiManager.update(ctx.state!);
    expect(uiManager.blastReportModalVisible).toBe(true); // never dismissed

    expect(runner.run('save').success).toBe(true);
    expect(runner.run('load').success).toBe(true);
    simulateEnteredNewLevel(uiManager, ctx);

    expect(uiManager.blastReportModalVisible).toBe(false);
    expect(uiManager.blastReportModalPending).toBe(false);

    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS * 10);
    uiManager.update(ctx.state!);

    expect(uiManager.blastReportModalPending).toBe(false);
    expect(uiManager.blastReportModalVisible).toBe(false);
  });

  // ── a longer real collapse duration (#950) in effect at save time does not
  // leave the reload stuck waiting on a stale extended deadline ────────────
  //
  // BlastReportModal's open deadline is now max(BLAST_REPORT_DELAY_MS,
  // blastPlaybackDurationS * 1000) — a real fragment collapse longer than the
  // 3s floor pushes pendingDeadlineMs further out than #571's save/load guard
  // originally covered. reset(currentReport) discards pendingDeadlineMs
  // outright (it does not carry it across the reset), so a save/load round
  // trip must behave identically whether the in-flight delay at save time was
  // the plain 3s floor or a longer real-duration one.

  it('dismiss → save → load while a longer real-duration delay was in effect at open time leaves the modal closed after reload, same as the plain-floor case (#950)', () => {
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    container = document.createElement('div');
    document.body.appendChild(container);
    uiManager = new UIManager(container);

    const { runner, ctx } = createRunner();
    fireBlast(runner, ctx);

    // Arm + open the report with a real collapse duration (5s) longer than
    // the 3000ms floor — matches main.ts's own call shape (weatherCycle, rng,
    // tutorialActive, blastPlaybackDurationS), UIManager.update's 5th param.
    uiManager.update(ctx.state!, undefined, undefined, false, 5);
    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS);
    uiManager.update(ctx.state!, undefined, undefined, false, 5);
    expect(uiManager.blastReportModalVisible).toBe(false); // still mid-collapse, past the old floor

    nowSpy.mockReturnValue(5000);
    uiManager.update(ctx.state!, undefined, undefined, false, 5);
    expect(uiManager.blastReportModalVisible).toBe(true);

    // Player dismisses before saving.
    (container.querySelector('[data-action="report-close"]') as HTMLButtonElement).click();
    expect(uiManager.blastReportModalVisible).toBe(false);

    expect(runner.run('save').success).toBe(true);

    const prevState = ctx.state;
    expect(runner.run('load').success).toBe(true);
    expect(ctx.state).not.toBe(prevState);
    expect(ctx.state!.lastBlastReport).not.toBeNull();

    simulateEnteredNewLevel(uiManager, ctx);

    // Advance real time well past even the longer 5s delay across several
    // frames — the reloaded state must not re-arm regardless of what
    // blastPlaybackDurationS the caller now passes (a fresh frame after
    // reload has no fragment collapse of its own in flight, so main.ts
    // would pass 0 here — asserted for both 0 and a stale-looking 5 to prove
    // the guard doesn't depend on which one arrives).
    nowSpy.mockReturnValue(10000);
    uiManager.update(ctx.state!, undefined, undefined, false, 0);
    nowSpy.mockReturnValue(50000);
    uiManager.update(ctx.state!, undefined, undefined, false, 5);

    expect(uiManager.blastReportModalPending).toBe(false);
    expect(uiManager.blastReportModalVisible).toBe(false);
  });

  it('a save/load round trip while the report is still pending under a longer real-duration delay (arrived, not yet opened) closes it and does not reopen (#950)', () => {
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    container = document.createElement('div');
    document.body.appendChild(container);
    uiManager = new UIManager(container);

    const { runner, ctx } = createRunner();
    fireBlast(runner, ctx);

    uiManager.update(ctx.state!, undefined, undefined, false, 5); // arms with a 5s real duration, still waiting it out
    expect(uiManager.blastReportModalPending).toBe(true);
    expect(uiManager.blastReportModalVisible).toBe(false);

    // Even past the old 3000ms floor, still pending — the real duration
    // hasn't elapsed yet.
    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS);
    uiManager.update(ctx.state!, undefined, undefined, false, 5);
    expect(uiManager.blastReportModalPending).toBe(true);
    expect(uiManager.blastReportModalVisible).toBe(false);

    expect(runner.run('save').success).toBe(true);
    expect(runner.run('load').success).toBe(true);
    simulateEnteredNewLevel(uiManager, ctx);

    expect(uiManager.blastReportModalPending).toBe(false);
    expect(uiManager.blastReportModalVisible).toBe(false);

    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS * 10);
    uiManager.update(ctx.state!, undefined, undefined, false, 0);

    expect(uiManager.blastReportModalPending).toBe(false);
    expect(uiManager.blastReportModalVisible).toBe(false);
  });

  it('a save/load round trip while the report is still pending (arrived, not yet opened) closes it and does not reopen', () => {
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    container = document.createElement('div');
    document.body.appendChild(container);
    uiManager = new UIManager(container);

    const { runner, ctx } = createRunner();
    fireBlast(runner, ctx);

    uiManager.update(ctx.state!); // arms, still waiting out its delay
    expect(uiManager.blastReportModalPending).toBe(true);
    expect(uiManager.blastReportModalVisible).toBe(false);

    expect(runner.run('save').success).toBe(true);
    expect(runner.run('load').success).toBe(true);
    simulateEnteredNewLevel(uiManager, ctx);

    expect(uiManager.blastReportModalPending).toBe(false);
    expect(uiManager.blastReportModalVisible).toBe(false);

    nowSpy.mockReturnValue(BLAST_REPORT_DELAY_MS * 10);
    uiManager.update(ctx.state!);

    expect(uiManager.blastReportModalPending).toBe(false);
    expect(uiManager.blastReportModalVisible).toBe(false);
  });
});
