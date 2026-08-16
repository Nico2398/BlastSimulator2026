/**
 * BlastSimulator2026 — Shared Interaction Executor
 *
 * Executes a single interaction action on a Puppeteer page.
 * Shared by scenario-test module for executing interaction actions
 * in dual-play mode (interaction execution path).
 *
 * @module shared/interaction-executor
 */

import type { Page, KeyInput } from 'puppeteer';
import type { InteractionStepAction, ScenarioStepDef } from './scenario-types.js';
import { awaitPlacementArmed } from './tile-picker.js';
import { isAllowedSetupCommand, SETUP_COMMAND_ALLOWLIST, TIME_COMMAND_ALLOWLIST } from './interaction-types.js';
import type { PlayerAction } from './interaction-types.js';
import { runAction, waitForUiUpdate } from './interaction-driver.js';

/** How long a tile-space action waits for its picker to open. */
const PICKER_TIMEOUT_MS = 5000;

/** Maps button names to Puppeteer MouseButton values. */
const BUTTON_MAP: Record<string, 'left' | 'right' | 'middle'> = {
  left: 'left',
  right: 'right',
  middle: 'middle',
};

/** Why a selector that exists in the DOM still refused a click. */
interface UnclickableReport {
  found: boolean;
  pointerEvents?: string;
  display?: string;
  visibility?: string;
  disabled?: boolean;
  width?: number;
  height?: number;
  /** Element actually hit at the target's centre, when something covers it. */
  covering?: string;
  /** How many elements the selector matched — >1 means it is ambiguous. */
  matchCount?: number;
  /** Where the tutorial thinks it is, when one is running. */
  tutorial?: string;
}

/** Read back the state of a selector the browser refused to click. */
async function inspectSelector(page: Page, selector: string): Promise<UnclickableReport> {
  return page.evaluate((sel: string): UnclickableReport => {
    const tutorialState = (window as unknown as {
      __tutorialState?: () => { active: boolean; stepId: string | null; stageTarget: string | null };
    }).__tutorialState;
    let tutorial: string | undefined;
    if (tutorialState !== undefined) {
      const t = tutorialState();
      if (t.active) tutorial = `step "${t.stepId ?? '?'}", live control ${t.stageTarget ?? 'none'}`;
    }
    const matches = document.querySelectorAll(sel);
    const el = matches[0] as (HTMLElement & { disabled?: boolean }) | undefined;
    if (el === undefined) return { found: false, ...(tutorial !== undefined ? { tutorial } : {}) };
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    const report: UnclickableReport = {
      found: true,
      pointerEvents: style.pointerEvents,
      display: style.display,
      visibility: style.visibility,
      disabled: el.disabled === true,
      width: rect.width,
      height: rect.height,
      matchCount: matches.length,
      ...(tutorial !== undefined ? { tutorial } : {}),
    };
    if (hit !== null && hit !== el && !el.contains(hit)) {
      const cls = hit.className === '' ? '' : `.${String(hit.className).split(/\s+/).join('.')}`;
      report.covering = `${hit.tagName.toLowerCase()}${cls}`;
    }
    return report;
  }, selector);
}

/** Turn an inspection into one line a human can act on. */
function describeUnclickable(r: UnclickableReport): string {
  const context = [
    r.matchCount !== undefined && r.matchCount > 1
      ? `selector is ambiguous (${r.matchCount} matches, first one used)`
      : '',
    r.tutorial !== undefined ? `tutorial on ${r.tutorial}` : '',
  ].filter(s => s !== '');
  const suffix = context.length > 0 ? ` [${context.join('; ')}]` : '';
  return `${describeReason(r)}${suffix}`;
}

/** The primary reason, before context is appended. */
function describeReason(r: UnclickableReport): string {
  if (!r.found) return 'element vanished from the DOM between the wait and the click';
  if (r.pointerEvents === 'none') {
    return 'element is inert (pointer-events: none) — a tutorial rail or overlay is blocking it, '
      + 'so no player could click it either';
  }
  if (r.disabled === true) return 'element is disabled';
  if (r.display === 'none' || r.visibility === 'hidden') {
    return `element is not visible (display: ${r.display}, visibility: ${r.visibility})`;
  }
  if (r.width === 0 || r.height === 0) return `element has zero size (${r.width}x${r.height})`;
  if (r.covering !== undefined) return `element is covered by ${r.covering}`;
  return 'element is present and looks clickable — the browser still refused it';
}

