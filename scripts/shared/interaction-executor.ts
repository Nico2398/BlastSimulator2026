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
import { isAllowedSetupCommand, SETUP_COMMAND_ALLOWLIST, TIME_COMMAND_ALLOWLIST } from './playtest-types.js';
import type { PlayerAction } from './playtest-types.js';
import { runAction } from './playtest-driver.js';

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
 * Whether `action` (already known to be a `command`) may run inside `step`,
 * given the step's role (issue #479). Returns a message naming the step and
 * the reason when it may not; `null` when it is fine.
 *
 * A player step may not reach the console at all — a click that was awkward
 * is a playability finding, not license to type it instead. A setup step may
 * still run a command, but only one `isAllowedSetupCommand` admits: the same
 * allowlist the playtest harness uses to bootstrap a world, reused rather
 * than reinvented so there is exactly one place that decides what counts as
 * "setup" instead of two that can drift apart. An observe step is held to
 * `isObservationCommand`, so "I only wanted to read the state" cannot smuggle
 * a `build` through. A step with no role is unconstrained — see
 * {@link ScenarioStepRole}.
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
      await page.waitForSelector(action.selector, { timeout: timeoutMs });
      // Wait until the page's own probe calls the control usable, the same
      // gate the playtest driver clicks through. waitForSelector alone is not
      // enough: panels pre-exist hidden, and the tutorial rails mark a control
      // allowed only on the guide's next 250ms pass — a machine-speed click in
      // that gap lands on `pointer-events: none` and falls through silently,
      // because page.click does not throw for it (#481).
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
      // P3: in-scene placement, not the old 2D canvas. Scenario mode drives it
      // through window.__placement directly (playtest mode drives the same
      // tool with real clicks instead — see playtest-driver.ts).
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

      // Something IS pending, so the dialog must appear — wait properly rather
      // than probing briefly, and fail loudly if it never does.
      const evTimeout = action.timeoutMs ?? 30000;
      await page.waitForSelector('#bs-event-dialog .bs-event-choice', { timeout: evTimeout });
      await page.click('#bs-event-dialog .bs-event-choice');
      // The outcome panel replaces the choices; dismiss it if it appears.
      try {
        await page.waitForSelector('#bs-event-dialog .bs-event-dismiss', { timeout: evTimeout });
        await page.click('#bs-event-dialog .bs-event-dismiss');
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
    // The vocabulary shared with the playability harness (issue #479). These
    // are structurally identical to their `PlayerAction` counterparts, so they
    // run through `runAction` rather than being reimplemented here — one
    // implementation means a converted scenario step and the playtest beat it
    // mirrors genuinely do the same thing, including the failure diagnosis.
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
