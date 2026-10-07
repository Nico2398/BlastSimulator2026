// BlastSimulator2026 — Full-level integration test: Level 1 Win
// Goal: Start level 1, perform mining operations, accumulate profit past
// the unlock threshold, and verify campaign completion.
//
// #1363: Dusty Hollow can be WON by playing it. The real playthrough below
// uses only what a player has with every control enabled and never the
// `campaign complete` debug command. The tests named "debug command" keep
// exercising that force-win path, calibrated on a bare (`staffed:false`) site.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtx,
  tickWithEvents,
  performBlast,
  driveToLevelCompletion,
  assertLevelCompletion,
  assertStateSummaryCompletion,
} from './helpers.js';
import { employeeCommand } from '../../../src/console/commands/entities.js';
import { createRunner } from '../../../src/console/createRunner.js';
import { recordProfit } from '../../../src/core/campaign/Campaign.js';
import { getLevel } from '../../../src/core/campaign/Level.js';
import { getOperatingProfit } from '../../../src/core/economy/Finance.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { FORBIDDEN_COMMAND, playContracts, playTick, tickUntil, type Run } from '../../helpers/playthrough.js';

describe('Level 1 — Win (debug command, bare site)', () => {
  let ctx: ReturnType<typeof makeCampaignCtx>;

  beforeEach(() => {
    ctx = makeCampaignCtx('dusty_hollow');
  });

  it('starts level 1 with correct initial state', () => {
    expect(ctx.state).not.toBeNull();
    expect(ctx.state!.cash).toBe(50000);
    expect(ctx.state!.campaign.activeLevelId).toBe('dusty_hollow');
    // Verify grid dimensions: dusty_hollow = 96x40x96 (#458 T6.1/D13)
    expect(ctx.grid).not.toBeNull();
    expect(ctx.grid!.sizeX).toBe(96);
    expect(ctx.grid!.sizeZ).toBe(96);
    // `staffed:false` (makeCampaignCtx default): the bare site these tests were calibrated on
    expect(ctx.state!.employees.employees.length).toBe(0);
    // No buildings
    expect(ctx.state!.buildings.buildings.length).toBe(0);
  });

  it('can hire an employee, assign skill, and perform a blast', () => {
    // Hire a driller
    const hireResult = employeeCommand(ctx, ['hire'], { role: 'driller' });
    expect(hireResult.success).toBe(true);
    expect(hireResult.output).toContain('Hired');
    expect(ctx.state!.employees.employees.length).toBe(1);

    // The first employee gets id=1 (nextId starts at 1)
    const empId = 1;
    const skillResult = employeeCommand(ctx, ['assign_skill', String(empId)], {
      skill: 'blasting',
      level: '5',
    });
    expect(skillResult.success).toBe(true);
    expect(skillResult.output).toContain('assigned skill');

    // Perform a blast at (10,10)
    const blastOutput = performBlast(ctx, 10, 10);
    expect(blastOutput).toContain('BLAST REPORT');
    // Wait a few ticks
    tickWithEvents(ctx, 5);
  });

  it('can complete the level via the campaign complete debug command', () => {
    // Perform a blast first to have some activity, then force-complete the level
    assertLevelCompletion(ctx, 3, 3);
  });

  it('level can reach star rating display after completion', () => {
    driveToLevelCompletion(ctx, 5, 5);
    assertStateSummaryCompletion(ctx);
  });
});

// ── #1363: a real playthrough wins Dusty Hollow ───────────────────────────────

/** Ceiling on ticks a real playthrough may take, a constant so a slow win cannot hide behind a raised cap. */
const LEVEL1_PLAYTHROUGH_TICK_CAP = 6000;

/** The profit target, read from the level, never a copy of it. */
const LEVEL1_TARGET = getLevel('dusty_hollow')!.unlockThreshold;

/** Every command verb the playthrough may use: what a player can do with controls enabled. */
const ALLOWED_VERB = /^(campaign start|time resume|tick|drill_plan|charge|sequence|blast|zone clear|zone status|contract accept|contract deliver|event choose)\b/;

interface PlayStyle {
  rows: number;
  cols: number;
  spacing: number;
  depth: number;
  /** Where the first shot goes, relative to the drill rig, and how far each next shot steps. */
  offset: { x: number; z: number };
  step: { x: number; z: number };
}

/** Safety margin, in tiles, a careful player clears around a charged pattern before firing. */
const BLAST_ZONE_MARGIN = 15;