/**
 * Poll `selector` via the page's own usability probe, then click it — the
 * same gate `clickSelector` uses, extracted so any caller that needs a real
 * "wait for it to actually be clickable, not merely present" can share it.
 *
 * `page.waitForSelector` (Puppeteer's own, DOM-presence-only) is the wrong
 * primitive for a panel that pre-exists hidden and swaps its content instead
 * of remounting: the old content's nodes are already in the DOM the instant
 * the new content is still `display:none`, so a presence-only wait resolves
 * immediately against stale, invisible elements and the follow-up click
 * throws Puppeteer's own unnamed "Node is either not clickable or not an
 * Element" (#599, `resolveEventIfPending` against a second event queued
 * right behind the one just resolved — the outcome panel or a follow-up
 * event replaces `#bs-event-dialog`'s content in place, #545's documented
 * gap for exactly this shape of panel).
 *
 * Each poll pass also drives `waitForUiUpdate` rather than a bare
 * `setTimeout`: a plain Node-side sleep does not guarantee the page's own
 * rAF-driven `uiManager.update` actually runs while a harness sits idle
 * between CDP round trips (headless Chrome can throttle rAF for an
 * unpainted, `suspendDrawing`-suspended page), so a selector that only
 * becomes usable once state changes propagate to the DOM could poll a
 * frozen, stale render forever. `waitForUiUpdate` explicitly pumps two rAF
 * passes from inside the page every iteration instead of hoping one lands.
 */
async function waitUsableAndClick(page: Page, selector: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const reason = await page.evaluate((sel: string) => {
      const probe = (window as unknown as {
        __probeSelector?: (s: string) => string | null;
      }).__probeSelector;
      if (probe === undefined) return null;
      document.querySelector(sel)?.scrollIntoView({ block: 'center', inline: 'nearest' });
      return probe(sel);
    }, selector);
    if (reason === null) break;
    if (Date.now() > deadline) {
      throw new Error(`"${selector}" never became usable: ${describeUnclickable(await inspectSelector(page, selector))}`);
    }
    await waitForUiUpdate(page);
    await new Promise((r) => setTimeout(r, 150));
  }
  await page.click(selector);
}

/**
 * Read-only commands an `observe`-marked step may run.
 *
 * These report state rather than changing it, which is how a scenario records
 * what happened — there is no button for "dump the game state", and there
 * should not be. Kept as an explicit list rather than a naming convention
 * (`*_list`, `*_status`) so that adding a mutating command to it is a visible
 * edit here, not an accident of what somebody named a subcommand.
 */
export const OBSERVATION_COMMANDS = [
  'state', 'scores', 'finances', 'needs', 'inspect', 'fragments', 'stats',
  'preview', 'terrain_info', 'help',
  // NOT `corrupt`: unlike every entry above, `corrupt` mutates state the
  // moment `target:` is present (corruptCommand, events.ts) — its bare,
  // no-args form is the only read-only shape, and this list's own top-token
  // check can't express "bare only" without also admitting `corrupt
  // target:X`. See BOOTSTRAP_COMMAND_ALLOWLIST's `corrupt` entry instead
  // (issue #515) — same class of gap already accepted for bare `weather`.
  // NOT here, on purpose: `blast_preview` ("Run Analysis") writes
  // state.lastBlastPreview (mining.ts) — it is an action with a real button
  // (`[data-action="run-analysis"]`), not a read; `preview <slice>` is the
  // read of what it wrote. `blast_plan` is `save|load|list|validate` —
  // save/load mutate, so the bare command can't be blanket-allowed either.
  // Both were wrongly in this list originally; caught converting scenarios
  // that actually click "Run Analysis" (issue #479).
] as const;

/**
 * Read-only *subcommands*: `<command> list|status|show|types|mode|ore_report`
 * inspects, where the bare command would act. `vehicle list` is an
 * observation; `vehicle buy` is a player action.
 */
const OBSERVATION_SUBCOMMANDS = ['list', 'status', 'show', 'types', 'mode', 'ore_report'] as const;

