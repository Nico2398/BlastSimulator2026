// BlastSimulator2026 — tutorial-real-clock plays the tutorial on its real guide clock (#1598).
//
// tutorial-interactive runs on the scenario's deterministic clock, which never
// holds. This scenario opts into the real clock and must be a pure player run:
// no console fallback, every wait through awaitTutorialStep.

import { describe, it, expect } from 'vitest';
import { loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';

const def = loadScenarioDef('tutorial-real-clock', SCENARIO_DIR);
const steps: ScenarioStepDef[] = def.steps;

const SETUP_COMMANDS = ['campaign start level:tutorial_pit', 'tutorial_start', 'time resume'];
const actionTypes = (s: ScenarioStepDef): string[] => (s.interaction ?? []).map((a) => a.type);

describe('tutorial-real-clock.json (#1598)', () => {
  it('opts into the real tutorial clock', () => {
    expect(def.realTutorialClock).toBe(true);
  });

  it('opens with campaign start level:tutorial_pit and carries no cash: override', () => {
    expect(steps[0]!.command).toMatch(/^campaign start level:tutorial_pit(\s|$)/);
    const cmds = steps.flatMap((st) => [st.command, ...(st.interaction ?? []).filter((a) => a.type === 'command').map((a) => (a as { command: string }).command)]);
    expect(cmds.filter((c) => /\bcash:/.test(c))).toEqual([]);
  });

  // Scenario mode only advances the clock inside awaitTutorialStep, so a beat that idles
  // (#1626: held-clock chip) spends its step budget with a setup `tick N` and nothing else.
  const isTickOnlySetup = (s: ScenarioStepDef): boolean => {
    const cmds = (s.interaction ?? []).filter((a) => a.type === 'command').map((a) => (a as { command: string }).command);
    return cmds.length > 0 && cmds.every((c) => /^tick \d+$/.test(c));
  };

  it('setup steps are limited to campaign start, tutorial_start, time resume and tick-only idle steps', () => {
    const offenders = steps.filter((s) => s.role === 'setup' && !SETUP_COMMANDS.includes(s.command) && !isTickOnlySetup(s));
    expect(offenders.map((s) => s.command)).toEqual([]);
  });

  it('every non-setup step is player, observe or guard', () => {
    const offenders = steps.filter((s) => s.role !== 'setup' && !['player', 'observe', 'guard'].includes(s.role ?? ''));
    expect(offenders.map((s) => `${s.role}: ${s.command}`)).toEqual([]);
  });

  it('has no scripted-clock fallback: no tick/wait_until step, no waitUntil or waitForTutorialStep action', () => {
    const offenders = steps.filter((s) =>
      /^(tick|wait_until)\b/.test(s.command)
      || actionTypes(s).some((t) => t === 'waitUntil' || t === 'waitForTutorialStep'),
    );
    expect(offenders.map((s) => s.command)).toEqual([]);
  });

  it('no player step carries a console command action', () => {
    const offenders = steps.filter((s) => s.role === 'player' && actionTypes(s).includes('command'));
    expect(offenders.map((s) => s.command)).toEqual([]);
  });

  it('only setup steps carry console command actions', () => {
    const offenders = steps.filter((s) => s.role !== 'setup' && actionTypes(s).includes('command'));
    expect(offenders.map((s) => s.command)).toEqual([]);
  });

  it('waits through awaitTutorialStep for the drill, evacuate, blast and report beats with generous timeouts', () => {
    const awaited = steps.flatMap((s) => s.interaction ?? [])
      .filter((a) => a.type === 'awaitTutorialStep') as Array<{ stepId: string | string[]; timeoutMs?: number }>;
    const ids = awaited.flatMap((a) => (Array.isArray(a.stepId) ? a.stepId : [a.stepId]));
    for (const id of ['charge', 'evacuate-zone', 'blast']) expect(ids).toContain(id);
    for (const a of awaited) expect(a.timeoutMs ?? 0).toBeGreaterThanOrEqual(30000);
  });

  it('plays drill -> evacuate -> blast -> report in order', () => {
    const cmds = steps.map((s) => s.command);
    const idx = (prefix: string) => cmds.findIndex((c) => c.startsWith(prefix));
    expect(idx('drill_plan')).toBeGreaterThan(-1);
    expect(idx('charge')).toBeGreaterThan(idx('drill_plan'));
    expect(idx('blast detonate')).toBeGreaterThan(idx('charge'));
    const reportClose = steps.findIndex((s) => JSON.stringify(s.interaction ?? []).includes('report-close'));
    expect(reportClose).toBeGreaterThan(idx('blast detonate'));
  });

  it('every click-driven gameplay step is role player (no setup step clicks)', () => {
    const offenders = steps.filter((s) => s.role === 'setup' && actionTypes(s).some((t) => t === 'clickSelector' || t === 'pickTile' || t === 'dragTiles'));
    expect(offenders.map((s) => s.command)).toEqual([]);
  });
});
