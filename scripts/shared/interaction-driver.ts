/**
 * BlastSimulator2026 — Interaction driver
 *
 * Executes player actions against a live page and reports, for every failure,
 * which control blocked and why. No console access is exposed to actions.
 *
 * @module shared/interaction-driver
 */

import type { Page } from 'puppeteer';
import type { PlayerAction, InteractionGoal } from './interaction-types.js';
import { awaitPlacementArmed, worldToScreenPoint } from './tile-picker.js';

/** Mirror of src/ui/uiActionProbe.ts UiAction, kept structural to avoid a src import. */
interface ProbedAction {
  selector: string;
  label: string;
  tag: string;
  region: string;
  usable: boolean;
  blockedBy: string | null;
  hint: string | null;
}

interface TutorialSnapshot {
  active: boolean;
  stepIndex: number;
  stepId: string | null;
  title: string;
  total: number;
}

export class InteractionFailure extends Error {
  constructor(message: string, readonly diagnosis: string) {
    super(message);
    this.name = 'InteractionFailure';
  }
}

const DEFAULT_TIMEOUT_MS = 6000;

/**
 * How long `clickEntity` waits for an entity's *rendered* position to stop
 * moving before it aims at it.
 *
 * Since #535 a mesh's x/z is driven only by the per-frame tween:
 * `GameRenderer.syncFromContext` sets `y` and leaves x/z to
 * `VehicleMesh.update`/`CharacterMesh.update`, where it used to snap both on
 * every sync. `SceneManager.start` caps `dt` at 100ms against
 * `MOVE_TWEEN_DURATION_S` (1s), so a mesh needs ~10 rAF frames to reach the
 * position `GameState` already reports — and those frames fire between the
 * harness's CDP calls, not under its control. A position read before the
 * click can therefore be stale by the time the click lands, the ray misses
 * the entity, nothing is selected, and the failure surfaces as an unrelated
 * control never becoming usable (#530: `nav-ramp-routing-visual` failing on
 * `move_here` "present but hidden", reproducible in CI, never locally).
 *
 * Two consecutive reads under this epsilon mean the tween has converged (or
 * is not running at all), so the position is safe to aim at. Costs two cheap
 * `evaluate` round trips when the mesh is already settled, which is the norm.
 */
const ENTITY_SETTLE_EPSILON = 0.01;
const ENTITY_SETTLE_INTERVAL_MS = 25;
const ENTITY_SETTLE_MAX_POLLS = 40;
/** Re-aims allowed when the mesh moves while the camera is being aimed at it. */
const ENTITY_AIM_ATTEMPTS = 3;

/**
 * Wait for the render loop's rAF callback to run twice. That callback drives
 * `uiManager.update` once per frame regardless of whether drawing itself is
 * suspended (#475), so two passes is the actual event a post-action settle is
 * waiting on — not a guess at how long that takes. Measured at ~33ms with a
 * level loaded (one frame's margin over the ~17ms a single pass costs),
 * replacing a flat 300-350ms sleep that used to pay for the same wait as
 * wall-clock time whether or not the frame had already run.
 *
 * Also waits out a placement confirm's 220ms flash window (phase
 * 'confirmed', `PlacementController.confirm`/`CONFIRM_FLASH_MS`) when one is
 * in flight: `isArmed()` stays true for that whole window before its
 * `setTimeout`-scheduled `disarm()` fires, and arming a *different* build
 * type while it is still true finds the tool "already armed" and cancels
 * instead of arming (`BuildMenu.armBuildingPointTool`'s own guard) — a
 * wall-clock timer no number of animation frames can outrun. `currentPhase`
 * is what distinguishes this from a freshly-armed tool correctly staying
 * armed (which must never be waited out here) — both read `isArmed() ===
 * true` identically, only the phase tells them apart. A confirm the harness
 * never sees this frame (nothing armed at all) skips the poll immediately.
 */