/** True when `command` only reports state. */
export function isObservationCommand(command: string): boolean {
  const [top, sub] = command.trim().split(/\s+/);
  if (top === undefined) return false;
  if ((OBSERVATION_COMMANDS as readonly string[]).includes(top)) return true;
  return sub !== undefined && (OBSERVATION_SUBCOMMANDS as readonly string[]).includes(sub);
}

/**
 * Console commands a `bootstrap`-marked step may run (issue #515).
 *
 * Narrower than {@link SETUP_COMMAND_ALLOWLIST}: a bootstrap command has no
 * UI equivalent and no business having one (e.g. `employee assign_skill`,
 * which exists so a test doesn't have to grind XP for real — the
 * player-facing path is `employee train`), rather than standing in for world
 * setup a player never does. Kept as an explicit list for the same reason
 * {@link OBSERVATION_COMMANDS} is: adding an entry is a visible edit here,
 * not an accident of what a step happened to call.
 */
export const BOOTSTRAP_COMMAND_ALLOWLIST: readonly string[] = [
  'employee assign_skill',
  'employee dispatch',
  'weather set',
  'weather',
  'event fire',
  // Broader than the others on purpose, for two independent reasons:
  //  1. `corrupt target:X cost:Y` — the scenario overrides the bribe's cost
  //     to hit an exact scripted cash delta; ShadyPanel's real "Make the
  //     Call" button always bribes at the fixed TARGET_COSTS rate
  //     (Corruption.ts) and has no control for a custom amount, so no real
  //     click can reproduce this exact state change (level1-lose-arrest.json's
  //     opening 8 bribes all carry a `cost:` override) — the same shape of
  //     gap already accepted for bare `weather` above.
  //  2. Bare `corrupt` — the read-only status query — shares that same verb,
  //     so it rides the same entry.
  //  This entry is not file-scoped: the allowlist has no per-file mechanism,
  //  it is a flat global list, so any `bootstrap`-tagged step anywhere that
  //  runs `corrupt ...` (with or without a `cost:` override, e.g.
  //  insufficient-funds-guards-visual.json's plain `corrupt target:witness`
  //  bootstrap steps) is admitted by this one entry too. Accepted tradeoff
  //  for now — narrower only buys back a `target:witness`-shaped case that
  //  needs the override anyway, elsewhere in the same file.
  'corrupt',
  // building-lifecycle.json exercises the console's own bad-id rejection
  // (building #2 was never placed) — there is no row, so no button exists
  // in the DOM for `expect.blocked` to point at, and no player could ever
  // target an id that was never shown to them. Narrow (this exact id) on
  // purpose: every OTHER `build move`/`build destroy` in the suite acts on
  // a real building and is a real click or a `guard` against a genuinely
  // disabled (present) button.
  'build move 2',
  'build destroy 2',
  // `office`/`medical_bay`/`canteen`/`storage_depot`/`break_room`/`bunkhouse`
  // are not, and have never been, real `BuildingType` values (Building.ts) —
  // several playthrough/bankruptcy scenarios attempt them anyway and each
  // rejects with "Unknown subcommand or building type" (verified per-file).
  // No catalog row exists, or ever should, for a type that isn't real, so
  // there is nothing for a player to click; this is a permanent bootstrap
  // primitive, not a temporary one. Issue #526 confirmed these six strings
  // are permanently non-real and reconciled the docs accordingly; the
  // real-type mapping (office→management_office, storage_depot→freight_warehouse,
  // canteen/bunkhouse/break_room/medical_bay→living_quarters) now lives in the
  // gameplay-employee-needs skill doc.
  'build office',
  'build medical_bay',
  'build canteen',
  'build storage_depot',
  'build break_room',
  'build bunkhouse',
  // site-expansion.json: whether the 3D tile picker can raycast a
  // still-unexpanded region (before drilling/building there triggers
  // auto-expansion) is unverified — left as commands rather than gambling a
  // batch run on an edge case none of the suite's other converted files
  // needed. Exact-command narrow, not a general `drill_plan add`/`build_ramp`/
  // `build management_office` exemption — those verbs have real, exercised
  // click paths elsewhere (e.g. presplit-wall.json's `drill_plan add`).
  'drill_plan add x:34 z:10 depth:6',
  'drill_plan add x:-4 z:10 depth:6',
  'build_ramp origin:30,20 direction:east length:8 depth:6',
  'build management_office at:34,4',
  // tutorial-steps-visual.json: this ramp isn't one of the tutorial's own
  // canonical stages, so with the rail pointed elsewhere the Build panel's
  // ramp tool is off-target and inert to a real click (tutorialGuide.ts) —
  // no UI path reaches it while this tutorial runs.
  'build_ramp start:10,15 end:10,25',
  // level3-playthrough-ecology.json: `amount:12`/`amount:15` are outside
  // krackle's own [1, 10] kg range (ExplosiveCatalog.ts). The amount
  // stepper clamps to the selected product's range (Charge.ts), so no click
  // sequence can ever reach either value while krackle is selected — a
  // genuine reachability gap, not a missing selector. The console has no
  // such clamp, so `createCharge` rejects these at 0 charged, which is the
  // scenario's own point (a blast that fails to fire). See the step's own
  // description for the full trace.
  'charge hole:* explosive:krackle amount:12 stemming:1',
  'charge hole:* explosive:krackle amount:15 stemming:1',
  // `zone clear x1:.. y1:.. x2:.. y2:..` — Fire.ts's Sound the Horn button
  // always computes its own rectangle from the live drill plan
  // (`computeDangerZone`), never a player-typed one, so a literal rectangle
  // override has no UI equivalent and no business having one.
  'zone clear',
  // scores-display-visual.json: `stemming:0.5` is the Charge panel's own
  // floor — `adjustStemming` clamps at `Math.max(0.5, ...)` (Charge.ts) —
  // the minimal value reachable by any click sequence. Kept as `bootstrap`
  // for its `hole:*` batch shorthand rather than driving the individual
  // amount/stemming steppers for real (see blast-execution-visual.json for
  // the player-role version of this same charge).
  'charge hole:* explosive:boomite amount:8 stemming:0.5',
  // blast-fire/preview/sequence-step-visual.json: the Charge step right
  // after each of these is the Blast panel's own designated first-open
  // (`#bs-toolbar [data-panel="blast"]` is a toggle) — giving the drill
  // step its own panel-open click would leave the panel open and then
  // CLOSE it when the charge step's click ran next.
  'drill_plan grid origin:10,10 rows:1 cols:1 spacing:3 depth:6',
  'drill_plan grid origin:10,10 rows:2 cols:2 spacing:3 depth:6',
  // blast-preview-step-visual.json: an ABSOLUTE per-hole delay — the panel
  // only exposes relative +/- steppers (Sequence.ts), so there is no click
  // path to a specific value.
  'sequence set hole:H1 delay:0ms',
  // rock-fragmenter-breaking.json: fragment #0 is oversized, so
  // `findReachableGroundFragment`'s eligibility cache excludes it outright
  // and `.bs-vehicle-haul-btn` never renders for it — no control exists to
  // click, not merely one that's disabled.
  'vehicle haul 1 fragment:0',
  // vehicle-driver-assignment-visual.json: vehicle #1 already has a driver
  // (FleetPanel shows only Unassign, not the assign picker), and even that
  // picker would never list employee #2 (a blaster has no driving.truck
  // licence) — genuinely unreachable by a click.
  'vehicle driver 1 2',
  // vehicle-task-states-visual.json: `vehicle assign <id> task:<task>`
  // writes the VehicleTask enum directly, skipping the drive/load/unload
  // sequence ArrivalGate drives — a test-only state poke alongside
  // `employee assign_skill` (gap G5); every player-meaningful task has its
  // own real control instead (Haul, Break, MOVE HERE).
  'vehicle assign 1 task:transport',
  // needs-cycle.json: "hauler" is not a real hire role (Usage:
  // employee hire role:(driller|blaster|driver|surveyor|manager)) — there
  // is no hire button for a role that doesn't exist, a genuine no-op in
  // both modes.
  'employee hire role:hauler',
];

