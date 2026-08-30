import { describe, it, expect } from 'vitest';
import type { InteractionStepAction, ScenarioDef, ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';
import { WAIT_FOR_TUTORIAL_STEP_DEFAULT_TIMEOUT_MS } from '../../../scripts/shared/scenario-types.js';
import { captureCostFloorMs, effectiveStepTimeoutMs, loadScenarioDef, SCENARIO_DIR, TIMEOUT_MARGIN_MS } from '../../../scripts/shared/scenario-utils.js';
import { ALL_SCENARIO_NAMES, KNOWN_INTERACTION_ACTION_TYPES } from './fixtures.js';

// Dual-play scenario steps — interaction array validation (data-driven) —
// split out of the former scenario-defs.test.ts (#703).

// ──────────────────────────────────────────────
// 11. Dual-play scenario steps — interaction array validation (data-driven)
// Note: Some tests (click, type, wait, waitForSelector, viewport, wheel) are
// currently vacuously true because all 99 scenarios only use command-type actions.
// These tests are forward-looking: they validate data when non-command action
// types are added to scenarios in the future.
// ──────────────────────────────────────────────

/**
 * Shared scaffold behind the per-action-type checks below (issue #722): skip
 * plain-string steps, skip steps with no `interaction` array, then run
 * `check` against every action in the array matching `actionType`.
 * `Extract<InteractionStepAction, { type: T }>` narrows the union to the one
 * variant `actionType` names; TypeScript can't carry that narrowing through a
 * runtime-supplied literal on its own, so the cast is confined to this one
 * helper rather than repeated at each call site.
 */
function forEachActionOfType<T extends InteractionStepAction['type']>(
  scenario: ScenarioDef,
  actionType: T,
  check: (action: Extract<InteractionStepAction, { type: T }>, stepIndex: number) => void,
): void {
  for (const { stepIndex, interaction } of stepsWithInteraction(scenario)) {
    for (const action of interaction) {
      if (action.type === actionType) {
        check(action as Extract<InteractionStepAction, { type: T }>, stepIndex);
      }
    }
  }
}

/**
 * Shared scaffold behind `forEachActionOfType` and the outer-timeout test
 * below (#736, factored out of #722's own new duplication): walks
 * `scenario.steps`, skipping plain-string steps and steps with no
 * `.interaction` array, and yields the step index, the narrowed step object,
 * and its already-non-optional `interaction` array for every step that has
 * one.
 */
function* stepsWithInteraction(
  scenario: ScenarioDef,
): Generator<{ stepIndex: number; stepObj: ScenarioStepDef; interaction: InteractionStepAction[] }> {
  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    if (typeof step === 'string') continue;
    const stepObj = step as ScenarioStepDef;
    if (!stepObj.interaction) continue;
    yield { stepIndex: i, stepObj, interaction: stepObj.interaction };
  }
}

interface ActionTypeCheck<T extends InteractionStepAction['type'] = InteractionStepAction['type']> {
  actionType: T;
  description: string;
  check: (action: Extract<InteractionStepAction, { type: T }>, stepIndex: number) => void;
}

/**
 * Builds one `ACTION_TYPE_CHECKS` entry. `T` is inferred per call from the
 * literal `actionType` argument passed in — the same narrowing a function
 * call always gets — so `check`'s `action` parameter is the one variant
 * named by `actionType` while the body is being written. The array literal
 * below can't do this itself: with the element type fixed to `ActionTypeCheck`
 * (defaulting `T` to the full union), each object-literal element is checked
 * against that default shape rather than inferring a narrower `T`, so a bare
 * literal entry loses the narrowing `forEachActionOfType` promises. The cast
 * here confines the erasure back to `ActionTypeCheck['check']` to this one
 * spot, mirroring `forEachActionOfType`'s own cast.
 */
function defineActionCheck<T extends InteractionStepAction['type']>(
  actionType: T,
  description: string,
  check: (action: Extract<InteractionStepAction, { type: T }>, stepIndex: number) => void,
): ActionTypeCheck {
  return { actionType, description, check: check as ActionTypeCheck['check'] };
}