export async function waitForUiUpdate(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>(res => {
    requestAnimationFrame(() => requestAnimationFrame(() => res()));
  }));
  // Node-side poll loop, matching awaitPlacementArmed (tile-picker.ts) —
  // a *browser*-side recursive poll would need a named inner function to
  // reschedule itself, and esbuild's keepNames helper (`__name`) it would
  // inject is module-scoped in the harness bundle, unreachable from a
  // callback's stringified, sandboxed evaluation in the page.
  for (;;) {
    const phase = await page.evaluate(() => (window as unknown as {
      __placement?: { currentPhase?: () => string };
    }).__placement?.currentPhase?.() ?? null);
    if (phase !== 'confirmed') return;
    await new Promise(r => setTimeout(r, 20));
  }
}

async function probe(page: Page): Promise<ProbedAction[]> {
  return page.evaluate(() => (window as unknown as {
    __uiActions: () => ProbedAction[];
  }).__uiActions()) as Promise<ProbedAction[]>;
}

async function tutorialState(page: Page): Promise<TutorialSnapshot> {
  return page.evaluate(() => (window as unknown as {
    __tutorialState: () => TutorialSnapshot;
  }).__tutorialState()) as Promise<TutorialSnapshot>;
}

/**
 * Flip the page's own rAF tick-issuing loop on or off. Used only to bracket a
 * poll-wait that needs the real, isPaused-gated clock instead of scenarioMode's
 * deterministic tick-command-only clock.
 */
async function setAutoTick(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate((e: boolean) => (window as unknown as {
    __setAutoTick: (enabled: boolean) => void;
  }).__setAutoTick(e), enabled);
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
function describeAvailable(actions: ProbedAction[]): string {
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
  return page.evaluate((sel: string) => {
    // Scroll into view before probing, exactly as page.click will before
    // clicking (interaction-executor.ts's clickSelector does the same, #481):
    // a row below a panel's fold has its centre over the game canvas until
    // scrolled, and probing that without scrolling first reads as covered-forever.
    document.querySelector(sel)?.scrollIntoView({ block: 'center', inline: 'nearest' });
    const probe = (window as unknown as {
      __probeSelector: (s: string) => string | null;
    }).__probeSelector;
    return probe(sel);
  }, selector) as Promise<string | null>;
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
  throw new InteractionFailure(
    `control "${selector}" never became usable: ${why}`,
    describeAvailable(actions),
  );
}

/**
 * Wait for the P3 placement tool to be armed, with a click-diagnosis-shaped
 * failure on miss. The polling itself lives in `tile-picker.ts` so the
 * scenario channel waits on the same condition; only the failure report
 * differs.
 */
async function armedPlacement(page: Page): Promise<void> {
  try {
    await awaitPlacementArmed(page, DEFAULT_TIMEOUT_MS);
  } catch {
    throw new InteractionFailure('no placement tool is armed', describeAvailable(await probe(page)));
  }
}

/**
 * Fail unless the game canvas is the topmost element at a screen point.
 *
 * A tile click is only a player action if the player's cursor can actually
 * reach the terrain there. The docked placement strip and the tutorial card
 * both float over the lower third of the scene, and a click that lands on one
 * of them does nothing at all — which is exactly what was reported as "the
 * highlighted square does not respond to clicks" (#489). The harness used to
 * miss it because its definitions moved the camera first; now an obscured tile
 * fails here and names the element that caught the click.
 */
async function requireCanvasAt(page: Page, px: number, py: number, tile: string): Promise<void> {
  const blocker = await page.evaluate(({ x, y }: { x: number; y: number }) => {
    const top = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!top) return 'nothing (the point is off the viewport)';
    if (top.id === 'game-canvas') return null;
    const id = top.id ? `#${top.id}` : '';
    const cls = typeof top.className === 'string' && top.className ? `.${top.className.trim().split(/\s+/).join('.')}` : '';
    return `<${top.tagName.toLowerCase()}${id}${cls}>`;
  }, { x: px, y: py });
  if (blocker === null) return;
  throw new InteractionFailure(
    `tile ${tile} cannot be clicked — ${blocker} covers it at (${Math.round(px)}, ${Math.round(py)})`,
    'A tile the player is told to click must not sit under a docked panel, strip or card.'
    + ' Move the UI, or frame the camera on the target when the tool arms.',
  );
}

