// BlastSimulator2026 — UI stylesheet injection
// Injects a <style> block at runtime so all UI components share consistent styling.

const CSS = `
/* ─── Reset & base overlay ─── */
.bs-ui {
  position: fixed;
  pointer-events: none;
  font-family: 'Segoe UI', system-ui, Arial, sans-serif;
  font-size: 13px;
  color: #e8e0d0;
  user-select: none;
  z-index: 100;
}
.bs-ui * { box-sizing: border-box; }

/* ─── Panel base ─── */
.bs-panel {
  background: rgba(8, 6, 3, 0.88);
  border: 1px solid rgba(200, 160, 60, 0.3);
  border-radius: 8px;
  padding: 10px 12px;
  pointer-events: all;
  backdrop-filter: blur(4px);
  box-shadow: 0 4px 24px rgba(0,0,0,0.5);
  /* #bs-left-col is a flex column with a capped height, so a panel taller than
     the viewport was squashed and its rows drew on top of each other. Longer
     labels (French) hit this constantly. Let the column scroll instead. */
  flex-shrink: 0;
}
.bs-panel-title {
  font-weight: 700;
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #ffc840;
  margin-bottom: 10px;
  border-bottom: 1px solid rgba(200,160,60,0.25);
  padding-bottom: 6px;
}
/* Same look as a panel title, but this one holds a hole id, not translated
   text — keeping it out of .bs-panel-title lets a locale-refresh check assert
   that every panel title is translated. */
.bs-hole-id-label {
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #ffc840;
  margin-bottom: 10px;
  border-bottom: 1px solid rgba(200,160,60,0.25);
  padding-bottom: 6px;
}

/* ─── HUD top bar ───
   Structural styling (#bs-hud-top, .bs-balance, .bs-time, .bs-speed-btn,
   .bs-weather) now lives inline in shell/TopBar.ts, which owns this surface
   and reuses these ids/classes only for tutorial-selector compatibility.
   .bs-event-badge stays here — TopBar's alert pips still apply this class
   for the same selector-preservation reason, and rely on this rule. */
.bs-event-badge {
  background: rgba(220,60,20,0.9);
  border-radius: 4px;
  padding: 2px 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  animation: bs-pulse 1.2s ease infinite;
  white-space: nowrap;
  pointer-events: all;
}
@keyframes bs-pulse {
  0%,100% { opacity: 1; } 50% { opacity: 0.55; }
}

/* ─── Score bars, toolbar ───
   #bs-hud-scores and #bs-toolbar are now owned by shell/TopBar.ts and
   shell/ToolRail.ts respectively, styled inline. Both ids are reused only
   for tutorial-selector compatibility — the old .bs-score-* / .bs-toolbar-btn
   rules that used to style them are gone with HUD.ts, the component they
   belonged to. */

/* ─── Panels (left side, below HUD) ─── */
#bs-blast-panel     { top: 52px; left: 10px; width: 240px; max-height: calc(100vh - 62px); overflow-y: auto; }
#bs-contract-panel  { top: 52px; left: 10px; width: 300px; max-height: calc(100vh - 62px); overflow-y: auto; }
#bs-build-panel     { top: 52px; left: 10px; width: 270px; max-height: calc(100vh - 62px); overflow-y: auto; }
#bs-vehicle-panel   { top: 52px; left: 10px; width: 340px; max-height: calc(100vh - 62px); overflow-y: auto; }
#bs-employee-panel  { top: 52px; left: 10px; width: 290px; max-height: calc(100vh - 62px); overflow-y: auto; }
#bs-survey-panel    { top: 52px; left: 10px; width: 240px; max-height: calc(100vh - 62px); overflow-y: auto; }
#bs-settings-panel  {
  top: 50%;
  left: 50%;
  transform: translate(-50%,-50%);
  width: 320px;
  z-index: 10000;
}
/* Never had a position rule — with no top/left, a .bs-ui (position:fixed)
   element's static position falls back to its place in normal document flow,
   which sits below #game-canvas (a full-viewport block above it in the
   DOM). The panel rendered a full viewport-height below the fold — present
   and "clickable" by every DOM check, invisible and unreachable on screen (#408). */
#bs-save-panel {
  top: 50%;
  left: 50%;
  transform: translate(-50%,-50%);
  width: 340px;
  z-index: 10000;
}
.bs-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  gap: 8px;
}
.bs-settings-label { color: #9a8868; font-size: 12px; }

/* ─── Buttons ─── */
.bs-btn {
  cursor: pointer;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 5px;
  padding: 5px 12px;
  font-size: 12px;
  font-family: inherit;
  color: #d8d0c0;
  background: rgba(255,255,255,0.08);
  transition: background 0.15s, border-color 0.15s;
  pointer-events: all;
}
.bs-btn:hover { background: rgba(255,255,255,0.16); border-color: rgba(255,255,255,0.22); }
.bs-btn:active { background: rgba(255,255,255,0.06); }
.bs-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.bs-btn-danger {
  background: rgba(180,40,20,0.5);
  border-color: rgba(200,60,30,0.4);
  color: #f0a090;
}
.bs-btn-danger:hover { background: rgba(200,50,25,0.7); border-color: rgba(220,80,50,0.6); }
.bs-btn-primary {
  background: rgba(220,150,0,0.5);
  border-color: rgba(255,180,0,0.4);
  color: #ffe090;
}
.bs-btn-primary:hover { background: rgba(240,165,0,0.7); border-color: rgba(255,195,0,0.6); }

/* ─── Form inputs ─── */
.bs-select, .bs-input {
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 4px;
  padding: 4px 8px;
  color: #e8e0d0;
  font-size: 12px;
  font-family: inherit;
  width: 100%;
  outline: none;
  transition: border-color 0.15s;
}
.bs-select:focus, .bs-input:focus { border-color: rgba(255,200,64,0.6); }

/* ─── Blast plan ─── */
.bs-hole-row { display: flex; gap: 6px; align-items: center; margin-bottom: 5px; font-size: 11px; }
.bs-hole-id { color: #ffc840; font-weight: 700; width: 26px; }
.bs-charge-info { flex: 1; color: #a09070; }
.bs-blast-btn { width: 100%; margin-top: 8px; font-size: 13px; font-weight: 700; padding: 8px; }

/* ─── Confirm / Blast execute overlay ─── */
.bs-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  /* var(), not a literal: a confirm-before-destructive-action dialog has to
     beat literally everything, including a menu-tier panel (z-menu-settings)
     raising one on itself (Settings' RETURN TO MAIN MENU, redesign P10) —
     found when this was still a hardcoded 600 and the confirm rendered
     entirely hidden behind the settings panel that requested it. */
  z-index: var(--bsx-z-modal);
  pointer-events: all;
}
.bs-confirm-box {
  background: #14100a;
  border: 1px solid rgba(200,160,60,0.5);
  border-radius: 10px;
  padding: 24px 28px;
  text-align: center;
  min-width: 260px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.8);
}
.bs-confirm-box p { margin-bottom: 16px; font-size: 14px; color: #d8c8a8; }
.bs-confirm-box .bs-btn { margin: 0 6px; }

/* ─── Contract UI ─── */
.bs-contract-desc { font-weight: 600; color: #d0c8b0; margin-bottom: 2px; }
.bs-contract-details { font-size: 10px; color: #857b6b; }
.bs-contract-active .bs-contract-desc { color: #b0e098; }
.bs-contract-row {
  border-bottom: 1px solid rgba(255,255,255,0.07);
  padding: 7px 0;
  font-size: 11px;
}
.bs-contract-row:last-child { border-bottom: none; }
.bs-contract-btns { display: flex; gap: 4px; margin-top: 5px; }
.bs-progress-bar-bg { background: rgba(255,255,255,0.1); border-radius: 3px; height: 5px; margin-top: 4px; }
.bs-progress-bar-fill { height: 100%; background: #4caf50; border-radius: 3px; transition: width 0.4s; }

/* ─── Build menu ─── */
.bs-build-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  padding: 6px 0;
  font-size: 11px;
}
.bs-build-row:last-child { border-bottom: none; }
.bs-build-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; }
.bs-build-item {
  cursor: pointer;
  border: 1px solid rgba(255,255,255,0.13);
  border-radius: 6px;
  padding: 7px 4px;
  text-align: center;
  font-size: 10px;
  background: rgba(255,255,255,0.04);
  transition: background 0.15s, border-color 0.15s;
  pointer-events: all;
}
.bs-build-item:hover { background: rgba(255,255,255,0.11); border-color: rgba(255,255,255,0.25); }
.bs-build-item.selected { border-color: #ffc840; background: rgba(255,200,64,0.14); }
.bs-build-icon { font-size: 20px; display: block; margin-bottom: 2px; }
.bs-build-cost { color: #ffc840; font-size: 10px; }
.bs-ghost-building {
  position: fixed;
  pointer-events: none;
  z-index: 150;
  background: rgba(0,255,100,0.25);
  border: 2px solid #00e676;
  border-radius: 3px;
}

/* ─── Vehicle & Employee panels ─── */
.bs-vehicle-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  padding: 6px 0;
  font-size: 11px;
}
.bs-vehicle-row:last-child { border-bottom: none; }
.bs-employee-row {
  display: flex;
  /* Wraps so an expanded detail drops onto its own full-width line. As a
     non-wrapping flex sibling it was laid out beside the name column and drawn
     over it, leaving the name, morale and the Raise/Fire buttons unreadable and
     unclickable. */
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  padding: 6px 0;
  font-size: 11px;
}
.bs-employee-row:last-child { border-bottom: none; }
.bs-employee-row.collapsing {
  border-left: 3px solid #e05040;
  background: rgba(224,80,64,0.1);
  padding-left: 5px;
}
.bs-entity-row {
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  padding: 6px 0;
  font-size: 11px;
}
.bs-entity-row:last-child { border-bottom: none; }
.bs-entity-info { flex: 1; }
.bs-entity-name { font-weight: 600; color: #e0d8c8; }
.bs-entity-sub { color: #847a6a; font-size: 10px; margin-top: 1px; }
.bs-hp-bar-bg { background: rgba(255,255,255,0.1); border-radius: 2px; height: 4px; width: 60px; margin-top: 3px; }
.bs-hp-bar-fill { height: 100%; background: #4caf50; border-radius: 2px; transition: width 0.3s; }

/* ─── Employee skills detail (10.6.2) ─── */
.bs-skill-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 10px; }
.bs-skill-category { color: #d0b090; font-weight: 600; }
.bs-skill-stars { color: #ffc840; font-size: 11px; }
.bs-xp-bar-bg { background: rgba(255,255,255,0.1); border-radius: 2px; height: 4px; margin-top: 2px; flex: 1; min-width: 40px; }
.bs-xp-bar-fill { height: 100%; background: linear-gradient(90deg, #4caf50, #8bc34a); border-radius: 2px; transition: width 0.3s; }
.bs-need-bar-bg { background: rgba(255,255,255,0.08); border-radius: 2px; height: 5px; margin-top: 1px; }
.bs-need-bar-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
.bs-task-queue { margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 4px; }
.bs-task-entry { display: flex; align-items: center; gap: 4px; padding: 2px 0; font-size: 10px; color: #a09070; }
.bs-task-entry.current { color: #d0c8b0; font-weight: 600; }
.bs-task-time { margin-left: auto; color: #807060; font-size: 9px; }
.bs-salary-breakdown { margin-top: 4px; font-size: 9px; color: #857b6b; }
.bs-salary-total { color: #ffc840; font-weight: 600; font-size: 10px; }
.bs-training-badge { background: rgba(100,150,255,0.2); border: 1px solid rgba(100,150,255,0.3); border-radius: 3px; padding: 1px 5px; font-size: 9px; color: #88bbff; display: inline-block; }
.bs-modifier-tag { background: rgba(255,200,64,0.1); border-radius: 2px; padding: 1px 4px; font-size: 9px; color: #c8a848; display: inline-block; margin: 1px; }
.bs-need-row { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; font-size: 10px; }
.bs-need-label { width: 48px; color: #9a8868; font-size: 9px; }
.bs-need-value { font-weight: 600; }
.bs-need-value.good { color: #4caf50; }
.bs-need-value.warn { color: #ffc107; }
.bs-need-value.bad { color: #e05252; }
.bs-employee-detail { flex: 0 0 100%; margin-top: 6px; padding: 6px 8px; background: rgba(255,255,255,0.04); border-radius: 4px; border: 1px solid rgba(255,255,255,0.06); }
.bs-detail-toggle { cursor: pointer; font-size: 9px; color: #706050; margin-left: auto; user-select: none; }
.bs-queue-empty { font-size: 10px; color: #605040; font-style: italic; padding: 2px 0; }

/* ─── Section headers ─── */
.bs-section-header {
  font-size: 10px;
  color: #857b6b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
  margin-top: 2px;
}

/* ─── Event dialog (above everything) ─── */
#bs-event-dialog {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.7);
  /* var(), not the literal 600 this used to be: the pre-redesign z-index
     scale never anticipated the menu tier's Settings sitting above it (P10)
     — same class of bug as .bs-confirm-overlay above. An event and a confirm
     dialog never actually compete for the same pixels (the event's own
     full-screen overlay blocks the clicks that would raise a confirm), so
     sharing the tier is safe. */
  z-index: var(--bsx-z-modal);
  pointer-events: all;
}
.bs-event-box {
  background: #14100a;
  border: 1px solid rgba(200,160,60,0.5);
  border-radius: 10px;
  padding: 26px 28px;
  max-width: 500px;
  width: 92%;
  box-shadow: 0 8px 40px rgba(0,0,0,0.8);
}
.bs-event-title { font-size: 16px; font-weight: 700; color: #ffc840; margin-bottom: 10px; }
.bs-event-text { font-size: 13px; line-height: 1.65; color: #d0c8b0; margin-bottom: 16px; }
.bs-event-outcome-headline { font-size: 14px; color: #ffc840; font-weight: 600; line-height: 1.5; margin-bottom: 8px; }
.bs-event-outcome { font-size: 10px; color: #80c878; margin-bottom: 14px; font-style: italic; opacity: 0.85; }
.bs-event-choices { display: flex; flex-direction: column; gap: 6px; }
.bs-event-choice { text-align: left; padding: 9px 14px; font-size: 12px; line-height: 1.4; }

/* ─── Survey UI ─── */
.bs-survey-method {
  cursor: pointer;
  border: 1px solid rgba(255,255,255,0.13);
  border-radius: 5px;
  padding: 5px 8px;
  margin-bottom: 4px;
  background: rgba(255,255,255,0.04);
  transition: background 0.15s, border-color 0.15s;
  pointer-events: all;
}
.bs-survey-method:hover { background: rgba(255,255,255,0.11); border-color: rgba(255,255,255,0.25); }
.bs-survey-method.selected { border-color: #ffc840; background: rgba(255,200,64,0.14); }
.bs-survey-method-name { font-size: 11px; color: #d0b090; font-weight: 600; }
/* Lightened to clear WCAG AA against the selected row's warm tint. */
.bs-survey-method-meta { font-size: 10px; color: #bda989; margin-top: 1px; }
.bs-survey-result {
  border-bottom: 1px solid rgba(255,255,255,0.07);
  padding: 5px 0;
}
.bs-survey-result:last-child { border-bottom: none; }
.bs-ore-row { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; font-size: 11px; }
.bs-ore-bar-bg { flex: 1; background: rgba(255,255,255,0.1); border-radius: 3px; height: 8px; }
.bs-ore-bar-fill { height: 100%; border-radius: 3px; background: #ffc840; }

/* ─── Mini-map (bottom-right) ─── */
#bs-minimap { bottom: 10px; right: 10px; width: fit-content; }
#bs-minimap-canvas { display: block; cursor: crosshair; background: #141e10; border-radius: 4px; }

/* ─── Notification toast ─── */
.bs-notification {
  position: fixed;
  /* Clears the tutorial coach mark, which docks along the bottom edge. */
  bottom: 220px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(60,20,8,0.95);
  border: 1px solid rgba(180,80,30,0.6);
  border-radius: 8px;
  padding: 10px 20px;
  font-size: 13px;
  color: #f0c060;
  z-index: 800;
  pointer-events: none;
  text-align: center;
  max-width: 380px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.7);
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
   Bottom-docked like the tutorial coach card above, so a guided step that
   arms the placement tool needs the strip pushed clear of the card instead
   of sitting behind it — same screen edge, same z-stack region. */
#bs-param-strip { bottom: 18px; }
body.bs-tutorial-guided #bs-param-strip { bottom: var(--bsx-tutorial-card-clearance, 210px); }
/* Overrides the shared .bs-panel-title (uppercase, gold, bordered) — the
   coach card's title sits inline with the CLOCK HELD chip and step counter
   instead of owning its own bordered header row. */
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
  transition: width 0.3s ease;
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
   The coach card itself carries no button/select/input (no Skip, no Next, no
   close — see tutorialOverlayDom.ts), so it needs no exemption from this rule. */
body.bs-tutorial-guided button:not(.bs-tutorial-allowed),
body.bs-tutorial-guided select:not(.bs-tutorial-allowed),
body.bs-tutorial-guided input:not(.bs-tutorial-allowed),
body.bs-tutorial-guided .bs-detail-toggle:not(.bs-tutorial-allowed) {
  pointer-events: none;
  opacity: 0.4;
  filter: saturate(0.3);
}
.bs-tutorial-stage {
  font: 600 11px/1.4 var(--bsx-font-ui);
}
/* CLOCK HELD chip, inline with the title. */
.bs-tutorial-paused {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(255,176,46,.16);
  color: var(--bsx-amber);
  font: 700 10px/1.4 var(--bsx-font-ui);
  letter-spacing: .04em;
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