const ACTION_TYPE_CHECKS: ActionTypeCheck[] = [
  defineActionCheck('click', 'click actions have x and y coordinates', (a) => {
    expect(typeof a.x).toBe('number');
    expect(typeof a.y).toBe('number');
  }),
  defineActionCheck('type', 'type actions have selector and text', (a) => {
    expect(typeof a.selector).toBe('string');
    expect(a.selector.length).toBeGreaterThan(0);
    expect(typeof a.text).toBe('string');
  }),
  defineActionCheck('wait', 'wait actions have durationMs', (a) => {
    expect(typeof a.durationMs).toBe('number');
    expect(a.durationMs).toBeGreaterThan(0);
  }),
  defineActionCheck('waitForSelector', 'waitForSelector actions have selector', (a) => {
    expect(typeof a.selector).toBe('string');
    expect(a.selector.length).toBeGreaterThan(0);
  }),
  defineActionCheck(
    'waitForProperty',
    'waitForProperty actions name a selector, a property, and a value to wait for',
    (a) => {
      expect(typeof a.selector).toBe('string');
      expect(a.selector.length).toBeGreaterThan(0);
      expect(typeof a.property).toBe('string');
      expect(a.property.length).toBeGreaterThan(0);
      // An undefined target would match a missing property and pass instantly.
      expect(a.expectedValue).toBeDefined();
      if (a.timeoutMs !== undefined) {
        expect(typeof a.timeoutMs).toBe('number');
        expect(a.timeoutMs).toBeGreaterThan(0);
      }
    },
  ),
  defineActionCheck(
    'waitForTutorialStep',
    'waitForTutorialStep actions name at least one step id',
    (a, i) => {
      const ids = Array.isArray(a.stepId) ? a.stepId : [a.stepId];
      expect(ids.length, `step[${i}] stepId must not be empty`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(typeof id, `step[${i}] stepId entries must be strings`).toBe('string');
        expect(id.length, `step[${i}] stepId entries must be non-empty`).toBeGreaterThan(0);
      }
    },
  ),
  defineActionCheck('viewport', 'viewport actions have width and height', (a) => {
    expect(typeof a.width).toBe('number');
    expect(typeof a.height).toBe('number');
  }),
  defineActionCheck('wheel', 'wheel actions have deltaX and deltaY', (a) => {
    expect(typeof a.deltaX).toBe('number');
    expect(typeof a.deltaY).toBe('number');
  }),
  defineActionCheck(
    'command',
    'command actions within interaction arrays have a command field',
    (a) => {
      expect(typeof a.command).toBe('string');
      expect(a.command.length).toBeGreaterThan(0);
    },
  ),
  defineActionCheck(
    'waitUntil',
    'waitUntil actions have field, equals, maxTicks, and timeoutMs',
    (a) => {
      expect(typeof a.field).toBe('string');
      expect(a.field.length).toBeGreaterThan(0);
      expect(a.equals).not.toBeUndefined();
      expect(Number.isInteger(a.maxTicks)).toBe(true);
      expect(a.maxTicks).toBeGreaterThan(0);
      expect(Number.isInteger(a.timeoutMs)).toBe(true);
      expect(a.timeoutMs).toBeGreaterThan(0);
    },
  ),
  defineActionCheck('cameraFocus', 'cameraFocus actions have x, z, and distance', (a) => {
    expect(typeof a.x).toBe('number');
    expect(typeof a.z).toBe('number');
    expect(typeof a.distance).toBe('number');
    expect(a.distance).toBeGreaterThan(0);
  }),
];

