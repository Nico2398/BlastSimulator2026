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
 * Geometry of the open tile picker, for coordinate-space clicks.
 *
 * Polls until a picker is visible: a panel opens its picker on the click that
 * precedes this action, and waiting on the Confirm button instead is wrong —
 * Confirm starts disabled in point mode and only enables once a tile is picked.
 */
async function pickerGeometry(page: Page): Promise<{ x: number; y: number; w: number; h: number; sizeX: number; sizeZ: number }> {
  const read = () => page.evaluate(() => {
    const overlay = Array.from(document.querySelectorAll('.bs-tile-select-overlay'))
      .find(o => getComputedStyle(o as HTMLElement).display !== 'none');
    if (!overlay) return null;
    const canvas = overlay.querySelector('.bs-tile-select-canvas') as HTMLCanvasElement | null;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    // The picker lays worldSize tiles across the canvas, so map through the real
    // world dimensions rather than a terrain bounding box that blasting changes.
    const state = (window as unknown as { __gameState: () => Record<string, unknown> | null }).__gameState();
    return {
      x: r.x, y: r.y, w: r.width, h: r.height,
      sizeX: (state?.worldSizeX as number | null) ?? 24,
      sizeZ: (state?.worldSizeZ as number | null) ?? 24,
    };
  });

  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  for (;;) {
    const geo = await read();
    if (geo) return geo;
    if (Date.now() > deadline) break;
    await new Promise(r => setTimeout(r, 150));
  }
  throw new PlaytestFailure('no tile picker is open', describeAvailable(await probe(page)));
}

function tileToPoint(geo: Awaited<ReturnType<typeof pickerGeometry>>, x: number, z: number): { px: number; py: number } {
  const tileW = geo.w / geo.sizeX;
  const tileH = geo.h / geo.sizeZ;
  return {
    px: geo.x + (x + 0.5) * tileW,
    py: geo.y + (z + 0.5) * tileH,
  };
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
      const geo = await pickerGeometry(page);
      const { px, py } = tileToPoint(geo, action.x, action.z);
      await page.mouse.click(px, py);
      break;
    }
    case 'dragTiles': {
      const geo = await pickerGeometry(page);
      const from = tileToPoint(geo, action.x1, action.z1);
      const to = tileToPoint(geo, action.x2, action.z2);
      await page.mouse.move(from.px, from.py);
      await page.mouse.down();
      await page.mouse.move(to.px, to.py, { steps: 10 });
      await page.mouse.up();
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
