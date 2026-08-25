// BlastSimulator2026 — Integration regression test: tutorial-interactive
// worker-revolt during the pre-blast charging grind (issue #707)
//
// Diagnosis (issue #707 thread): interaction mode's own replay of
// tutorial-interactive.json reaches chargedCount:9 around real tick ~589,
// while command mode's replay of the exact same step sequence reaches it
// around tick ~340 -- interaction mode's role:'player' steps each run a
// waitForTutorialStep loop between clicks that command mode's own plain
// `command` string never runs, so the two modes' real tickCount diverges
// even though neither is "wrong" (see .claude/rules/scenario-defs.md's own
// note on this exact divergence class). Employee #2 (the driller) alone
// drills all 9 holes and then charges all 9 holes back to back -- a ~400
// tick grind for one person -- while employee #1 (surveyor -> digger) sits
// idle once the box-cut finishes, holding no `blasting` qualification.
// Well-being falls from ~99.99 (tick ~181) to 0 by ~tick 469 and stays
// pinned there; REVOLT_TICKS (120, src/core/config/balance.ts) later, at
// tick 589, a genuine worker_revolt fires -- the exact tick charging
// finishes in interaction mode. That ends the level (state.levelEndReason
// = 'worker_revolt') moments before the blast step, starving
// BlastReportModal of ever arming (it correctly refuses to arm once
// state.levelEndReason !== null) -- the "report-close inert" symptom,
// reached through a different path than the already-merged
// isBlastReportOutstanding() gate on the tutorial's own `blast` step
// addressed (tests/unit/ui/tutorialSteps.test.ts:388-432).
//
// This test reproduces the same tick-count divergence in command mode (no
// browser needed) by padding the real grind with ~249 extra ticks at the
// point interaction mode's extra polling accumulates: after drill-plan
// lands (every ordered hole actually drilled) and before charging is
// ordered. It then drives the padded replay through charging and the blast
// step exactly as tutorial-interactive.json's own command-mode replay does,
// and asserts no worker_revolt happens before blast, and that well-being
// never stays pinned at 0 for a full REVOLT_TICKS window.
//
// The fix under test required two separate landings, not one. The
// role:'bootstrap' step granting employee #1 the same `blasting`
// qualification employee #2 already has (mirroring the file's existing
// `employee assign_skill 2 skill:blasting level:3` step) landed first
// (4e5846b) and was NOT sufficient on its own: run this test against that
// commit alone and it still fails with a worker_revolt. The actual
// dominant cause was deeper -- `forceShiftRestIfNeededByPolicy`
// (src/core/engine/GameLoop.ts) unconditionally skipped idle employees, so
// an idle employee under an applied site policy never received proactive
// rest and crashed to 0 well-being purely from sitting idle, independent
// of who ended up doing the charging. That fix landed second (e12fad1).
// Only with both commits does the 9-hole charge order split across two
// qualified employees *and* the idle one stop crashing to 0 well-being
// before charging even starts, keeping the real elapsed charging time
// short of the revolt collision.

import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { createGameEngine, runSteps } from '../../../scripts/shared/command-runner.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';
import { tickWithEvents } from './helpers.js';
import { REVOLT_TICKS } from '../../../src/core/campaign/WorkerRevolt.js';

/**
 * Interaction mode reaches chargedCount:9 ~249 ticks later than command
 * mode for this exact step sequence (issue #707 diagnosis: tick ~589 vs
 * tick ~340) -- extra polling ticks accumulated across role:'player'
 * steps' own waitForTutorialStep loops between drill-plan landing and
 * charging finishing, which command mode's plain `command` string never
 * runs at all.
 */
const INTERACTION_MODE_TICK_PADDING = 249;

