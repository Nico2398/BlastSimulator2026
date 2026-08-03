// BlastSimulator2026 — Design tokens (redesign P0)
//
// CSS custom properties + shared component classes ported 1:1 from
// docs/BlastSim game UI design/BlastSim Design System.dc.html. Injected
// alongside the legacy stylesheet (styles.ts) — surfaces migrate to the
// `bsx-` classes phase by phase; nothing here removes legacy `bs-` classes.
//
// Font note: the design specifies Archivo + IBM Plex Mono from Google Fonts.
// That CDN is policy-blocked in this environment (fonts.gstatic.com returns
// 403 at the network boundary) — no self-hosted binaries were fetchable
// either. Both font roles fall back to native stacks that share the
// intended character: a tight system sans for UI text, and a tabular
// monospace (via font-variant-numeric) for every countable value.

const TOKENS_CSS = `
:root {
  /* ── surfaces ── */
  --bsx-app: #0b0e12;
  --bsx-chrome: #12161c;
  --bsx-panel: #141920;
  --bsx-card: #1b212a;
  --bsx-well: #11161c;
  --bsx-hairline: rgba(255,255,255,.08);
  --bsx-hairline-strong: rgba(255,255,255,.14);

  /* ── text ── */
  --bsx-text-primary: #e6e9ee;
  --bsx-text-secondary: #c9d1db;
  --bsx-text-muted: #98a2b0;
  --bsx-text-micro: #8a94a2;
  --bsx-text-tinted: #b0b9c4;
  --bsx-text-disabled: #5b6470;
  --bsx-text-on-amber: #1a1206;

  /* ── semantic ── */
  --bsx-amber: #ffb02e;
  --bsx-amber-hover: #ffc153;
  --bsx-amber-active: #e09a1f;
  --bsx-scene-amber: #ffc840;
  --bsx-positive: #4fc76b;
  --bsx-critical: #ff5b4c;
  --bsx-critical-text: #ff8a7e;
  --bsx-info: #55a8ff;
  --bsx-info-text: #8fc0ff;
  --bsx-ore: #a98cff;
  --bsx-ore-text: #c4aeff;
  --bsx-pin: #7ab8ff;
  --bsx-survey: #3fd0c0;

  /* ── radius ── */
  --bsx-r-chip: 3px;
  --bsx-r-control: 4px;
  --bsx-r-card: 6px;
  --bsx-r-panel: 9px;

  /* ── spacing (4px base) ── */
  --bsx-sp-1: 4px;
  --bsx-sp-2: 8px;
  --bsx-sp-3: 12px;
  --bsx-sp-4: 16px;
  --bsx-sp-5: 20px;
  --bsx-sp-6: 24px;
  --bsx-sp-7: 32px;

  /* ── z-index (design system §03) ── */
  --bsx-z-canvas: 0;
  --bsx-z-panel: 100;
  --bsx-z-scene-bar: 120;
  --bsx-z-topbar: 150;
  --bsx-z-rail: 200;
  --bsx-z-popover: 210;
  --bsx-z-hovertag: 320;
  --bsx-z-coach: 400;
  --bsx-z-log: 500;
  --bsx-z-modal: 600;
  --bsx-z-menu: 9999;
  --bsx-z-menu-settings: 10000;

  /* ── type ── */
  --bsx-font-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --bsx-font-mono: ui-monospace, 'SF Mono', 'Cascadia Code', 'Segoe UI Mono', Consolas, 'Roboto Mono', monospace;
}

.bsx-root, .bsx-root * { box-sizing: border-box; font-family: var(--bsx-font-ui); }
.bsx-mono { font-family: var(--bsx-font-mono); font-variant-numeric: tabular-nums; }

/* ── section header: micro-label + hairline rule ── */
.bsx-section {
  display: flex;
  align-items: baseline;
  gap: 7px;
  margin: 4px 0 2px;
}
.bsx-section-label {
  font: 600 10px/1 var(--bsx-font-ui);
  letter-spacing: .14em;
  color: var(--bsx-text-micro);
  white-space: nowrap;
}
.bsx-section-rule { flex: 1; height: 1px; background: var(--bsx-hairline); }
.bsx-section-note { font: 500 10px/1 var(--bsx-font-mono); color: var(--bsx-text-micro); white-space: nowrap; }

/* ── cards ── */
.bsx-card {
  padding: 11px;
  border: 1px solid var(--bsx-hairline);
  border-radius: var(--bsx-r-card);
  background: var(--bsx-card);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bsx-well {
  border-radius: var(--bsx-r-card);
  background: var(--bsx-well);
}

/* ── buttons — 8-state inventory (Design System §05) ── */
.bsx-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--bsx-hairline-strong);
  border-radius: var(--bsx-r-control);
  background: transparent;
  color: var(--bsx-text-secondary);
  font: 600 10px/1 var(--bsx-font-ui);
  letter-spacing: .1em;
  cursor: pointer;
  pointer-events: all;
  white-space: nowrap;
  transition: background .12s, border-color .12s, color .12s, filter .12s;
}
.bsx-btn:hover { border-color: rgba(255,255,255,.3); }
.bsx-btn:active { transform: translateY(1px); }
.bsx-btn:disabled { opacity: .45; cursor: not-allowed; transform: none; }

.bsx-btn-primary {
  border: 0;
  background: var(--bsx-amber);
  color: var(--bsx-text-on-amber);
  font-weight: 800;
}
.bsx-btn-primary:hover { background: var(--bsx-amber-hover); }
.bsx-btn-primary:active { background: var(--bsx-amber-active); }
.bsx-btn-primary:disabled { background: #2a323d; color: var(--bsx-text-disabled); }

.bsx-btn-danger {
  border: 1px solid rgba(255,91,76,.32);
  background: transparent;
  color: var(--bsx-critical-text);
}
.bsx-btn-danger:hover { background: rgba(255,91,76,.12); }
.bsx-btn-danger-solid {
  border: 0;
  background: var(--bsx-critical);
  color: #210805;
  font-weight: 700;
}
.bsx-btn-danger-solid:hover { filter: brightness(1.12); }

.bsx-btn-locked {
  border: 1px solid rgba(85,168,255,.45);
  background: transparent;
  color: var(--bsx-info-text);
  font-weight: 700;
}
.bsx-btn-locked:hover { background: rgba(85,168,255,.14); }

.bsx-btn-warn {
  border: 1px solid rgba(255,176,46,.5);
  background: rgba(255,176,46,.12);
  color: var(--bsx-amber);
  font-weight: 700;
}
.bsx-btn-warn:hover { background: rgba(255,176,46,.2); }

/* Disabled-with-reason line under a button */
.bsx-reason {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  font: 500 10px/1.4 var(--bsx-font-ui);
  color: var(--bsx-amber);
}
.bsx-reason.critical { color: var(--bsx-critical-text); }

/* Tutorial-highlighted ring (three-ring glow, per motion table) */
.bsx-highlight {
  box-shadow: 0 0 0 3px rgba(255,176,46,.34), 0 0 0 8px rgba(255,176,46,.13), 0 0 24px rgba(255,176,46,.32) !important;
}

/* ── chips ── */
.bsx-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  border-radius: var(--bsx-r-chip);
  font: 700 8px/1 var(--bsx-font-ui);
  letter-spacing: .11em;
  white-space: nowrap;
}
.bsx-chip-neutral { color: var(--bsx-text-muted); background: rgba(255,255,255,.05); }
.bsx-chip-positive { color: var(--bsx-positive); background: rgba(79,199,107,.14); }
.bsx-chip-critical { color: var(--bsx-critical-text); background: rgba(255,91,76,.14); }
.bsx-chip-warn { color: var(--bsx-amber-hover); background: rgba(255,176,46,.14); }
.bsx-chip-info { color: var(--bsx-info); background: rgba(85,168,255,.14); }
.bsx-chip-ore { color: var(--bsx-ore-text); background: rgba(169,140,255,.14); }
.bsx-chip-locked { color: var(--bsx-text-disabled); background: rgba(255,255,255,.04); }

/* ── gauges (need bars, scores): threshold tick at a given % ── */
.bsx-gauge-row { display: flex; align-items: center; gap: 8px; }
.bsx-gauge-label { font: 400 10px/1 var(--bsx-font-ui); color: var(--bsx-text-muted); white-space: nowrap; }
.bsx-gauge-track {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: #242c36;
  overflow: hidden;
  position: relative;
}
.bsx-gauge-fill { height: 100%; border-radius: 3px; }
.bsx-gauge-tick {
  position: absolute;
  top: -2px; bottom: -2px;
  width: 1px;
  background: rgba(255,255,255,.34);
}
.bsx-gauge-value { font: 500 10px/1 var(--bsx-font-mono); text-align: right; white-space: nowrap; }

/* ── progress (contract urgency etc.) ── */
.bsx-progress {
  height: 6px;
  border-radius: 3px;
  background: #242c36;
  overflow: hidden;
}
.bsx-progress-fill { height: 100%; border-radius: 3px; transition: width .3s; }

/* ── steppers ── */
.bsx-stepper {
  display: flex;
  align-items: center;
  height: 32px;
  border: 1px solid var(--bsx-hairline-strong);
  border-radius: var(--bsx-r-control);
  background: var(--bsx-well);
}
.bsx-stepper-btn {
  width: 30px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: var(--bsx-text-muted);
  cursor: pointer;
  pointer-events: all;
}
.bsx-stepper-btn:hover { color: #fff; }
.bsx-stepper-value {
  flex: 1;
  text-align: center;
  font: 600 12px/1 var(--bsx-font-mono);
  color: var(--bsx-text-primary);
}

/* ── empty state ── */
.bsx-empty {
  padding: 12px 4px;
  font: 400 11px/1.5 var(--bsx-font-ui);
  color: var(--bsx-text-muted);
}

/* ── stat grid (blast report, pre-flight) ── */
.bsx-stat-grid {
  display: grid;
  gap: 1px;
  background: var(--bsx-hairline);
  border-radius: var(--bsx-r-card);
  overflow: hidden;
}
.bsx-stat-cell {
  padding: 11px 12px;
  background: var(--bsx-well);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.bsx-stat-key { font: 600 10px/1 var(--bsx-font-ui); letter-spacing: .12em; color: var(--bsx-text-micro); }
.bsx-stat-value { font: 600 15px/1 var(--bsx-font-mono); color: var(--bsx-text-primary); }

/* ── reduced motion: drop transforms, keep opacity only ── */
@media (prefers-reduced-motion: reduce) {
  .bsx-root, .bsx-root * { animation-duration: .001ms !important; transition-duration: .001ms !important; }
}
`;

let injected = false;

/** Inject the design-token stylesheet into the document once. Additive to styles.ts. */
export function injectTokens(): void {
  if (injected) return;
  const style = document.createElement('style');
  style.textContent = TOKENS_CSS;
  document.head.appendChild(style);
  injected = true;
}
