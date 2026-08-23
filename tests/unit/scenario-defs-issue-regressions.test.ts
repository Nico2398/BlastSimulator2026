import { describe, it, expect } from 'vitest';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';
import { checkStepActionAllowed } from '../../scripts/shared/interaction-executor.js';

// Narrow per-scenario regression locks (#514, #694) — split out of
// the former scenario-defs.test.ts (#703).

// ──────────────────────────────────────────────
// 16. The 3 remaining un-converted, non-exempt player steps (issue #514).
//
// Issue #514 audited every untagged (no `role`) step carrying a raw console
// `command` action and found 289 of them; all but 3 are legitimately exempt
// (cheat/setup steps with no UI equivalent, or documented permanent
// exceptions per .claude/rules/scenario-defs.md). These 3 are ordinary
// player actions — a blast execution and two charge-hole steps — that were
// simply never converted. They must become real `role: 'player'` steps
// driven by clicks, matching every other player-facing step in the suite.
//
// This test intentionally does not dictate the click sequence (selectors,
// waitForSelector targets, etc.) that the fix will use — only the
// structural invariant: `role` must be `'player'` (or another established
// non-exempt role) and the interaction array must not dispatch the console
// command directly.
// ──────────────────────────────────────────────
describe('The 3 known un-converted player steps are converted to real UI interactions (#514)', () => {
  const TARGETS: Array<{ file: string; stepIndex: number; expectedCommandPrefix: string }> = [
    // stepIndex 8 -> 12 (#554): charging is real work now, so a wait_until
    // step lands after each of the 4 per-hole charge commands above,
    // shifting the 'blast' step later.
    { file: 'multi-deck-blast', stepIndex: 12, expectedCommandPrefix: 'blast' },
    { file: 'blast-preview-step-visual', stepIndex: 3, expectedCommandPrefix: 'charge hole:*' },
    { file: 'blast-sequence-step-visual', stepIndex: 3, expectedCommandPrefix: 'charge hole:*' },
  ];

  for (const { file, stepIndex, expectedCommandPrefix } of TARGETS) {
    it(`${file}.json step[${stepIndex}] — is tagged with a non-exempt role`, () => {
      const scenario = loadScenarioDef(file, SCENARIO_DIR);
      const step = scenario.steps[stepIndex] as ScenarioStepDef;
      // Sanity check we're pointed at the right, still-unconverted step —
      // fails loudly if the file is edited in a way that shifts step order
      // before the role/interaction fix lands.
      expect(
        step.command.startsWith(expectedCommandPrefix),
        `${file}.json step[${stepIndex}] command changed — expected it to start with "${expectedCommandPrefix}", got "${step.command}"`,
      ).toBe(true);

      expect(
        step.role,
        `${file}.json step[${stepIndex}] ("${step.command}") must carry role: "player" (or another established non-exempt role) — it is an ordinary player action, not exempt setup/observation`,
      ).toBeDefined();
      expect(step.role).not.toBe('setup');
      expect(step.role).not.toBe('observe');
    });

    it(`${file}.json step[${stepIndex}] — its interaction array contains no raw "command" action`, () => {
      const scenario = loadScenarioDef(file, SCENARIO_DIR);
      const step = scenario.steps[stepIndex] as ScenarioStepDef;
      expect(
        step.interaction,
        `${file}.json step[${stepIndex}] must have an interaction array`,
      ).toBeDefined();
      expect(step.interaction!.length).toBeGreaterThan(0);

      const commandActions = (step.interaction ?? []).filter(a => a.type === 'command');
      expect(
        commandActions,
        `${file}.json step[${stepIndex}] interaction array still dispatches the console command directly instead of real UI actions: ${JSON.stringify(commandActions)}`,
      ).toEqual([]);
    });

    it(`${file}.json step[${stepIndex}] — a role-marked step's interaction obeys checkStepActionAllowed`, () => {
      const scenario = loadScenarioDef(file, SCENARIO_DIR);
      const step = scenario.steps[stepIndex] as ScenarioStepDef;
      if (step.role === undefined) return; // covered by the role-defined assertion above
      for (const action of step.interaction ?? []) {
        if (action.type !== 'command') continue;
        const violation = checkStepActionAllowed(step, action);
        expect(
          violation,
          `${file}.json step[${stepIndex}] — unexpected allowed console command in a player-tagged step's interaction`,
        ).toBeNull();
      }
    });
  }
});

// ──────────────────────────────────────────────
// 17. blast-visual-full.json's H1/H2 charge-override steps use clickIfPresent
// for their per-hole commit button, not clickSelector (issue #694).
//
// Both steps' final interaction action targets a specific hole's
// `[data-action="charge-hole"]` button. Whether that hole was even drilled
// this run is nondeterministic (mirrors the class of beat already fixed for
// blast-execution-visual.json's "straggler sweep" steps in #693, resolving
// #682) — `clickSelector` throws when the selector never appears, while
// `clickIfPresent` no-ops. The documented convention for this exact class of
// beat (`.claude/rules/scenario-defs.md`'s interaction-actions table) is
// `clickIfPresent`.
// ──────────────────────────────────────────────
describe('blast-visual-full.json H1/H2 charge-override steps click the per-hole button with clickIfPresent (#694)', () => {
  const TARGETS = [
    {
      command: 'charge hole:H1 explosive:boomite amount:8 stemming:3',
      selector: '#bs-blast-panel [data-hole="H1"] [data-action="charge-hole"]',
    },
    {
      command: 'charge hole:H2 explosive:boomite amount:3 stemming:1',
      selector: '#bs-blast-panel [data-hole="H2"] [data-action="charge-hole"]',
    },
  ] as const;

  for (const { command, selector } of TARGETS) {
    it(`step with command "${command}" — final interaction action targeting "${selector}" is type "clickIfPresent"`, () => {
      const scenario = loadScenarioDef('blast-visual-full', SCENARIO_DIR);
      const step = scenario.steps.find(s => s.command === command);
      expect(step, `no step found with command "${command}" — has the command string changed?`).toBeDefined();
      expect(step!.interaction, `step "${command}" must have an interaction array`).toBeDefined();
      expect(step!.interaction!.length).toBeGreaterThan(0);

      const finalAction = step!.interaction![step!.interaction!.length - 1];
      expect(
        'selector' in finalAction && finalAction.selector,
        `step "${command}"'s final interaction action should target "${selector}", got ${JSON.stringify(finalAction)}`,
      ).toBe(selector);
      expect(
        finalAction.type,
        `step "${command}"'s final action (selector "${selector}") must be "clickIfPresent", not "${finalAction.type}" — the hole it targets is not guaranteed to exist this run`,
      ).toBe('clickIfPresent');
    });

    it(`step with command "${command}" — every OTHER interaction action is unchanged (still clickSelector or assert)`, () => {
      const scenario = loadScenarioDef('blast-visual-full', SCENARIO_DIR);
      const step = scenario.steps.find(s => s.command === command);
      expect(step, `no step found with command "${command}"`).toBeDefined();
      const actions = step!.interaction!;
      const precedingActions = actions.slice(0, -1);
      for (const action of precedingActions) {
        expect(
          ['clickSelector', 'assert'],
          `step "${command}" — preceding action ${JSON.stringify(action)} changed type unexpectedly`,
        ).toContain(action.type);
      }
    });
  }
});
