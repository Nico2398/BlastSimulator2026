// BlastSimulator2026 — a fired blast's report is closed before the player acts again (issue #2098)
//
// Firing a blast opens the blast report overlay. While it is open it covers the
// scene and the HUD, so any later click, tile pick, drag or keypress in a
// scenario lands on the overlay instead of the game. A scenario must close the
// report (`[data-action="report-close"]`) before it plays on. Leaving it open at
// the very end of a scenario is fine: nothing clicks after it.

import { describe, it, expect } from 'vitest';
import { scenarioFiles, SCENARIO_DIR, loadScenarioDef } from '../../../scripts/shared/scenario-utils.js';
import type { InteractionStepAction, ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';

const FIRE_SELECTOR = '.bs-confirm-overlay .bs-btn-danger';
const REPORT_CLOSE_SELECTOR = '[data-action="report-close"]';
const FIRE_ANYWAY_SELECTOR = '[data-action="preflight-fire-anyway"]';

/** Actions that act on the scene or HUD, and so are blocked by an open report. */
const ACTING_TYPES: ReadonlySet<string> = new Set([
  'clickSelector', 'clickIfPresent', 'pickTile', 'dragTiles', 'clickEntity', 'click', 'clickLabel', 'keypress',
]);

interface ReportViolation {
  file: string;
  stepIndex: number;
  command: string;
  actionType: string;
}

function selectorOf(action: InteractionStepAction): string | undefined {
  return 'selector' in action ? (action as { selector?: string }).selector : undefined;
}

/** Walk steps and interaction actions in order; report every acting action taken while a fired blast's report is open. */
function findOpenReportViolations(file: string, steps: readonly ScenarioStepDef[]): ReportViolation[] {
  const violations: ReportViolation[] = [];
  let open = false;
  steps.forEach((step, stepIndex) => {
    const firesBlast = step.command.startsWith('blast');
    for (const action of step.interaction ?? []) {
      const selector = selectorOf(action);
      const closes = (action.type === 'clickSelector' || action.type === 'clickIfPresent') && selector === REPORT_CLOSE_SELECTOR;
      if (closes) {
        open = false;
        continue;
      }
      if (open && ACTING_TYPES.has(action.type)) {
        const isFireAnyway = action.type === 'clickIfPresent' && selector === FIRE_ANYWAY_SELECTOR;
        if (!isFireAnyway) violations.push({ file, stepIndex, command: step.command, actionType: action.type });
      }
      if (firesBlast && action.type === 'clickSelector' && selector === FIRE_SELECTOR) open = true;
    }
  });
  return violations;
}

function describeViolations(violations: readonly ReportViolation[]): string {
  return violations
    .map(v => `  ${v.file}.json step[${v.stepIndex}] ("${v.command}") — ${v.actionType} while the blast report is open`)
    .join('\n');
}

function step(command: string, interaction: InteractionStepAction[]): ScenarioStepDef {
  return { command, interaction, role: 'player' };
}

const FIRE: InteractionStepAction = { type: 'clickSelector', selector: FIRE_SELECTOR };
const CLOSE: InteractionStepAction = { type: 'clickSelector', selector: REPORT_CLOSE_SELECTOR };

describe('findOpenReportViolations (the checker itself)', () => {
  it('flags a click in a later step after a blast whose report was never closed', () => {
    const steps = [
      step('blast', [FIRE]),
      step('tick 5', [{ type: 'clickSelector', selector: '#bs-hud .some-button' }]),
    ];
    const found = findOpenReportViolations('synthetic', steps);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: 'synthetic', stepIndex: 1, command: 'tick 5' });
  });

  it('flags an action in the same step after the fire click and before the close', () => {
    const steps = [step('blast', [FIRE, { type: 'pickTile', x: 1, z: 2 }, CLOSE])];
    expect(findOpenReportViolations('synthetic', steps)).toHaveLength(1);
  });

  it.each([
    ['dragTiles', { type: 'dragTiles', x1: 0, z1: 0, x2: 1, z2: 1 }],
    ['clickEntity', { type: 'clickEntity', kind: 'building', id: 1 }],
    ['click', { type: 'click', x: 1, y: 1 }],
    ['clickLabel', { type: 'clickLabel', label: 'OK' }],
    ['keypress', { type: 'keypress', key: 'Escape' }],
    ['clickIfPresent', { type: 'clickIfPresent', selector: '.bs-other' }],
  ] as [string, InteractionStepAction][])('flags %s while the report is open', (_name, action) => {
    const found = findOpenReportViolations('synthetic', [step('blast', [FIRE, action])]);
    expect(found).toHaveLength(1);
  });

  it('accepts a report closed in the same step, then further play', () => {
    const steps = [
      step('blast', [FIRE, CLOSE]),
      step('tick 5', [{ type: 'pickTile', x: 1, z: 2 }]),
    ];
    expect(findOpenReportViolations('synthetic', steps)).toEqual([]);
  });

  it('accepts a close by clickIfPresent', () => {
    const steps = [
      step('blast', [FIRE, { type: 'clickIfPresent', selector: REPORT_CLOSE_SELECTOR }]),
      step('tick 5', [{ type: 'click', x: 1, y: 1 }]),
    ];
    expect(findOpenReportViolations('synthetic', steps)).toEqual([]);
  });

  it('accepts a report closed by a later step before any other action', () => {
    const steps = [
      step('blast', [FIRE]),
      step('tick 5', [CLOSE]),
      step('tick 5', [{ type: 'keypress', key: 'a' }]),
    ];
    expect(findOpenReportViolations('synthetic', steps)).toEqual([]);
  });

  it('allows the preflight fire-anyway click while the report is open', () => {
    const steps = [step('blast', [FIRE, { type: 'clickIfPresent', selector: FIRE_ANYWAY_SELECTOR }, CLOSE])];
    expect(findOpenReportViolations('synthetic', steps)).toEqual([]);
  });

  it('accepts a report left open at scenario end', () => {
    const steps = [
      step('tick 5', [{ type: 'click', x: 1, y: 1 }]),
      step('blast', [FIRE]),
    ];
    expect(findOpenReportViolations('synthetic', steps)).toEqual([]);
  });

  it('ignores waits and non-acting actions while the report is open', () => {
    const steps = [step('blast', [FIRE, { type: 'waitForSelector', selector: REPORT_CLOSE_SELECTOR }, CLOSE])];
    expect(findOpenReportViolations('synthetic', steps)).toEqual([]);
  });

  it('does not treat the danger button as a fire outside a blast step', () => {
    const steps = [
      step('tick 5', [FIRE]),
      step('tick 5', [{ type: 'click', x: 1, y: 1 }]),
    ];
    expect(findOpenReportViolations('synthetic', steps)).toEqual([]);
  });

  it('reports every action taken while open, in order', () => {
    const steps = [
      step('blast', [FIRE]),
      step('a', [{ type: 'click', x: 1, y: 1 }]),
      step('b', [{ type: 'keypress', key: 'x' }]),
    ];
    expect(findOpenReportViolations('synthetic', steps).map(v => v.stepIndex)).toEqual([1, 2]);
  });
});

describe('repo-wide — a fired blast report is closed before play continues (issue #2098)', () => {
  const names = scenarioFiles(SCENARIO_DIR);

  it('sanity: the corpus fires at least one blast through the confirm overlay', () => {
    let fired = 0;
    for (const name of names) {
      for (const s of loadScenarioDef(name, SCENARIO_DIR).steps) {
        if (!s.command.startsWith('blast')) continue;
        fired += (s.interaction ?? []).filter(a => a.type === 'clickSelector' && a.selector === FIRE_SELECTOR).length;
      }
    }
    expect(fired).toBeGreaterThan(0);
  });

  it('no scenario acts on the game while a blast report is open', () => {
    const violations = names.flatMap(name => findOpenReportViolations(name, loadScenarioDef(name, SCENARIO_DIR).steps));
    expect(
      violations,
      `${violations.length} action(s) taken while a blast report was open:\n${describeViolations(violations)}`,
    ).toEqual([]);
  });
});