/**
 * Whether `command` starts with `entry` at a genuine token boundary — the
 * next character (if any) is whitespace, a `:` (an argument like
 * `hole:H1` glued to its verb with no space), or the end of the string.
 * Plain `startsWith` would let `corrupt target:witness` match
 * `corrupt target:witness2`; a bare-token split (mirroring
 * `isAllowedSetupCommand`) would fail to match `charge hole` against
 * `charge hole:*`, since `hole:*` isn't the literal token `hole`. This is
 * the narrowest rule that satisfies both.
 */
function matchesBootstrapEntry(command: string, entry: string): boolean {
  if (!command.startsWith(entry)) return false;
  const next = command[entry.length];
  return next === undefined || next === ' ' || next === ':';
}

/** True when `command` may appear in a `bootstrap`-marked step. */
export function isAllowedBootstrapCommand(command: string): boolean {
  const trimmed = command.trim();
  return BOOTSTRAP_COMMAND_ALLOWLIST.some(entry => matchesBootstrapEntry(trimmed, entry));
}

/**
 * Whether `action` (already known to be a `command`) may run inside `step`,
 * given the step's role (issue #479, extended by #515). Returns a message
 * naming the step and the reason when it may not; `null` when it is fine.
 *
 * A player step may not reach the console at all — a click that was awkward
 * is a playability finding, not license to type it instead. A setup step may
 * still run a command, but only one `isAllowedSetupCommand` admits: the one
 * allowlist every `setup`-role caller shares (`interaction-types.ts`), so
 * there is exactly one place that decides what counts as "setup" instead of
 * two that can drift apart. An observe step is held to
 * `isObservationCommand`, so "I only wanted to read the state" cannot smuggle
 * a `build` through. A bootstrap step is held to the narrower
 * `isAllowedBootstrapCommand`. A guard step is not checked against a command
 * allowlist at all — it must instead carry `expect.blocked`, since a guard
 * step proves a control is unreachable rather than running one. A step with
 * no role is unconstrained — see {@link ScenarioStepRole}.
 */