describe('Dual-play scenario steps — data-driven validation', () => {
  for (const name of ALL_SCENARIO_NAMES) {
    // Not table-driven: no type filter — scans every action of every step and
    // throws (rather than skips) on a plain-string step, unlike the shared
    // scaffold below.
    it(`${name} — all interaction action types are in the known set`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'string') {
          throw new Error(`step[${i}] is a plain string — all steps must be objects with interaction arrays`);
        }
        const stepObj = step as ScenarioStepDef;
        if (!stepObj.interaction) continue;
        for (const action of stepObj.interaction) {
          expect(
            KNOWN_INTERACTION_ACTION_TYPES,
            `step[${i}] action type "${action.type}" is not a known interaction type`,
          ).toContain(action.type);
        }
      }
    });

    for (const entry of ACTION_TYPE_CHECKS) {
      it(`${name} — ${entry.description}`, () => {
        const scenario = loadScenarioDef(name, SCENARIO_DIR);
        forEachActionOfType(scenario, entry.actionType, entry.check);
      });
    }

    // Not table-driven: spans two action types (waitUntil, resolveEventIfPending)
    // and computes one value per step rather than per action, unlike the
    // shared scaffold above.
    it(`${name} — outer step timeout covers every inner waitUntil/resolveEventIfPending timeoutMs`, () => {
      // Regression for PR #616's headline bug: interaction-executor.ts and
      // the step runner race a step's own outer `timeout` (seconds,
      // defaults to 60s) against an inner action's `timeoutMs` (ms)
      // independently. When the outer fires first it produces a generic
      // "Step N timed out after 60000ms" instead of the action's own,
      // more useful error — 12 steps across 3 files shipped with this
      // mismatch undetected. `resolveEventIfPending.timeoutMs` defaults to
      // 30000 (interaction-executor.ts) when absent, same default used here.
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      for (const { stepObj, interaction } of stepsWithInteraction(scenario)) {
        const outerMs = (stepObj.timeout ?? 60) * 1000;
        for (const action of interaction) {
          if (action.type === 'waitUntil') {
            expect(action.timeoutMs).toBeLessThanOrEqual(outerMs);
          } else if (action.type === 'resolveEventIfPending') {
            const innerMs = action.timeoutMs ?? 30000;
            expect(innerMs).toBeLessThanOrEqual(outerMs);
          }
        }
      }
    });

    // Generalizes issue #704's narrow, single-file lock (blast-visual-full.json
    // only) to every scenario file, per issue #725: in interaction mode with
    // `--screenshots`, each step also pays a capture cost
    // (SOFTWARE_RASTER_FRAME_COST_MS per frame, software rasterization, no
    // GPU, #475) for 1 base capture, each inline `{type:'screenshot'}`
    // interaction action, the scenario-level `shots.length` (orbit angles
    // captured every step when the scenario declares `shots`), and
    // `step.frames`. A step whose declared `timeout` sits below this floor
    // false-timeouts the instant `--screenshots` is used, regardless of
    // whether the step's own work would have finished in time.
    it(`${name} — declared step timeout covers interaction-mode --screenshots capture-cost floor (#725)`, () => {
      const scenario = loadScenarioDef(name, SCENARIO_DIR);
      const shotsCount = scenario.shots?.length ?? 0;
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        if (typeof step === 'string') continue;
        const stepObj = step as ScenarioStepDef;
        const floorMs = captureCostFloorMs(stepObj, shotsCount);
        const declaredMs = (stepObj.timeout ?? 60) * 1000;
        expect(
          declaredMs,
          `step[${i}] "${stepObj.command}" declared timeout ${declaredMs}ms is below the --screenshots capture-cost floor ${floorMs}ms`,
        ).toBeGreaterThanOrEqual(floorMs);
      }
    });
  }
});

// ──────────────────────────────────────────────
// 12. tutorial-interactive.json — outer step timeout covers every inner
// waitForTutorialStep deadline with genuine margin (issue #730, tightened
// by its own follow-up)
//
// Deliberately scoped to this one file rather than folded into the shared
// cross-file check above (which only covers waitUntil/resolveEventIfPending):
// tutorial-steps-visual.json has 14 pre-existing waitForTutorialStep steps
// whose outer timeout does not cover the 30000ms inner default, and pulling
// them into scope here is out of scope for #730 (tracked separately).
//
// `outerMs` is computed via `effectiveStepTimeoutMs` — the same value the
// interaction/bench runners actually race against — rather than the step's
// raw declared `timeout`: `effectiveStepTimeoutMs` folds a `waitForTutorialStep`
// action's own inner deadline (`action.timeout ?? 30000`) into its margin
// computation, so a step's declared JSON `timeout` alone is no longer what
// determines the real outer race. The assertion requires `outerMs` to clear
// `innerMs + TIMEOUT_MARGIN_MS`, not merely tie it — an exact tie (zero
// margin) is precisely the bug this test exists to catch: 12 steps in this
// file declare `"timeout": 30` against a 30000ms inner default, an exact
// tie that scheduling jitter can and does lose (step 34, `hire-manager`).
// ──────────────────────────────────────────────
describe('tutorial-interactive.json — outer step timeout covers every inner waitForTutorialStep timeout with margin', () => {
  const scenario = loadScenarioDef('tutorial-interactive', SCENARIO_DIR);

  forEachActionOfType(scenario, 'waitForTutorialStep', (action, i) => {
    const stepObj = scenario.steps[i] as ScenarioStepDef;
    it(`step[${i}] (${stepObj.description ?? stepObj.command}) — outer timeout covers waitForTutorialStep's inner timeout with margin`, () => {
      const outerMs = effectiveStepTimeoutMs(stepObj, 60);
      const innerMs = action.timeout ?? WAIT_FOR_TUTORIAL_STEP_DEFAULT_TIMEOUT_MS;
      expect(outerMs).toBeGreaterThanOrEqual(innerMs + TIMEOUT_MARGIN_MS);
    });
  });
});

