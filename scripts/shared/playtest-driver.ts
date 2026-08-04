/**
 * BlastSimulator2026 — Playtest driver
 *
 * Executes player actions against a live page and reports, for every failure,
 * which control blocked and why. No console access is exposed to actions.
 *
 * @module shared/playtest-driver
 */

import type { Page } from 'puppeteer';
import type { PlayerAction, PlaytestGoal } from './playtest-types.js';
import { awaitPlacementArmed, worldToScreenPoint } from './tile-picker.js';

/** Mirror of src/ui/uiActionProbe.ts UiAction, kept structural to avoid a src import. */
export interface ProbedAction {
  selector: string;
  label: string;
  tag: string;
  region: string;
  usable: boolean;
  blockedBy: string | null;
  hint: string | null;
}

export interface TutorialSnapshot {
  active: boolean;
  stepIndex: number;
  stepId: string | null;
  title: string;
  total: number;
}

export class PlaytestFailure extends Error {
  constructor(message: string, readonly diagnosis: string) {
    super(message);
    this.name = 'PlaytestFailure';
  }
}

const DEFAULT_TIMEOUT_MS = 6000;
const SETTLE_MS = 350;

export async function probe(page: Page): Promise<ProbedAction[]> {
  return page.evaluate(() => (window as unknown as {
    __uiActions: () => ProbedAction[];
  }).__uiActions()) as Promise<ProbedAction[]>;
}

export async function tutorialState(page: Page): Promise<TutorialSnapshot> {
  return page.evaluate(() => (window as unknown as {
    __tutorialState: () => TutorialSnapshot;
  }).__tutorialState()) as Promise<TutorialSnapshot>;
}

export async function gameState(page: Page): Promise<Record<string, unknown>> {
  const state = await page.evaluate(() => (window as unknown as {
    __gameState: () => Record<string, unknown> | null;
  }).__gameState());
  return state ?? {};
}

/**
 * Human-readable inventory of what the player could have done instead. This is
 * what turns "selector timed out" into an actionable bug report.
 */
export function describeAvailable(actions: ProbedAction[]): string {
  const usable = actions.filter(a => a.usable);
  const blocked = actions.filter(a => !a.usable && a.blockedBy !== 'hidden');
  const lines: string[] = [];
  lines.push(`  usable now (${usable.length}):`);
  for (const a of usable.slice(0, 25)) {
    lines.push(`    [${a.region}] ${a.label || a.tag}  →  ${a.selector}`);
  }
  if (blocked.length > 0) {
    lines.push(`  present but unusable (${blocked.length}):`);
    for (const a of blocked.slice(0, 25)) {
      const why = a.hint ? `${a.blockedBy} — "${a.hint}"` : a.blockedBy;
      lines.push(`    [${a.region}] ${a.label || a.tag}  (${why})  →  ${a.selector}`);
    }
  }
  return lines.join('\n');
}

/** Ask the page directly about one selector, rather than matching probe output. */
async function blockedReason(page: Page, selector: string): Promise<string | null> {
  return page.evaluate((sel: string) => (window as unknown as {
    __probeSelector: (s: string) => string | null;
  }).__probeSelector(sel), selector) as Promise<string | null>;
}

async function requireUsable(page: Page, selector: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let reason: string | null = 'absent';
  for (;;) {
    reason = await blockedReason(page, selector);
    if (reason === null) return;
    if (Date.now() > deadline) break;
    await new Promise(r => setTimeout(r, 150));
  }

  const actions = await probe(page);
  // Surface the panel's own explanation when it has one — that is usually the
  // real answer ("Hire a surveyor with a geology qualification first").
  const sameRegion = actions.find(a => a.selector === selector)?.hint
    ?? actions.find(a => !a.usable && a.hint)?.hint
    ?? null;
  const why = reason === 'absent'
    ? 'it is not in the DOM at all'
    : `it is present but ${reason}${sameRegion ? ` — panel says "${sameRegion}"` : ''}`;
  throw new PlaytestFailure(
    `control "${selector}" never became usable: ${why}`,
    describeAvailable(actions),
  );
}

