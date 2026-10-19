// BlastSimulator2026 — UI stylesheet injection
// Injects a <style> block at runtime so all UI components share consistent styling.

import { GUIDED_CLASS, ALLOWED_CLASS } from './tutorialGuide.js';
import { RAILED_CONTROL_SELECTOR } from './tutorialActivationGuard.js';
import { INSPECTOR_LEFT_PX, INSPECTOR_TOP_PX, INSPECTOR_BOTTOM_PX } from './panels/inspector/inspectorLayout.js';

/** Rail rule selector list, derived from the shared constant so the keyboard guard and CSS cannot drift. */
const RAIL_RULE_SELECTORS = RAILED_CONTROL_SELECTOR.split(',')
  .map(part => `body.${GUIDED_CLASS} ${part.trim()}:not(.${ALLOWED_CLASS})`)
  .join(',\n');

const CSS = `
/* Everything the bsx surfaces style inline or through tokens.ts lives there. This
   sheet keeps only what cannot: click-through layering, selector hooks the
   tutorial and scenarios ride on, the tutorial card, and the tutorial rails. */

/* #bs-ui-root is click-through; its direct children opt back in. Zero specificity so
   any pointer-events:none on a child (class or inline) still wins. */
:where(#bs-ui-root) > :where(*) { pointer-events: auto; }

/* ─── Alert pip pulse ───
   TopBar's alert pips apply .bs-event-badge for tutorial-selector compatibility
   and inline-style everything else; the pulse keyframe is also used inline by
   TopBar for every critical-tone pip. */
.bs-event-badge {
  cursor: pointer;
  animation: bs-pulse 1.2s ease infinite;
  white-space: nowrap;
  pointer-events: all;
}
@keyframes bs-pulse {
  0%,100% { opacity: 1; } 50% { opacity: 0.55; }
}

/* ─── Confirm / Blast execute overlay ─── */
.bs-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  /* Base tier for every .bs-confirm-overlay user (ConfirmModal, EventModal,
     BlastReportModal, PreflightModal, SavesModal) — a literal, not the
     --bsx-z-modal token: that token is reserved for the one case that has
     to beat the menu tier (ConfirmModal's own inline override, below), and
     routing every user of this class through it by mistake once put
     BlastReportModal's routine post-blast popup ABOVE an already-open
     SavesModal, blocking clicks on save slots underneath it (CI:
     save-load-visual). Components needing a higher tier than this
     (SavesModal already did, for beating the main menu) override z-index
     inline on their own overlay element instead of raising this shared rule. */
  z-index: 600;
  pointer-events: all;
}

/* ─── Event dialog (above everything) ─── */
#bs-event-dialog {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.7);
  /* var(), not the literal 600: the menu tier's Settings sits above that
     tier. An event and a confirm dialog never compete for the same pixels
     (the event's own full-screen overlay blocks the clicks that would raise
     a confirm), so sharing the tier is safe. */
  z-index: var(--bsx-z-modal);
  pointer-events: all;
}

/* ─── Permit approval letter (#1926) ───
   Stamp slams in with CSS only; reduced-motion shows it already placed. */
.bs-permit-approval-stamp {
  position: absolute;
  top: 70px;
  right: 22px;
  padding: 4px 12px;
  border: 3px solid var(--bsx-critical-text);
  border-radius: 4px;
  color: var(--bsx-critical-text);
  font: 900 22px/1 var(--bsx-font-ui);
  letter-spacing: .12em;
  transform: rotate(-12deg);
  pointer-events: none;
  animation: bs-permit-stamp .5s cubic-bezier(.2,1.4,.4,1) .25s both;
}
@keyframes bs-permit-stamp {
  0% { opacity: 0; transform: rotate(-12deg) scale(3); }
  100% { opacity: .9; transform: rotate(-12deg) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .bs-permit-approval-stamp { animation: none; opacity: .9; }
}

/* ─── Tutorial coach mark (redesign P10) ───
   Docked bottom-centre, never modal: the wrapper lets clicks through so the
   player can actually use the control the step is pointing at, and it sits
   below the event dialog (z 600) so the two never fight for the same pixels.
   Kept bottom-docked deliberately (spec §6.17) even though the design comp's
   coach card floats centred in the scene's free area — the comp's own text
   for this component says "never covering the highlighted control", which
   the existing bottom dock already guarantees and a scene-centred card would
   have to re-derive per step. */
.bs-tutorial-overlay {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  display: flex;
  justify-content: center;
  padding: 0 150px 18px;
  z-index: 500;
  pointer-events: none;
}
.bs-tutorial-box {
  background: var(--bsx-panel);
  border: 1px solid rgba(255,176,46,.4);
  border-radius: 8px;
  width: 100%;
  max-width: 520px;
  pointer-events: all;
  box-shadow: 0 16px 44px rgba(0,0,0,.6);
  overflow: hidden;
  color: var(--bsx-text-primary);
}
/* ─── Placement parameter strip (redesign P3) ───
   Bottom-docked like the tutorial coach card above, so a step that
   arms the placement tool needs the strip pushed clear of the card instead
   of sitting behind it — same screen edge, same z-stack region. */
#bs-param-strip { bottom: 18px; }
body.bs-tutorial-card #bs-param-strip { bottom: var(--bsx-tutorial-card-clearance, 210px); }
/* ─── Entity inspector (6.18) ───
   Docked right of the left column, below the modifier chips. Height follows
   content up to the band above the bottom-centre dock; the coach card lifts
   that bottom edge by the same clearance the parameter strip uses. */
#bs-inspector {
  --bs-inspector-bottom: ${INSPECTOR_BOTTOM_PX}px;
  position: fixed;
  left: ${INSPECTOR_LEFT_PX}px;
  top: ${INSPECTOR_TOP_PX}px;
  z-index: var(--bsx-z-panel);
  max-height: calc(100vh - ${INSPECTOR_TOP_PX}px - var(--bs-inspector-bottom));
}
body.bs-tutorial-card #bs-inspector { --bs-inspector-bottom: var(--bsx-tutorial-card-clearance, 210px); }
/* While a placement tool owns the canvas (e.g. the inspector's Move pick) the
   body sections fold away: header, status and the action row stay, so the tall
   vehicle sections never cover the tiles the player is told to click. */
body.bs-placement-armed #bs-inspector [data-scroll-key="inspector-body"] { display: none !important; }
/* The coach card's title sits inline with the CLOCK HELD chip and step counter
   instead of owning a bordered header row. */
.bs-tutorial-box .bs-panel-title {
  font: 700 13px/1 var(--bsx-font-ui);
  letter-spacing: .02em;
  text-transform: none;
  color: var(--bsx-text-primary);
  border-bottom: 0;
  margin-bottom: 0;
  padding-bottom: 0;
}
.bs-tutorial-box .bs-panel-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--bsx-text-secondary);
  margin: 0;
}
.bs-tutorial-progress {
  margin-left: auto;
  font: 500 10px/1 var(--bsx-font-mono);
  color: var(--bsx-text-micro);
  white-space: nowrap;
}
.bs-tutorial-progress-track {
  background: #242c36;
  height: 3px;
  overflow: hidden;
}
.bs-tutorial-progress-fill {
  height: 100%;
  background: var(--bsx-amber);
  transition: width 0.3s linear;
}
.bs-tutorial-commands-label {
  font-size: 9px;
  color: var(--bsx-text-micro);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.bs-tutorial-commands {
  font-family: var(--bsx-font-mono);
  font-size: 11px;
  color: var(--bsx-text-tinted);
  background: var(--bsx-well);
  border-radius: 4px;
  padding: 4px 8px;
  word-break: break-word;
}

/* ─── Guided tutorial rails ───
   While the tutorial is up, only the control it is pointing at responds.

   Deliberately unscoped: every control on the page, not just the ones inside a
   panel. "Return to Map" is a fixed-position button owned by the main menu and
   sits outside the panel tree — leaving it live let a player walk out of the
   tutorial mid-step and lose it, which is the whole reason these rails exist.
   Written as "not marked allowed" so a control rendered between two passes of
   the guide is inert from its first frame rather than briefly live.
   The coach card's one button (Exit tutorial, #1332) and the Settings session
   controls are exempted by tutorialRails.ts's permanently-allowed list, which
   marks them allowed; there is no Skip and no Next.
   The selector list is RAILED_CONTROL_SELECTOR from tutorialActivationGuard.ts, which also
   closes the keyboard path the pointer-events rule cannot. */
${RAIL_RULE_SELECTORS} {
  pointer-events: none;
  opacity: 0.4;
  filter: saturate(0.3);
}
.bs-tutorial-exit {
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid var(--bsx-hairline);
  border-radius: 3px;
  background: transparent;
  color: var(--bsx-text-muted);
  font: 600 10px/1.4 var(--bsx-font-ui);
  cursor: pointer;
}
.bs-tutorial-exit:hover {
  color: var(--bsx-text);
  border-color: var(--bsx-text-muted);
}
.bs-tutorial-stage {
  font: 600 11px/1.4 var(--bsx-font-ui);
}
/* HUD modifier chips (#1414) float over the 3D scene, so the warn tint alone
   washes out on light terrain: opaque panel backing under the tint, 11px text. */
.bsx-chip.bs-modifier-chip {
  padding: 5px 10px;
  font: 700 11px/1 var(--bsx-font-ui);
  letter-spacing: .04em;
  background: linear-gradient(rgba(255,176,46,.18), rgba(255,176,46,.18)), var(--bsx-panel);
  border: 1px solid rgba(255,176,46,.45);
}
/* Shared pill-chip shape for the title-row status chips (CLOCK HELD, IN
   PROGRESS). Modifiers below carry only the color that distinguishes them. */
.bs-tutorial-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 3px;
  font: 700 10px/1.4 var(--bsx-font-ui);
  letter-spacing: .04em;
}
/* CLOCK HELD chip, inline with the title. */
.bs-tutorial-paused {
  background: rgba(255,176,46,.16);
  color: var(--bsx-amber);
}
/* IN PROGRESS chip (#1014) — an issued order's work is now the simulation's,
   sibling of .bs-tutorial-paused. Blue (--bsx-info), not amber: the two chips
   can show at once (an order can be spent while the clock is still held on a
   later stage), and a shared color would read as one state. */
.bs-tutorial-waiting {
  background: rgba(85,168,255,.16);
  color: var(--bsx-info);
}
.bs-tutorial-goal {
  background: rgba(79,199,107,.16);
  color: var(--bsx-positive);
}
.bs-tutorial-stage-line {
  color: var(--bsx-amber);
}
/* Stage line while its issued order is spent and waiting on the simulation (#1014). */
.bs-tutorial-stage-line--waiting {
  color: var(--bsx-info-text);
}

/* ─── Reduced motion (P10): pip pulse → static ───
   bs-pulse only animates opacity — no transform — so on its own it would be
   left running under the "keep opacity" rule. It is special-cased anyway
   because the spec calls it out by name ("pip pulse → static"): a periodic
   flash reads as motion to a vestibular-sensitive player even without
   translate/scale. Freezing at the animation's natural end (opacity 1, its
   0%/100% value) would render identically to "no alert" ever having played,
   so this holds the cycle's low point (opacity .55) instead — the frame
   that actually reads as "this is highlighted" — with no motion.
   Covers both the class-based use above (.bs-event-badge, the kind:'event'
   pip) and the same bs-pulse keyframe applied inline by TopBar.ts on every
   other critical-tone alert pip (ecology/bankruptcy/crew), which carries no
   class to select — matched below by the inline style text itself, since an
   !important author rule overrides a non-important inline declaration
   regardless of selector.
   Nothing else in this file needs an entry: every other transition here
   (button/input/build/survey hover, the *-bar-fill widths) is background,
   border-color, color or width, never transform. The tutorial keyframes are
   deliberately left alone — that block is being reworked by concurrent work
   on the tutorial system. */
@media (prefers-reduced-motion: reduce) {
  .bs-event-badge,
  #bs-hud-top button[style*="bs-pulse"] {
    animation: none !important;
    opacity: .55 !important;
  }
}
`;

let injected = false;

/** Inject the shared UI stylesheet into the document once. */
export function injectStyles(): void {
  if (injected) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  injected = true;
}