/** Order everyone out of the blast radius and wait until the zone reads clear, as the Blast panel's evacuate control does. */
function clearBlastZone(run: Run, state: GameState): void {
  const xs = state.drillHoles.map((h) => h.x);
  const zs = state.drillHoles.map((h) => h.z);
  if (xs.length === 0) return;
  const m = BLAST_ZONE_MARGIN + 1;
  run(`zone clear x1:${Math.min(...xs) - m} y1:${Math.min(...zs) - m} x2:${Math.max(...xs) + m} y2:${Math.max(...zs) + m}`);
  const isClear = () => { const z = run('zone status').output; return z.includes('CLEAR') && !z.includes('NOT'); };
  for (let i = 0; i < 80 && !isClear(); i++) playTick(run, state);
}

/** Ordinary mining: order a grid near the rig, wait for it, charge it, sequence it, fire it, sell what comes out. */
function playLevel1(run: Run, state: GameState, style: PlayStyle): void {
  const rig = state.vehicles.vehicles.find((v) => v.type === 'drill_rig');
  expect(rig, 'the level opens with a drill rig').toBeDefined();
  let shot = 0;
  const startTick = state.tickCount;
  const spent = () => state.tickCount - startTick;
  const done = () => state.levelEnded || spent() >= LEVEL1_PLAYTHROUGH_TICK_CAP;

  while (!done()) {
    const x = Math.round(rig!.x) + style.offset.x + style.step.x * shot;
    const z = Math.round(rig!.z) + style.offset.z + style.step.z * shot;
    shot++;
    const plan = run(
      `drill_plan grid rows:${style.rows} cols:${style.cols} spacing:${style.spacing} depth:${style.depth} start:${x},${z}`,
    );
    if (!plan.success) { if (shot > 40) return; continue; }
    tickUntil(run, state, 600, () => done() || state.plannedDrillHoles.length === 0);
    if (done()) return;
    run('charge hole:* explosive:boomite amount:5 stemming:2');
    tickUntil(run, state, 600, () => done() || Object.keys(state.plannedChargesByHole).length === 0);
    if (done()) return;
    run('sequence auto');
    clearBlastZone(run, state);
    run('blast');
    // Let the haulers clear the rock and sell it as it arrives.
    for (let i = 0; i < 150 && !done(); i++) {
      playContracts(run, state);
      playTick(run, state);
    }
  }
}

describe('Level 1 — real playthrough wins with no campaign complete (#1363)', () => {
  const STYLES: ReadonlyArray<{ label: string; style: PlayStyle }> = [
    { label: 'seed 1138, 2x2 grids stepping south', style: { rows: 2, cols: 2, spacing: 3, depth: 6, offset: { x: 14, z: 13 }, step: { x: 0, z: 10 } } },
    { label: 'seed 1138, 2x3 grids stepping east', style: { rows: 2, cols: 3, spacing: 3, depth: 6, offset: { x: 14, z: 13 }, step: { x: 10, z: 0 } } },
  ];

  it.each(STYLES)('wins within the tick cap and solvent — $label', ({ style }) => {
    const { runner, ctx } = createRunner();
    const commandsRun: string[] = [];
    const run: Run = (cmd) => {
      commandsRun.push(cmd);
      return runner.run(cmd);
    };
    recordProfit(ctx.campaignProfile.campaign, 'tutorial_pit', 5000);
    expect(run('campaign start level:dusty_hollow').success).toBe(true);
    const state = ctx.state!;
    run('time resume');
    expect(state.employees.employees.length, 'the level opens staffed').toBeGreaterThan(0);

    playLevel1(run, state, style);

    expect(state.levelEndReason, `not won within ${LEVEL1_PLAYTHROUGH_TICK_CAP} ticks (reason ${String(state.levelEndReason)})`).toBe('completed');
    expect(state.levelEndReason).not.toBe('bankruptcy');
    expect(state.cash).toBeGreaterThan(0);
    expect(state.tickCount).toBeLessThanOrEqual(LEVEL1_PLAYTHROUGH_TICK_CAP);
    expect(getOperatingProfit(state.finances)).toBeGreaterThanOrEqual(LEVEL1_TARGET);
    expect(LEVEL1_TARGET).toBeGreaterThanOrEqual(80000);

    // Honesty: no cheat, no budget-balancing hack, nothing but ordinary player commands.
    expect(commandsRun.filter((c) => FORBIDDEN_COMMAND.test(c))).toEqual([]);
    expect(commandsRun.some((c) => c.startsWith('campaign complete'))).toBe(false);
    expect(commandsRun.filter((c) => !ALLOWED_VERB.test(c))).toEqual([]);
  }, 600_000);
});