// ──────────────────────────────────────────────
// 13. tutorial-interactive.json — post-blast waitForTutorialStep beats need
// real wall-clock slack, not just the bare formula minimum (issue #776).
//
// Two independent interaction-mode browser runs both timed out
// deterministically at the "hire-manager" step (`employee hire
// role:manager`, then `waitForTutorialStep(stepId:"contract-accept")`),
// which sits right after the blast sequence (steps 24-31: drill, charge,
// sequence, fire) and the consultant event-resolve step (32). Both real
// actions (hire manager, tutorial advance to "contract-accept") actually
// succeeded in-browser before the outer deadline fired — this is not a
// logic bug, it's a timeout-budget bug: `effectiveStepTimeoutMs` computes
// exactly `max(30000, 30000 + TIMEOUT_MARGIN_MS) = 35000ms` for this step
// (formula-correct, same shape the #730 test above already covers), but
// 35000ms of real wall-clock time is not enough for this specific beat —
// page.evaluate round-trips are still comparatively slow right after the
// blast/event stretch. Same root cause as #758 (fixed in PR #740): a
// step's formula-correct budget was empirically too tight for its
// real-world beat, and the fix there was to widen the step's own declared
// `timeout`, not the shared formula or margin constant.
//
// This test encodes the requirement the #730 loop above cannot see: that
// this step has genuine slack above the bare minimum, not merely a budget
// that satisfies the formula. The floor chosen (60000ms) is double the
// current 35000ms effective budget — the same order-of-magnitude margin
// #758/#740 aimed for — comfortably absorbing render-frame jitter in the
// tick immediately following a blast without being a placeholder that
// passes trivially. Locates the step by its actual shape (hires a manager,
// then waits for the "contract-accept" tutorial step) rather than a bare
// index, so it keeps finding the right step if earlier steps are ever
// inserted/removed.
// ──────────────────────────────────────────────
describe('tutorial-interactive.json — post-blast waitForTutorialStep steps have real wall-clock margin, not just the formula minimum', () => {
  const scenario = loadScenarioDef('tutorial-interactive', SCENARIO_DIR);

  // Minimum acceptable effective timeout for this beat. Chosen as 2x the
  // current (too-tight) 35000ms effective budget that produced #776's
  // observed timeouts — a generous, concrete floor rather than the exact
  // formula minimum this bug already clears.
  const POST_BLAST_BEAT_MIN_TIMEOUT_MS = 60000;

  // Located via the shared `forEachActionOfType` scaffold rather than a
  // hand-rolled `findIndex`/type-guard/cast (#776 review finding) — filters
  // down to the one step whose command hires a manager and whose
  // waitForTutorialStep action targets "contract-accept", skipping every
  // other waitForTutorialStep invocation in the scenario.
  let matchedStepIndex = -1;
  let matchedStepObj: ScenarioStepDef | undefined;
  forEachActionOfType(scenario, 'waitForTutorialStep', (action, stepIndex) => {
    const stepObj = scenario.steps[stepIndex] as ScenarioStepDef;
    if (stepObj.command !== 'employee hire role:manager') return;
    // 'hire-driver', not 'contract-accept' (#556/#817): contract-accept moved
    // below build-storage in tutorialSteps.ts's canonical order, so the card
    // this beat waits for is the one after it. Same step, same #776 budget.
    if (!(Array.isArray(action.stepId) ? action.stepId : [action.stepId]).includes('hire-driver')) return;
    matchedStepIndex = stepIndex;
    matchedStepObj = stepObj;
  });

  it('step hiring the manager and waiting for tutorial step "hire-driver" has effectiveStepTimeoutMs >= 60000ms', () => {
    expect(
      matchedStepIndex,
      'expected to find a step with command "employee hire role:manager" whose interaction array waits for tutorial step "hire-driver" — tutorial-interactive.json may have changed shape',
    ).toBeGreaterThanOrEqual(0);

    const stepObj = matchedStepObj as ScenarioStepDef;
    const outerMs = effectiveStepTimeoutMs(stepObj, 60);

    expect(
      outerMs,
      `step[${matchedStepIndex}] ("${stepObj.description ?? stepObj.command}") effectiveStepTimeoutMs is ${outerMs}ms — ` +
        `too tight for the real-world post-blast beat (issue #776: two independent interaction-mode runs both ` +
        `timed out here at 35000ms even though the underlying actions succeeded). Needs real wall-clock slack ` +
        `above the bare formula minimum, e.g. by raising this step's declared "timeout" in the JSON.`,
    ).toBeGreaterThanOrEqual(POST_BLAST_BEAT_MIN_TIMEOUT_MS);
  });

  // Step 35's beat (issue #776 follow-up): two fresh independent
  // interaction-mode runs both cleared the "contract-accept" beat above
  // cleanly, then timed out identically at the very next
  // waitForTutorialStep beat — accepting the rubble_disposal contract and
  // waiting for the tutorial to advance to "hire-driver". Same shape as
  // the manager/contract-accept case above: the click succeeds in-browser
  // (state dump shows activeContractCount: 1 and the tutorial card visibly
  // reads "Hire Driver — 21/31") but the harness's poll times out first,
  // because this step's declared "timeout": 30 in the JSON produces the
  // same too-tight ~35000ms effectiveStepTimeoutMs budget. Located via the
  // same forEachActionOfType scaffold, not a hand-rolled locator.
  let driverStepIndex = -1;
  let driverStepObj: ScenarioStepDef | undefined;
  forEachActionOfType(scenario, 'waitForTutorialStep', (action, stepIndex) => {
    const stepObj = scenario.steps[stepIndex] as ScenarioStepDef;
    if (stepObj.command !== 'contract accept type:rubble_disposal') return;
    // 'haul-debris', not 'hire-driver' (#556/#817): see the note on the
    // manager beat above — the accept now sits after build-storage, so the
    // card it waits for is haul-debris.
    if (!(Array.isArray(action.stepId) ? action.stepId : [action.stepId]).includes('haul-debris')) return;
    driverStepIndex = stepIndex;
    driverStepObj = stepObj;
  });

  it('step accepting the rubble_disposal contract and waiting for tutorial step "haul-debris" has effectiveStepTimeoutMs >= 60000ms', () => {
    expect(
      driverStepIndex,
      'expected to find a step with command "contract accept type:rubble_disposal" whose interaction array waits for tutorial step "haul-debris" — tutorial-interactive.json may have changed shape',
    ).toBeGreaterThanOrEqual(0);

    const stepObj = driverStepObj as ScenarioStepDef;
    const outerMs = effectiveStepTimeoutMs(stepObj, 60);

    expect(
      outerMs,
      `step[${driverStepIndex}] ("${stepObj.description ?? stepObj.command}") effectiveStepTimeoutMs is ${outerMs}ms — ` +
        `too tight for the real-world post-blast beat (issue #776: two independent interaction-mode runs both ` +
        `timed out here at ~35000ms even though the underlying actions succeeded). Needs real wall-clock slack ` +
        `above the bare formula minimum, e.g. by raising this step's declared "timeout" in the JSON.`,
    ).toBeGreaterThanOrEqual(POST_BLAST_BEAT_MIN_TIMEOUT_MS);
  });

  // Step 36's beat (issue #776 second follow-up): two fresh independent
  // interaction-mode runs both cleared the "hire-driver" beat above (step
  // 35) cleanly, then timed out identically at the very next
  // waitForTutorialStep beat — hiring a driver and waiting for the
  // tutorial to advance to "vehicle-buy-assign". Same shape as the two
  // cases above: the real hire action succeeds in-browser but the
  // harness's poll times out first, because this step's declared
  // "timeout": 30 in the JSON produces the same too-tight ~35000ms
  // effectiveStepTimeoutMs budget. A planner audit of the rest of the file
  // (steps 37-46) found no other step with this same tight-margin shape —
  // this is the last one needing the fix. Located via the same
  // forEachActionOfType scaffold, not a hand-rolled locator.
  let driverAssignStepIndex = -1;
  let driverAssignStepObj: ScenarioStepDef | undefined;
  forEachActionOfType(scenario, 'waitForTutorialStep', (action, stepIndex) => {
    const stepObj = scenario.steps[stepIndex] as ScenarioStepDef;
    if (stepObj.command !== 'employee hire role:driver') return;
    if (!(Array.isArray(action.stepId) ? action.stepId : [action.stepId]).includes('vehicle-buy-assign')) return;
    driverAssignStepIndex = stepIndex;
    driverAssignStepObj = stepObj;
  });

  it('step hiring the driver and waiting for tutorial step "vehicle-buy-assign" has effectiveStepTimeoutMs >= 60000ms', () => {
    expect(
      driverAssignStepIndex,
      'expected to find a step with command "employee hire role:driver" whose interaction array waits for tutorial step "vehicle-buy-assign" — tutorial-interactive.json may have changed shape',
    ).toBeGreaterThanOrEqual(0);

    const stepObj = driverAssignStepObj as ScenarioStepDef;
    const outerMs = effectiveStepTimeoutMs(stepObj, 60);

    expect(
      outerMs,
      `step[${driverAssignStepIndex}] ("${stepObj.description ?? stepObj.command}") effectiveStepTimeoutMs is ${outerMs}ms — ` +
        `too tight for the real-world post-blast beat (issue #776: two independent interaction-mode runs both ` +
        `timed out here at ~35000ms even though the underlying actions succeeded). Needs real wall-clock slack ` +
        `above the bare formula minimum, e.g. by raising this step's declared "timeout" in the JSON.`,
    ).toBeGreaterThanOrEqual(POST_BLAST_BEAT_MIN_TIMEOUT_MS);
  });
});