export function checkStepActionAllowed(
  step: ScenarioStepDef,
  action: InteractionStepAction & { type: 'command' },
): string | null {
  const label = step.description ?? step.command;
  if (step.role === 'player') {
    return `step "${label}" is player-marked but its interaction runs console command `
      + `"${action.command}" — player steps must be completed by clicking, not a console command.`;
  }
  if (step.role === 'setup' && !isAllowedSetupCommand(action.command)) {
    return `step "${label}" is setup-marked but runs console command "${action.command}", `
      + `which is not on the setup allowlist (${[...SETUP_COMMAND_ALLOWLIST, ...TIME_COMMAND_ALLOWLIST].join(', ')}).`;
  }
  if (step.role === 'observe' && !isObservationCommand(action.command)) {
    return `step "${label}" is observe-marked but runs console command "${action.command}", `
      + `which changes state rather than reporting it — mark it "player" and click it, or "setup" if it bootstraps the world.`;
  }
  if (step.role === 'bootstrap' && !isAllowedBootstrapCommand(action.command)) {
    return `step "${label}" is bootstrap-marked but runs console command "${action.command}", `
      + `which is not on the bootstrap allowlist (${BOOTSTRAP_COMMAND_ALLOWLIST.join(', ')}).`;
  }
  if (step.role === 'guard' && step.expect?.blocked === undefined) {
    return `step "${label}" is guard-marked but has no expect.blocked — a guard step must prove `
      + `a specific control is disabled, not just run a command.`;
  }
  return null;
}

/**
 * Executes a single interaction action on the given Puppeteer page.
 * Handles all supported action types: click, mousedown, mouseup, mousemove,
 * keypress, keydown, keyup, scroll, wheel, wait, waitForSelector, type,
 * assert, viewport, command.
 *
 * @param page - Puppeteer page object.
 * @param action - The interaction action to execute.
 * @param step - The step `action` belongs to, so a `command` action can be
 *   checked against the step's role (issue #479).
 */