/**
 * Wait for the P3 placement tool to be armed, with a playtest-shaped
 * diagnosis on miss. The polling itself lives in `tile-picker.ts` so the
 * scenario channel waits on the same condition; only the failure report
 * differs.
 */
async function armedPlacement(page: Page): Promise<void> {
  try {
    await awaitPlacementArmed(page, DEFAULT_TIMEOUT_MS);
  } catch {
    throw new PlaytestFailure('no placement tool is armed', describeAvailable(await probe(page)));
  }
}

/** Run one player action, throwing PlaytestFailure with a diagnosis on failure. */
export async function runAction(page: Page, action: PlayerAction): Promise<void> {
  switch (action.do) {
    case 'click': {
      await requireUsable(page, action.selector, DEFAULT_TIMEOUT_MS);
      await page.click(action.selector);
      break;
    }
    case 'clickLabel': {
      const actions = await probe(page);
      const wanted = action.label.toLowerCase();
      const match = actions.find(a =>
        a.usable
        && a.label.toLowerCase().includes(wanted)
        && (action.region === undefined || a.region === action.region));
      if (!match) {
        throw new PlaytestFailure(
          `no usable control labelled "${action.label}"${action.region ? ` in ${action.region}` : ''}`,
          describeAvailable(actions),
        );
      }
      await page.click(match.selector);
      break;
    }
    case 'set': {
      await requireUsable(page, action.selector, DEFAULT_TIMEOUT_MS);
      await page.select(action.selector, action.value).catch(async () => {
        await page.evaluate(({ sel, val }: { sel: string; val: string }) => {
          const el = document.querySelector(sel) as HTMLInputElement | null;
          if (!el) return;
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, { sel: action.selector, val: action.value });
      });
      break;
    }
    case 'pickTile': {
      // P3: a real click on the in-scene placement tool's projected screen
      // point, not a console-equivalent shortcut — playability's whole point
      // is that this has to be a click a player could actually make.
      await armedPlacement(page);
      const { px, py } = await worldToScreenPoint(page, action.x, action.z);
      await page.mouse.click(px, py);
      break;
    }
    case 'dragTiles': {
      await armedPlacement(page);
      const from = await worldToScreenPoint(page, action.x1, action.z1);
      const to = await worldToScreenPoint(page, action.x2, action.z2);
      await page.mouse.move(from.px, from.py);
      await page.mouse.down();
      await page.mouse.move(to.px, to.py, { steps: 10 });
      await page.mouse.up();
      break;
    }
    case 'clickEntity': {
      const pos = await page.evaluate(({ kind, id }: { kind: string; id: number }) =>
        (window as unknown as {
          __entityWorldPosition: (k: string, i: number) => { x: number; z: number } | null;
        }).__entityWorldPosition(kind, id), { kind: action.kind, id: action.id });
      if (!pos) {
        throw new PlaytestFailure(
          `no ${action.kind} #${action.id} is on the scene to click`,
          describeAvailable(await probe(page)),
        );
      }
      await page.evaluate(({ x, z, distance }: { x: number; z: number; distance: number }) => {
        (window as unknown as { __cameraFocus: (x: number, z: number, d: number) => void }).__cameraFocus(x, z, distance);
        // Playtests suspend the draw loop like interaction-mode scenarios
        // (#475) — force a frame so the new camera position and the scene's
        // entity transforms are current before the click below raycasts.
        (window as unknown as { __renderFrame?: () => void }).__renderFrame?.();
      }, { x: pos.x, z: pos.z, distance: action.distance ?? 15 });
      const viewport = page.viewport();
      await page.mouse.click((viewport?.width ?? 1280) / 2, (viewport?.height ?? 720) / 2);
      break;
    }
    case 'zoomOut': {
      const centerX = (page.viewport()?.width ?? 1280) / 2;
      const centerY = (page.viewport()?.height ?? 720) / 2;
      await page.mouse.move(centerX, centerY);
      // Real wheel events over the canvas — same control a player scrolls,
      // positive deltaY zooms out per CameraController.onWheel.
      for (let i = 0; i < (action.ticks ?? 25); i++) {
        await page.mouse.wheel({ deltaY: 100 });
      }
      // Matrices refreshed like clickEntity's camera move above — the
      // following pickTile/dragTiles raycasts against this new framing.
      await page.evaluate(() => (window as unknown as { __renderFrame?: () => void }).__renderFrame?.());
      break;
    }
    case 'awaitUsable': {
      await requireUsable(page, action.selector, action.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      break;
    }
    case 'awaitTutorialStep': {
      const wanted = Array.isArray(action.stepId) ? action.stepId : [action.stepId];
      const deadline = Date.now() + (action.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      let seen: TutorialSnapshot | null = null;
      for (;;) {
        seen = await tutorialState(page);
        if (seen.stepId !== null && wanted.includes(seen.stepId)) break;
        if (Date.now() > deadline) {
          throw new PlaytestFailure(
            `tutorial never reached ${wanted.map(s => `"${s}"`).join(' or ')}`
            + ` — it is on "${seen.stepId}" (${seen.title})`,
            describeAvailable(await probe(page)),
          );
        }
        // The harness navigates with ?scenarioMode=1, which turns off the
        // page's own automatic clock (main.ts) so scenario/playtest runs stay
        // deterministic. A step whose completion depends on time passing — a
        // driver walking to board a vehicle, queued work resolving — would
        // otherwise wait here until timeout no matter how long the deadline,
        // since nothing on the page ever ticks it. Advance one tick per poll,
        // never a bulk jump: a step that only deadlocks under gradual
        // progression (the failure mode this action exists to catch) still
        // fails instead of a single large `tick N` skipping over it. Harmless
        // when the target step resolves synchronously — the loop exits above
        // before this ever runs.
        await page.evaluate(() => (window as unknown as {
          __gameConsole: (c: string) => unknown;
        }).__gameConsole('tick 1'));
        await new Promise(r => setTimeout(r, 200));
      }
      break;
    }
    case 'letTimePass': {
      await page.evaluate((n: number) => (window as unknown as {
        __gameConsole: (c: string) => unknown;
      }).__gameConsole(`tick ${n}`), action.ticks);
      break;
    }
  }
  await new Promise(r => setTimeout(r, SETTLE_MS));
}

/** Check a beat's goal, throwing PlaytestFailure with a diagnosis when unmet. */
export async function checkGoal(
  page: Page,
  goal: PlaytestGoal,
  before: Record<string, unknown>,
): Promise<void> {
  if (goal.tutorialStep !== undefined) {
    const tut = await tutorialState(page);
    if (tut.stepId !== goal.tutorialStep) {
      throw new PlaytestFailure(
        `tutorial should be on "${goal.tutorialStep}" but is on "${tut.stepId}" (${tut.title})`,
        describeAvailable(await probe(page)),
      );
    }
  }

  if (goal.increased) {
    const after = await gameState(page);
    for (const field of goal.increased) {
      const wasRaw = before[field];
      const nowRaw = after[field];
      const was = typeof wasRaw === 'number' ? wasRaw : 0;
      const now = typeof nowRaw === 'number' ? nowRaw : 0;
      if (!(now > was)) {
        throw new PlaytestFailure(
          `${field} should have increased but went ${was} → ${now}`,
          describeAvailable(await probe(page)),
        );
      }
    }
  }

  if (goal.equals) {
    const after = await gameState(page);
    for (const [field, expected] of Object.entries(goal.equals)) {
      if (after[field] !== expected) {
        throw new PlaytestFailure(
          `${field} should be ${JSON.stringify(expected)} but is ${JSON.stringify(after[field])}`,
          describeAvailable(await probe(page)),
        );
      }
    }
  }

  if (goal.usable) {
    await requireUsable(page, goal.usable, DEFAULT_TIMEOUT_MS);
  }

  if (goal.blocked) {
    const reason = await blockedReason(page, goal.blocked);
    if (reason === null) {
      throw new PlaytestFailure(
        `control "${goal.blocked}" is reachable but should not be`,
        describeAvailable(await probe(page)),
      );
    }
    if (reason === 'absent') {
      // Absent technically satisfies "not reachable", but it is far more often
      // a stale selector — which would make this assertion pass forever while
      // proving nothing.
      throw new PlaytestFailure(
        `control "${goal.blocked}" is not in the DOM, so "blocked" proves nothing — fix the selector`,
        describeAvailable(await probe(page)),
      );
    }
  }
}