describe('tutorial-interactive.json — worker-revolt regression (#707)', () => {
  it(
    'does not trigger a worker_revolt before blast once interaction mode\'s ' +
      'extra grind ticks are reproduced in command mode',
    () => {
      const steps = loadScenarioDef('tutorial-interactive', SCENARIO_DIR).steps;

      // Locate the two structural anchors this test pads/drives around:
      // "every ordered hole has actually landed" and "blast fired".
      const drillPlanWaitIdx = steps.findIndex(s => s.command.startsWith('wait_until field:holeCount'));
      const blastIdx = steps.findIndex(s => s.command === 'blast');
      expect(drillPlanWaitIdx).toBeGreaterThan(-1);
      expect(blastIdx).toBeGreaterThan(drillPlanWaitIdx);

      const engine = createGameEngine();
      const outDir = mkdtempSync(join(tmpdir(), 'tutorial-interactive-707-'));

      // Setup through "every drilled hole has landed": speed/hire/geology,
      // survey, hire driller, living_quarters, continuous policy,
      // driving_center, driving.drill_rig training, drill_rig purchase +
      // assignment, driving.excavator training, rock_digger purchase +
      // assignment, box-cut, and the 9-hole drill order itself -- exactly
      // as tutorial-interactive.json's own command-mode replay runs it
      // today (steps 0..drillPlanWaitIdx inclusive).
      const setupResults = runSteps(engine, steps.slice(0, drillPlanWaitIdx + 1), outDir);
      const setupErrors = setupResults.filter(r => r.error);
      expect(setupErrors, `setup steps failed: ${JSON.stringify(setupErrors, null, 2)}`).toHaveLength(0);
      expect(engine.ctx.state).not.toBeNull();
      expect(engine.ctx.state!.levelEndReason).toBeNull();
      expect(engine.ctx.state!.drillHoles.length).toBe(9);

      // Reproduce interaction mode's extra grind ticks: real, unforced
      // ticks (no needs top-up, matching what the real scenario runner's
      // own waitUntil/tick loop does) inserted right where interaction
      // mode's own extra polling accumulates -- after drilling lands,
      // before charging is ordered.
      tickWithEvents(engine.ctx, INTERACTION_MODE_TICK_PADDING);

      // Charging through the blast itself, same as
      // tutorial-interactive.json's own command-mode replay: resolve any
      // pending event, order the charge, wait for all 9 charges to land,
      // resolve any pending event, auto-sequence, blast (steps
      // drillPlanWaitIdx+1..blastIdx inclusive).
      const blastResults = runSteps(engine, steps.slice(drillPlanWaitIdx + 1, blastIdx + 1), outDir);

      // The fix's intended outcome: splitting the 9-hole charge order
      // across two qualified employees keeps the real elapsed charging
      // time short of the revolt collision, so the level must NOT have
      // ended in worker_revolt by the time blast is reached. Currently
      // (unfixed content, only employee #2 holds `blasting`) it does --
      // this is the Red-phase failure.
      expect(engine.ctx.state!.levelEndReason).not.toBe('worker_revolt');
      expect(engine.ctx.state!.revolt.revolted).toBe(false);

      // Well-being must never stay pinned at 0 for a full REVOLT_TICKS
      // (120) window during the grind -- the mechanism the
      // levelEndReason/revolt.revolted assertions above already prove
      // indirectly (revolt fires exactly when ticksAtZero reaches
      // REVOLT_TICKS), asserted directly here too per issue #707's own
      // test spec.
      expect(engine.ctx.state!.revolt.ticksAtZero).toBeLessThan(REVOLT_TICKS);

      // Sanity: the blast step itself must actually have run and
      // succeeded -- "no revolt" must not be an accident of the grind
      // stalling out before ever reaching the blast step.
      const blastStepResult = blastResults[blastResults.length - 1]!;
      expect(blastStepResult.command).toBe('blast');
      expect(blastStepResult.error, `blast step failed: ${blastStepResult.error}`).toBeUndefined();
      expect(blastStepResult.commandOutput).toContain('BLAST REPORT');
    },
  );
});
