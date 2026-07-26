// BlastSimulator2026 — UI action probe
// Answers one question for an automated player: "what can I actually do right
// now, and if I can't do something, why not?"
//
// A test that guesses selectors and clicks them cannot tell the difference
// between "the button worked" and "the button was disabled and my click did
// nothing". This enumerates the real, reachable controls so a harness can pick
// from them and report a precise reason when a step is impossible.

/** Why a control cannot be used, or null when it can. */
export type BlockedReason =
  | 'disabled'
  | 'hidden'
  | 'zero-size'
  | 'covered'
  | 'pointer-events-none';

export interface UiAction {
  /** A selector that uniquely addresses this control. */
  selector: string;
  /** Visible label, trimmed. */
  label: string;
  /** Tag name, lowercased. */
  tag: string;
  /** Panel or region the control belongs to, for grouping. */
  region: string;
  /** True when a real player click would reach the handler. */
  usable: boolean;
  /** Populated when `usable` is false. */
  blockedBy: BlockedReason | null;
  /** Nearby explanatory text — a panel status line, when present. */
  hint: string | null;
}

/** Containers whose controls are worth reporting, with a readable region name. */
const REGIONS: Array<[string, string]> = [
  ['#bs-hud-top', 'hud'],
  ['#bs-toolbar', 'toolbar'],
  ['#bs-blast-panel', 'blast'],
  ['#bs-contract-panel', 'contracts'],
  ['#bs-build-panel', 'build'],
  ['#bs-vehicle-panel', 'vehicles'],
  ['#bs-employee-panel', 'crew'],
  ['#bs-survey-panel', 'survey'],
  ['#bs-settings-panel', 'settings'],
  ['#bs-event-dialog', 'event'],
  // Blast confirmation and similar one-off modals. Excluded from the event
  // dialog, which shares the class. A modal the probe cannot see is exactly what
  // leaves a harness reporting "everything is covered" with no way forward.
  ['.bs-confirm-overlay:not(#bs-event-dialog)', 'confirm'],
  ['.bs-tile-select-overlay', 'tile-picker'],
  ['.bs-tutorial-box', 'tutorial'],
  ['#bs-main-menu', 'menu'],
];

/**
 * Classes that reflect transient state rather than identity. Including them in a
 * generated selector makes it change as the tutorial highlight or the active
 * panel moves, so a harness that stored the selector would lose the control.
 */
const TRANSIENT_CLASSES = new Set([
  'bs-tutorial-highlight',
  'active',
  'selected',
]);

/** Status/help text per region, used to explain a disabled control. */
const REGION_HINTS: Record<string, string> = {
  survey: '.bs-survey-status',
  blast: '.bs-blast-status',
  build: '#bs-build-panel div[style*="min-height"]',
  'tile-picker': '.bs-tile-select-info',
};

function isHidden(el: Element): boolean {
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return true;
  // An ancestor may be the thing that is hidden.
  let node: Element | null = el.parentElement;
  while (node) {
    const s = getComputedStyle(node);
    if (s.display === 'none' || s.visibility === 'hidden') return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Whether a real click at the control's centre would land on it. Catches the
 * class of bug where a full-screen overlay silently swallows every click.
 */
function coveredBy(el: Element): Element | null {
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  if (!hit) return null;
  if (hit === el || el.contains(hit) || hit.contains(el)) return null;
  return hit;
}

/** Build a selector that addresses this element specifically. */
function selectorFor(el: Element, regionSelector: string, index: number): string {
  if (el.id) return `#${el.id}`;
  const data = (el as HTMLElement).dataset;
  for (const key of ['panel', 'role', 'action', 'method', 'buildType', 'vtype']) {
    const value = data[key];
    if (value !== undefined) {
      const attr = key === 'buildType' ? 'build-type' : key;
      return `${regionSelector} [data-${attr}="${value}"]`;
    }
  }
  const cls = Array.from(el.classList)
    .filter(c => c.startsWith('bs-') && !TRANSIENT_CLASSES.has(c))
    .join('.');
  if (cls) return `${regionSelector} .${cls}`;
  return `${regionSelector} ${el.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
}

/**
 * Why the control at `selector` cannot be used, or null when it can. Returns
 * 'hidden' when nothing matches, so callers get one uniform answer.
 */
export function probeSelector(selector: string): BlockedReason | null | 'absent' {
  const el = document.querySelector(selector) as (HTMLElement & { disabled?: boolean }) | null;
  if (!el) return 'absent';
  const rect = el.getBoundingClientRect();
  if (isHidden(el)) return 'hidden';
  if (rect.width === 0 || rect.height === 0) return 'zero-size';
  if (el.disabled === true) return 'disabled';
  if (getComputedStyle(el).pointerEvents === 'none') return 'pointer-events-none';
  if (coveredBy(el)) return 'covered';
  return null;
}

/**
 * Enumerate the interactive controls currently on screen.
 *
 * @returns One entry per control, usable ones first.
 */
export function probeUiActions(): UiAction[] {
  const actions: UiAction[] = [];

  for (const [regionSelector, region] of REGIONS) {
    const containers = Array.from(document.querySelectorAll(regionSelector));
    for (const container of containers) {
      if (isHidden(container)) continue;

      const hintSelector = REGION_HINTS[region];
      const hintEl = hintSelector ? container.querySelector(hintSelector) : null;
      const hint = hintEl?.textContent?.trim() || null;

      const controls = container.querySelectorAll<HTMLElement>('button, select, input, [role="button"]');
      controls.forEach((el: HTMLElement, index: number) => {
        const html = el as HTMLElement & { disabled?: boolean };
        const rect = html.getBoundingClientRect();

        let blockedBy: BlockedReason | null = null;
        if (isHidden(html)) blockedBy = 'hidden';
        else if (rect.width === 0 || rect.height === 0) blockedBy = 'zero-size';
        else if (html.disabled === true) blockedBy = 'disabled';
        else if (getComputedStyle(html).pointerEvents === 'none') blockedBy = 'pointer-events-none';
        else if (coveredBy(html)) blockedBy = 'covered';

        actions.push({
          selector: selectorFor(html, regionSelector, index),
          label: (html.textContent ?? '').trim().slice(0, 60)
            || (html as HTMLInputElement).value?.slice(0, 60)
            || html.tagName.toLowerCase(),
          tag: html.tagName.toLowerCase(),
          region,
          usable: blockedBy === null,
          blockedBy,
          hint: blockedBy === null ? null : hint,
        });
      });
    }
  }

  return actions.sort((a, b) => Number(b.usable) - Number(a.usable));
}
