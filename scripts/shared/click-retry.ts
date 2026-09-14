/**
 * BlastSimulator2026 — Click a selector, retrying a refusal that is a race
 *
 * The one place the interaction harness calls Puppeteer's `page.click()`.
 * A control the page's own probe just called usable can still be refused a
 * beat later — laid out late on a loaded runner (#1045, #1053), or rebuilt
 * by its panel between the probe and the click (`ChargeHoleList` replaces
 * every per-hole row on update: PR #1080, shard 5, twice). `inspectSelector`
 * re-resolves the selector after each refusal; when the fresh node reads as
 * attached, not inert, not disabled, visible and uncovered, the refusal was
 * the race and the click is retried. Anything else is a real block and is
 * reported by name, once. `tests/unit/lint/NoBareSelectorClick.test.ts`
 * holds every other `page.click` in `scripts/` to this path.
 *
 * @module shared/click-retry
 */

import type { Page } from 'puppeteer';

/**
 * Extra grace granted once, only when a clickSelector target is polling as
 * probe reason 'zero-size' at the moment CLICK_SELECTOR_DEFAULT_TIMEOUT_MS
 * expires — i.e. attached and otherwise unblocked, but not yet laid out.
 * Covers a heavy renderer/animation holding layout past the default budget
 * on a slow CI runner. Any other blocked reason still fails at the
 * unchanged default budget.
 */
export const CLICK_SELECTOR_ZERO_SIZE_GRACE_MS = 10000;

/**
 * Attempts `clickSelector` makes at the real `page.click()` call before
 * giving up, when each failed attempt reads back as transient — attached,
 * unblocked, and either no layout box yet (zero-size) or reading as fully
 * clickable with no reason at all for Puppeteer to have refused it. Distinct
 * from the poll loop's own `CLICK_SELECTOR_ZERO_SIZE_GRACE_MS`: that grace
 * covers the wait *before* this click; this retries the click itself,
 * because a control the probe just called usable can still fail Puppeteer's
 * own `click()` a beat later on a heavily loaded CI runner — the gap between
 * the last poll and the real click is exactly what the poll-side grace does
 * not reach (`sandbox-mode`'s report-close: zero-size at CI run 34690787172,
 * PR #1053 CI-fix; the same control's fully-laid-out-but-still-refused
 * variant at CI run 34720642781, #1045 CI-fix — same race, a beat later in
 * whatever CSS transition report-close's modal runs on open, past the point
 * the layout box itself has settled). Every other failure reason (vanished,
 * disabled, hidden, genuinely covered by another element, ...) still fails
 * on the very first attempt — those are real, permanent blocks, not a race
 * against a slow runner.
 */
export const CLICK_SELECTOR_ZERO_SIZE_CLICK_RETRIES = 3;

/**
 * Context passed into the zero-size diagnosis message. Present only when the
 * poll timed out on the zero-size reason specifically.
 */