export async function executeActionOnPage(
  page: Page,
  action: InteractionStepAction,
  step: ScenarioStepDef,
): Promise<void> {
  switch (action.type) {
    case 'click': {
      const btn = BUTTON_MAP[action.button ?? 'left'] ?? 'left';
      await page.mouse.click(action.x, action.y, { button: btn });
      break;
    }
    case 'clickSelector': {
      const btn = BUTTON_MAP[action.button ?? 'left'] ?? 'left';
      const timeoutMs = action.timeout ?? 5000;
      // Wait until the page's own probe calls the control usable — an absent
      // selector reports 'absent' (uiActionProbe.ts) rather than null, so this
      // loop alone covers "never appears" the same deadline as "appears but
      // stays blocked"; a separate waitForSelector before it duplicated that
      // wait and, when the selector genuinely never appeared, threw Puppeteer's
      // own unnamed timeout instead of this loop's describeUnclickable
      // diagnosis. panels pre-exist hidden, and the tutorial rails mark a
      // control allowed only on the guide's next 250ms pass — a machine-speed
      // click in that gap lands on `pointer-events: none` and falls through
      // silently, because page.click does not throw for it (#481).
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const reason = await page.evaluate((sel: string) => {
          const probe = (window as unknown as {
            __probeSelector?: (s: string) => string | null;
          }).__probeSelector;
          if (probe === undefined) return null;
          // Scroll into view before probing, exactly as page.click will before
          // clicking: a row below a panel's fold has its centre over the game
          // canvas until scrolled, and probing that reads as covered-forever.
          document.querySelector(sel)?.scrollIntoView({ block: 'center', inline: 'nearest' });
          return probe(sel);
        }, action.selector);
        if (reason === null) break;
        if (Date.now() > deadline) {
          throw new Error(
            `clickSelector "${action.selector}" failed: ${describeUnclickable(await inspectSelector(page, action.selector))}`,
          );
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      try {
        await page.click(action.selector, { button: btn });
      } catch (err) {
        // Puppeteer's own message ("Node is either not clickable or not an
        // Element") names nothing, so a failure reports only that *something*
        // on the page could not be clicked. Name the selector and say why it
        // was refused — inert almost always means a `pointer-events: none`
        // rail, which is a real player-facing block, not a test flake.
        throw new Error(
          `clickSelector "${action.selector}" failed: ${describeUnclickable(await inspectSelector(page, action.selector))}`,
          { cause: err },
        );
      }
      break;
    }
    case 'pickTile': {
      // P3: in-scene placement, not the old 2D canvas. Command mode drives it
      // through window.__placement directly (interaction mode drives the same
      // tool with real clicks instead — see interaction-driver.ts).
      await awaitPlacementArmed(page, PICKER_TIMEOUT_MS);
      await page.evaluate((x: number, z: number) => (window as unknown as {
        __placement: { paintRect: (x1: number, z1: number, x2: number, z2: number) => void };
      }).__placement.paintRect(x, z, x, z), action.x, action.z);
      break;
    }
    case 'dragTiles': {
      await awaitPlacementArmed(page, PICKER_TIMEOUT_MS);
      await page.evaluate((x1: number, z1: number, x2: number, z2: number) => (window as unknown as {
        __placement: { paintRect: (x1: number, z1: number, x2: number, z2: number) => void };
      }).__placement.paintRect(x1, z1, x2, z2), action.x1, action.z1, action.x2, action.z2);
      break;
    }
    case 'mousedown': {
      const btn = BUTTON_MAP[action.button ?? 'left'] ?? 'left';
      // The action carries coordinates, so honour them rather than pressing
      // wherever the cursor happens to be.
      await page.mouse.move(action.x, action.y);
      await page.mouse.down({ button: btn });
      break;
    }
    case 'mouseup': {
      const btn = BUTTON_MAP[action.button ?? 'left'] ?? 'left';
      await page.mouse.move(action.x, action.y);
      await page.mouse.up({ button: btn });
      break;
    }
    case 'mousemove':
      await page.mouse.move(action.x, action.y);
      break;
    case 'keypress':
      await page.keyboard.press(action.key as KeyInput);
      break;
    case 'keydown':
      await page.keyboard.down(action.key as KeyInput);
      break;
    case 'keyup':
      await page.keyboard.up(action.key as KeyInput);
      break;
    case 'scroll':
      await page.evaluate(
        ({ x, y }: { x: number; y: number }) => window.scrollTo(x, y),
        { x: action.x, y: action.y },
      );
      break;
    case 'wheel':
      await page.mouse.wheel({ deltaX: action.deltaX, deltaY: action.deltaY });
      break;
    case 'wait':
      await new Promise((r) => setTimeout(r, action.durationMs));
      break;
    case 'waitForSelector':
      await page.waitForSelector(action.selector, { timeout: action.timeout ?? 10000 });
      break;
    case 'resolveEventIfPending': {
      // Ask the game, not the DOM. `event status` is read-only
      // (isObservationCommand admits it) and this is the harness deciding
      // whether to wait — the resolution itself is a real click below.
      const pending = await page.evaluate(() => {
        const run = (window as unknown as {
          __gameConsole?: (c: string) => { output?: unknown };
        }).__gameConsole;
        if (run === undefined) return false;
        const out = String(run('event status').output ?? '');
        return !/no pending event/i.test(out);
      });
      if (!pending) break;

      // An event can be genuinely pending in state while the level has
      // already ended (bankruptcy/revolt/ecological shutdown) — the event
      // system keeps scheduling regardless. Once that happens the dialog is
      // permanently unreachable by design, not a rendering race:
      // LevelEndScreen owns the whole screen from the moment
      // state.levelEndReason goes non-null (UIManager.update defers
      // eventModal for exactly this reason, mirroring the same deferral
      // BlastReportModal already needed). A real player has no click left to
      // make here either — the level is over — so resolve the same way
      // command mode already does (a direct console call) rather than
      // hanging `evTimeout` waiting on a control that will never show.
      const levelEnded = await page.evaluate(() => {
        const getState = (window as unknown as {
          __gameState?: () => { levelEndReason: string | null } | null;
        }).__gameState;
        return getState?.()?.levelEndReason != null;
      });
      if (levelEnded) {
        await page.evaluate(() => {
          const run = (window as unknown as {
            __gameConsole?: (c: string) => unknown;
          }).__gameConsole;
          run?.('event choose 0');
        });
        break;
      }

      // Something IS pending, so the dialog must appear — wait for it to be
      // genuinely usable (see `waitUsableAndClick`'s own doc comment for why
      // a bare `page.waitForSelector` is the wrong primitive here: the panel
      // pre-exists hidden and swaps its content, so a presence-only wait can
      // resolve instantly against the previous event's stale, invisible
      // buttons) rather than probing briefly, and fail loudly if it never
      // becomes usable at all.
      const evTimeout = action.timeoutMs ?? 30000;
      await waitUsableAndClick(page, '#bs-event-dialog .bs-event-choice', evTimeout);
      // The outcome panel replaces the choices; dismiss it if it appears. Its
      // own budget is short, not `evTimeout` — plenty of events resolve with
      // no outcome panel at all, and `waitUsableAndClick`'s probe (unlike the
      // old presence-only `page.waitForSelector` it replaced) correctly does
      // NOT resolve early against stale content, so this case now genuinely
      // waits out its full budget every time it fires; 30s of that per
      // no-outcome event across this file's several dozen resolutions would
      // dominate the run.
      try {
        await waitUsableAndClick(page, '#bs-event-dialog .bs-event-dismiss', 3000);
      } catch {
        // Some events resolve without an outcome panel — not a failure.
      }
      break;
    }
    case 'clickIfPresent': {
      // Poll for the control to become usable, but treat "never showed up" as a
      // legitimate outcome rather than a failure — see the type's own doc
      // comment for why this is not an escape hatch. Reuses the same
      // `__probeSelector` usability gate `clickSelector` clicks through, so a
      // control that IS present but inert still counts as not-clickable here
      // (a tutorial rail blocking it is a real block, and silently clicking
      // through it would prove nothing).
      const settleMs = action.timeoutMs ?? 0;
      const deadline = Date.now() + settleMs;
      for (;;) {
        const usable = await page.evaluate((sel: string) => {
          const el = document.querySelector(sel);
          if (el === null) return false;
          const probe = (window as unknown as {
            __probeSelector?: (s: string) => string | null;
          }).__probeSelector;
          if (probe === undefined) return true;
          el.scrollIntoView({ block: 'center', inline: 'nearest' });
          return probe(sel) === null;
        }, action.selector);
        if (usable) {
          await page.click(action.selector);
          break;
        }
        if (Date.now() >= deadline) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      break;
    }
    case 'waitForTutorialStep': {
      const wanted = Array.isArray(action.stepId) ? action.stepId : [action.stepId];
      const deadline = Date.now() + (action.timeout ?? 30000);
      // Drive the real rAF-driven, isPaused-gated clock for this wait only —
      // the tutorial's own completion checks and any queued work (walking,
      // surveying, hauling) need time to pass, and scenarioMode has switched
      // the auto-tick off. Restored on the way out so every other action keeps
      // the deterministic scripted-tick clock.
      const setAutoTick = (enabled: boolean) => page.evaluate((on: boolean) => {
        (window as unknown as { __setAutoTick?: (e: boolean) => void }).__setAutoTick?.(on);
      }, enabled);
      await setAutoTick(true);
      try {
        for (;;) {
          const st = await page.evaluate(() => {
            const fn = (window as unknown as {
              __tutorialState?: () => { active: boolean; stepId: string | null; stageTarget: string | null };
            }).__tutorialState;
            return fn === undefined ? null : fn();
          });
          // Tutorial gone (finished or never started) — nothing left to wait on.
          if (st === null || !st.active) break;
          if (st.stepId !== null && wanted.includes(st.stepId)) break;
          if (Date.now() > deadline) {
            throw new Error(
              `waitForTutorialStep: tutorial never reached ${wanted.map(s => `"${s}"`).join(' or ')}`
              + ` — it is on "${st.stepId}", live control ${st.stageTarget ?? 'none'}`,
            );
          }
          await new Promise((r) => setTimeout(r, 200));
        }
      } finally {
        await setAutoTick(false);
      }
      break;
    }
    case 'type':
      await page.type(action.selector, action.text, {
        ...(action.delay !== undefined ? { delay: action.delay } : {}),
      });
      break;
    case 'assert': {
      if (action.selector) {
        const element = await page.$(action.selector);
        if (!element) {
          throw new Error(`Assert FAILED: selector "${action.selector}" not found`);
        } else if (action.property && action.expectedValue !== undefined) {
          const actual = await element.evaluate(
            (el: Element, prop: string) => (el as unknown as Record<string, unknown>)[prop],
            action.property,
          );
          const passed = JSON.stringify(actual) === JSON.stringify(action.expectedValue);
          if (!passed) {
            throw new Error(`Assert FAILED: expected ${action.property}=${JSON.stringify(action.expectedValue)}, got ${JSON.stringify(actual)}`);
          }
        }
      }
      break;
    }
    case 'viewport':
      await page.setViewport({ width: action.width, height: action.height });
      break;
    case 'command': {
      const violation = checkStepActionAllowed(step, action);
      if (violation !== null) throw new Error(violation);
      await page.evaluate((cmd: string) => {
        if (typeof (window as any).__gameConsole === 'function') {
          return (window as any).__gameConsole(cmd);
        }
        return undefined;
      }, action.command);
      break;
    }
    case 'cameraFocus':
      await page.evaluate(({ x, z, distance }: { x: number; z: number; distance: number }) => {
        (window as any).__cameraFocus(x, z, distance);
        // Interaction mode suspends the draw loop (#475) — matrixWorld for
        // both the camera and every entity group is only ever current right
        // after a real frame, so force one before any click/mousemove that
        // needs to raycast against the new framing.
        (window as any).__renderFrame?.();
      }, { x: action.x, z: action.z, distance: action.distance });
      break;
    case 'loadingScreenDebug':
      // A real level load blocks the main thread for seconds — no player
      // action a scenario can drive gets there deterministically, so this
      // bypasses the load and previews the loading screen directly (#493).
      await page.evaluate(({ debugAction, kind, locale }: { debugAction: string; kind: string | undefined; locale: string | undefined }) => {
        if (debugAction === 'hide') {
          (window as any).__loadingScreenHide?.();
        } else {
          (window as any).__loadingScreenPreview?.(kind, locale);
        }
      }, { debugAction: action.action, kind: action.kind, locale: action.locale });
      break;
    case 'screenshot':
      // Screenshot is handled by the caller, not here
      break;
    // The vocabulary ported from the playability harness (issue #479). These
    // are structurally identical to their `PlayerAction` counterparts, so they
    // run through `runAction` (`interaction-driver.ts`) rather than being
    // reimplemented here — one implementation shared by every caller,
    // including the failure diagnosis.
    case 'set':
    case 'clickLabel':
    case 'awaitUsable':
    case 'zoomOut':
    case 'focusTile':
    case 'clickEntity': {
      const { type, ...rest } = action;
      await runAction(page, { do: type, ...rest } as PlayerAction);
      break;
    }
    default: {
      // Exhaustiveness check
      const _exhaustive: never = action;
      console.warn(`  Unknown interaction action type: ${(_exhaustive as any).type}`);
      break;
    }
  }
}