// ──────────────────────────────────────────────
// 14. tutorial-interactive.json — every post-blast step (indices 32-46)
// declares a 90s timeout floor, regardless of action type (issue #776,
// third follow-up).
//
// The three describe blocks above (12 and 13) only assert on steps that
// carry a `waitForTutorialStep` action, via `effectiveStepTimeoutMs`. That
// missed step 37 (`employee assign_skill 4 skill:driving.truck level:3`,
// a plain `command` action with no `waitForTutorialStep` at all) — it kept
// its tight default `timeout: 30` and stalled interaction-mode CI a fourth
// time. A planner audit of the whole post-blast window (steps 32-46)
// concluded the underlying cost isn't specific to any one action type: the
// scenario-wide `shots: ["overview","birdseye"]` setting captures 2
// screenshots + a state dump after *every* step, and the muck pile spawned
// by the blast at step 31 (994 fragments) plausibly never fully clears
// within this scenario's remaining steps — hauling only starts at step 39,
// and total delivered ore is far less than 994 fragments' worth. So every
// step from 32 through 46 pays the heavy-scene screenshot cost, whether or
// not it happens to wait on a tutorial card.
//
// This test asserts the simpler, broader invariant directly against the
// JSON's own declared `timeout` field (not the derived
// `effectiveStepTimeoutMs`) for every step in that index range, matching
// this file's own established "safe" precedent of 90s already used for
// steps 31, 34, 39, 41, 42. It intentionally does not replace tests 12/13
// above — those assert a different thing (outer/inner margin) and remain
// valid on their own.
// ──────────────────────────────────────────────
describe('tutorial-interactive.json — every post-blast step has a declared timeout floor of 90s', () => {
  const scenario = loadScenarioDef('tutorial-interactive', SCENARIO_DIR);

  // Located dynamically rather than pinned to a literal index (#816 follow-up):
  // the file's own step count shifts whenever an order-then-wait pair is
  // inserted upstream of the blast (construction sites, #556) — a hardcoded
  // 32-46 window silently started checking the wrong steps the moment that
  // happened, rather than failing loudly. The window covers everything from
  // the blast step onward to the end of the file, matching this test's own
  // original intent (steps 31-46 of the pre-#556 file were exactly "the blast
  // step through the last step").
  const blastIndex = scenario.steps.findIndex(
    s => typeof s !== 'string' && (s as ScenarioStepDef).command === 'blast',
  );
  if (blastIndex === -1) throw new Error("tutorial-interactive.json has no 'blast' step — post-blast window can't be located");

  const POST_BLAST_WINDOW_START = blastIndex;
  const POST_BLAST_WINDOW_END = scenario.steps.length - 1; // inclusive

  for (let i = POST_BLAST_WINDOW_START; i <= POST_BLAST_WINDOW_END; i++) {
    it(`step[${i}] has timeout >= 90`, () => {
      const step = scenario.steps[i];
      if (typeof step === 'string') return; // bare-string steps carry no declared timeout; skip per file's own ScenarioStepDef cast pattern
      const stepObj = step as ScenarioStepDef;
      expect(
        stepObj.timeout,
        `step[${i}] ("${stepObj.description ?? stepObj.command}") must declare a timeout >= 90s — ` +
          `every step in the post-blast window (32-46) renders a heavy muck-pile scene under this file's ` +
          `"shots": ["overview","birdseye"] setting (issue #776).`,
      ).toBeGreaterThanOrEqual(90);
    });
  }
});