/** Run one player action, throwing InteractionFailure with a diagnosis on failure. */
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
        throw new InteractionFailure(
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
      // point, not a console-equivalent shortcut — the whole point of a
      // `role: 'player'` step is that this has to be a click a player could
      // actually make.
      await armedPlacement(page);
      const { px, py } = await worldToScreenPoint(page, action.x, action.z);
      await requireCanvasAt(page, px, py, `(${action.x}, ${action.z})`);
      await page.mouse.click(px, py);
      break;
    }
    case 'dragTiles': {
      await armedPlacement(page);
      const from = await worldToScreenPoint(page, action.x1, action.z1);
      const to = await worldToScreenPoint(page, action.x2, action.z2);
      await requireCanvasAt(page, from.px, from.py, `(${action.x1}, ${action.z1})`);
      await requireCanvasAt(page, to.px, to.py, `(${action.x2}, ${action.z2})`);
      await page.mouse.move(from.px, from.py);
      await page.mouse.down();
      await page.mouse.move(to.px, to.py, { steps: 10 });
      await page.mouse.up();
      break;
    }
    case 'clickEntity': {
      // Arrow, not a named function: this body is stringified into the page,
      // and esbuild's keepNames wraps named functions in a `__name()` call
      // that does not exist in that context.
      const readPos = () => page.evaluate(({ kind, id }: { kind: string; id: number }) =>
        (window as unknown as {
          __entityWorldPosition: (k: string, i: number) => { x: number; z: number } | null;
        }).__entityWorldPosition(kind, id), { kind: action.kind, id: action.id });

      let pos = await readPos();
      if (!pos) {
        throw new InteractionFailure(
          `no ${action.kind} #${action.id} is on the scene to click`,
          describeAvailable(await probe(page)),
        );
      }

      // Aim at where the mesh has come to rest, not where it happened to be
      // mid-glide — see ENTITY_SETTLE_EPSILON for why a moving mesh makes the
      // click miss entirely. Forcing a frame does not help: `__renderFrame`
      // calls `drawFrame` only, never the loop's `onUpdate`, so it refreshes
      // camera matrices without advancing the tween.
      for (let i = 0; i < ENTITY_SETTLE_MAX_POLLS; i++) {
        await new Promise(r => setTimeout(r, ENTITY_SETTLE_INTERVAL_MS));
        const next = await readPos();
        if (!next) break;
        const settled = Math.hypot(next.x - pos.x, next.z - pos.z) < ENTITY_SETTLE_EPSILON;
        pos = next;
        if (settled) break;
      }

      const aimAt = (at: { x: number; z: number }) =>
        page.evaluate(({ x, z, distance }: { x: number; z: number; distance: number }) => {
          (window as unknown as { __cameraFocus: (x: number, z: number, d: number) => void }).__cameraFocus(x, z, distance);
          // Interaction mode suspends the draw loop (#475) — force a frame so
          // the new camera position and the scene's entity transforms are
          // current before the click below raycasts.
          (window as unknown as { __renderFrame?: () => void }).__renderFrame?.();
        }, { x: at.x, z: at.z, distance: action.distance ?? 15 });

      // Settling above samples over time, which a throttled rAF can defeat:
      // a background page in batch mode advances the tween in bursts, so two
      // reads an interval apart can both land in a still gap and read as
      // settled while the mesh is still short of its target. The forced frame
      // is also the most expensive step here (a real draw, seconds without a
      // GPU) and frames land during it. So confirm the mesh is still where we
      // aimed, and re-aim at where it actually got to if not — never click a
      // point it has already left.
      let reAims = 0;
      for (;;) {
        await aimAt(pos);
        const after = await readPos();
        if (!after) break;
        if (Math.hypot(after.x - pos.x, after.z - pos.z) < ENTITY_SETTLE_EPSILON) break;
        pos = after;
        if (++reAims >= ENTITY_AIM_ATTEMPTS) {
          await aimAt(pos);
          break;
        }
      }
      if (reAims > 0) {
        // Surfaces the glide in the run log, so a future miss is diagnosable
        // from CI output instead of needing a local repro that may not exist.
        console.log(`  clickEntity: ${action.kind} #${action.id} still gliding — re-aimed ${reAims}x`);
      }
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
    case 'focusTile': {
      await page.evaluate(({ x, z, distance }: { x: number; z: number; distance: number }) => {
        (window as unknown as { __cameraFocus: (x: number, z: number, d: number) => void }).__cameraFocus(x, z, distance);
        (window as unknown as { __renderFrame?: () => void }).__renderFrame?.();
      }, { x: action.x, z: action.z, distance: action.distance ?? 25 });
      break;
    }
    case 'awaitUsable': {
      await requireUsable(page, action.selector, action.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      break;
    }
    case 'awaitTutorialStep': {
      const wanted = Array.isArray(action.stepId) ? action.stepId : [action.stepId];
      const deadline = Date.now() + (action.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      // Drive the real rAF-driven, isPaused-gated clock for the duration of this
      // wait only — the same mechanism a real player's browser uses — so that
      // gates like decideClock's hold/unhold logic are genuinely exercised
      // instead of bypassed by a scripted tick. Always restored on the way out
      // so every other scripted action keeps the deterministic scenarioMode clock.
      await setAutoTick(page, true);
      try {
        let seen: TutorialSnapshot | null = null;
        for (;;) {
          seen = await tutorialState(page);
          if (seen.stepId !== null && wanted.includes(seen.stepId)) break;
          if (Date.now() > deadline) {
            throw new InteractionFailure(
              `tutorial never reached ${wanted.map(s => `"${s}"`).join(' or ')}`
              + ` — it is on "${seen.stepId}" (${seen.title})`,
              describeAvailable(await probe(page)),
            );
          }
          await new Promise(r => setTimeout(r, 200));
        }
      } finally {
        await setAutoTick(page, false);
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
  await waitForUiUpdate(page);
}

/** Check a step's goal, throwing InteractionFailure with a diagnosis when unmet. */
export async function checkGoal(
  page: Page,
  goal: InteractionGoal,
  before: Record<string, unknown>,
  after?: Record<string, unknown>,
): Promise<void> {
  if (goal.tutorialStep !== undefined) {
    const tut = await tutorialState(page);
    if (tut.stepId !== goal.tutorialStep) {
      throw new InteractionFailure(
        `tutorial should be on "${goal.tutorialStep}" but is on "${tut.stepId}" (${tut.title})`,
        describeAvailable(await probe(page)),
      );
    }
  }

  // One fetch (or the caller's own already-current snapshot) serves all four
  // state-reading goal kinds below — up to four separate evaluates for a
  // step whose expect combines increased/decreased/equals/changedBy, on every
  // step of every scenario, for state that cannot have changed between them.
  if (goal.increased || goal.decreased || goal.equals || goal.changedBy) {
    const state = after ?? await gameState(page);

    if (goal.increased) {
      for (const field of goal.increased) {
        const wasRaw = before[field];
        const nowRaw = state[field];
        const was = typeof wasRaw === 'number' ? wasRaw : 0;
        const now = typeof nowRaw === 'number' ? nowRaw : 0;
        if (!(now > was)) {
          throw new InteractionFailure(
            `${field} should have increased but went ${was} → ${now}`,
            describeAvailable(await probe(page)),
          );
        }
      }
    }

    if (goal.decreased) {
      for (const field of goal.decreased) {
        const wasRaw = before[field];
        const nowRaw = state[field];
        const was = typeof wasRaw === 'number' ? wasRaw : 0;
        const now = typeof nowRaw === 'number' ? nowRaw : 0;
        if (!(now < was)) {
          throw new InteractionFailure(
            `${field} should have decreased but went ${was} → ${now}`,
            describeAvailable(await probe(page)),
          );
        }
      }
    }

    if (goal.equals) {
      for (const [field, expected] of Object.entries(goal.equals)) {
        if (state[field] !== expected) {
          throw new InteractionFailure(
            `${field} should be ${JSON.stringify(expected)} but is ${JSON.stringify(state[field])}`,
            describeAvailable(await probe(page)),
          );
        }
      }
    }

    if (goal.changedBy) {
      for (const [field, expectedDelta] of Object.entries(goal.changedBy)) {
        const wasRaw = before[field];
        const nowRaw = state[field];
        const was = typeof wasRaw === 'number' ? wasRaw : 0;
        const now = typeof nowRaw === 'number' ? nowRaw : 0;
        const actualDelta = now - was;
        if (actualDelta !== expectedDelta) {
          throw new InteractionFailure(
            `${field} should have changed by ${expectedDelta} but changed by ${actualDelta} (${was} → ${now})`,
            describeAvailable(await probe(page)),
          );
        }
      }
    }
  }

  if (goal.usable) {
    await requireUsable(page, goal.usable, DEFAULT_TIMEOUT_MS);
  }

  if (goal.blocked) {
    const reason = await blockedReason(page, goal.blocked);
    if (reason === null) {
      throw new InteractionFailure(
        `control "${goal.blocked}" is reachable but should not be`,
        describeAvailable(await probe(page)),
      );
    }
    if (reason === 'absent') {
      // Absent technically satisfies "not reachable", but it is far more often
      // a stale selector — which would make this assertion pass forever while
      // proving nothing.
      throw new InteractionFailure(
        `control "${goal.blocked}" is not in the DOM, so "blocked" proves nothing — fix the selector`,
        describeAvailable(await probe(page)),
      );
    }
  }

  if (goal.textEquals) {
    for (const [selector, expected] of Object.entries(goal.textEquals)) {
      const actual = await domProperty(page, selector, 'textContent');
      if (actual === undefined) {
        throw new InteractionFailure(
          `textEquals: selector "${selector}" not found in the DOM`,
          describeAvailable(await probe(page)),
        );
      }
      if (actual !== expected) {
        throw new InteractionFailure(
          `textEquals: "${selector}" should read ${JSON.stringify(expected)} but reads ${JSON.stringify(actual)}`,
          describeAvailable(await probe(page)),
        );
      }
    }
  }

  if (goal.titleEquals) {
    for (const [selector, expected] of Object.entries(goal.titleEquals)) {
      const actual = await domProperty(page, selector, 'title');
      if (actual === undefined) {
        throw new InteractionFailure(
          `titleEquals: selector "${selector}" not found in the DOM`,
          describeAvailable(await probe(page)),
        );
      }
      if (actual !== expected) {
        throw new InteractionFailure(
          `titleEquals: "${selector}".title should read ${JSON.stringify(expected)} but reads ${JSON.stringify(actual)}`,
          describeAvailable(await probe(page)),
        );
      }
    }
  }
}

/** Read a DOM element's `textContent`/`title`, or `undefined` when the selector matches nothing. */
async function domProperty(
  page: Page, selector: string, prop: 'textContent' | 'title',
): Promise<string | undefined> {
  return page.evaluate(
    ({ sel, p }: { sel: string; p: 'textContent' | 'title' }) => {
      const el = document.querySelector(sel);
      if (!el) return undefined;
      return (el as unknown as Record<string, string>)[p] ?? '';
    },
    { sel: selector, p: prop },
  ) as Promise<string | undefined>;
}