export interface ZeroSizeDiagnosisContext {
  waitedMs: number;
  graceGranted: boolean;
}

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
export async function inspectSelector(page: Page, selector: string): Promise<UnclickableReport> {
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

/**
 * Turn an inspection into one line a human can act on.
 *
 * `neverAppeared` separates the two ways an absent element gets here, which
 * read identically in the report and mean opposite things: a control that was
 * there and went away mid-click is a race, while one the whole wait never saw
 * once is simply not rendered — the panel holding it was never opened, or the
 * row does not exist. Reporting the first for the second cost #929 a full CI
 * cycle chasing a re-render race that was really three scenario files clicking
 * into a Fleet panel nothing had opened.
 */
export function describeUnclickable(
  r: UnclickableReport,
  neverAppeared = false,
  zeroSizeContext?: ZeroSizeDiagnosisContext,
): string {
  const context = [
    r.matchCount !== undefined && r.matchCount > 1
      ? `selector is ambiguous (${r.matchCount} matches, first one used)`
      : '',
    r.tutorial !== undefined ? `tutorial on ${r.tutorial}` : '',
  ].filter(s => s !== '');
  const suffix = context.length > 0 ? ` [${context.join('; ')}]` : '';
  return `${describeReason(r, neverAppeared, zeroSizeContext)}${suffix}`;
}

/**
 * The primary reason, before context is appended.
 *
 * `zeroSizeContext` is present only from `clickSelector`'s own poll-timeout
 * path (not the separate post-click-attempt catch, which only fires once the
 * poll already reported the element usable) — it names how long the element
 * sat attached-but-unlaid-out, including any zero-size grace extension
 * (#1032), instead of the bare "zero size (0x0)" that gives no sense of
 * whether this was a genuine layout failure or a slow render caught mid-poll.
 */
function describeReason(
  r: UnclickableReport,
  neverAppeared = false,
  zeroSizeContext?: ZeroSizeDiagnosisContext,
): string {
  if (!r.found) {
    return neverAppeared
      ? 'element never appeared in the DOM — nothing renders it (a panel no step opened, or a row that does not exist)'
      : 'element vanished from the DOM between the wait and the click';
  }
  if (r.pointerEvents === 'none') {
    return 'element is inert (pointer-events: none) — a tutorial rail or overlay is blocking it, '
      + 'so no player could click it either';
  }
  if (r.disabled === true) return 'element is disabled';
  if (r.display === 'none' || r.visibility === 'hidden') {
    return `element is not visible (display: ${r.display}, visibility: ${r.visibility})`;
  }
  if (r.width === 0 || r.height === 0) {
    if (zeroSizeContext !== undefined) {
      return 'element is attached to the DOM and otherwise unblocked, but never gained a layout box '
        + `(stayed ${r.width}x${r.height}) after waiting ${zeroSizeContext.waitedMs}ms`
        + (zeroSizeContext.graceGranted
          ? ` (including a ${CLICK_SELECTOR_ZERO_SIZE_GRACE_MS}ms zero-size grace extension)`
          : '');
    }
    return `element has zero size (${r.width}x${r.height})`;
  }
  if (r.covering !== undefined) return `element is covered by ${r.covering}`;
  return 'element is present and looks clickable — the browser still refused it';
}

/**
 * Whether a click failure inspected as `r` looks like a race against a slow
 * runner rather than a genuine, permanent block — the same "attached, not
 * inert, not disabled, not hidden, not covered" shape `describeReason` falls
 * through on, whether the layout box is zero or the control reads as fully
 * clickable and Puppeteer's `click()` still refused it (#1045 CI-fix:
 * `sandbox-mode`'s report-close failed this way — present, correctly sized,
 * uncovered — a beat after the probe had already called it usable). Anything
 * that fails one of these checks is a real block a retry cannot fix.
 */
function isTransientClickFailure(r: UnclickableReport): boolean {
  return r.found === true
    && r.pointerEvents !== 'none'
    && r.disabled !== true
    && r.display !== 'none'
    && r.visibility !== 'hidden'
    && r.covering === undefined;
}

/**
 * Click `selector`, retrying a refusal that looks like a race rather than a
 * block: Puppeteer's own "Node is either not clickable or not an Element" a
 * beat after the probe called it usable (#1045), and "Node is detached from
 * document" when a panel rebuilt the control between the probe and the click
 * — `ChargeHoleList` replaces every per-hole row on update, so a click on
 * `[data-hole="H1"] [data-action="charge-hole"]` issued right after the
 * amount changed lands on a node the next frame threw away (PR #1080, shard
 * 5, twice). `inspectSelector` re-resolves the selector to the fresh node:
 * found, visible, uncovered, so the refusal reads as transient and the retry
 * clicks the replacement. Anything that fails one of those checks is a real
 * block and is reported by name, prefixed with `actionName` so the failure
 * names the step's own action. Every selector click the harness makes goes
 * through here: the executor's `clickSelector`, `setStepper`,
 * `clickIfPresent` and `waitUsableAndClick` callers, and the driver's
 * `click`/`clickLabel` player actions.
 */
export async function clickWithTransientRetry(
  page: Page,
  selector: string,
  btn: 'left' | 'right' | 'middle',
  actionName = 'clickSelector',
): Promise<void> {
  for (let clickAttempt = 1; ; clickAttempt++) {
    try {
      await page.click(selector, { button: btn });
      return;
    } catch (err) {
      // Puppeteer's own message ("Node is either not clickable or not an
      // Element") names nothing, so a failure reports only that
      // *something* on the page could not be clicked. Name the selector
      // and say why it was refused — inert almost always means a
      // `pointer-events: none` rail, which is a real player-facing block,
      // not a test flake.
      const inspected = await inspectSelector(page, selector);
      if (isTransientClickFailure(inspected) && clickAttempt < CLICK_SELECTOR_ZERO_SIZE_CLICK_RETRIES) {
        await new Promise((r) => setTimeout(r, 150));
        continue;
      }
      throw new Error(
        `${actionName} "${selector}" failed: ${describeUnclickable(inspected)}`,
        { cause: err },
      );
    }
  }
}
