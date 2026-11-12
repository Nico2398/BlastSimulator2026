// BlastSimulator2026 — Central window stylesheet (#2241, #2242, #2243)
// Styles for the window kit (windowKit.ts), portraits (portraits.ts), the
// stage that hosts the windows (shell/CenterStage.ts) and the contract
// outlook. Injected once, with the design tokens (tokens.ts injectTokens).

import { PORTRAIT_CSS } from './portraits.js';
import { STAGE_CSS } from './shell/CenterStage.js';

const WINDOW_CSS = `
.bsx-window {
  flex-direction: column; overflow: hidden; pointer-events: all;
  border-radius: 12px; border: 1px solid var(--bsx-hairline-strong);
  background: linear-gradient(180deg, #161c24 0%, var(--bsx-panel) 140px);
  box-shadow: 0 24px 64px rgba(0,0,0,.6), 0 0 0 1px rgba(0,0,0,.4);
}
.bsx-window-body {
  flex: 1 1 auto; overflow-y: auto; overscroll-behavior: contain;
  padding: 14px 16px 20px; display: flex; flex-direction: column; gap: 18px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.18) transparent;
}
/* A window has one scroll area: lists keep their scroll-bounded wrapper as a hook, never a second scrollbar. */
.bsx-window .bsx-bounded { max-height: none !important; overflow: visible !important; }
/* Filter bars lie flat in a window: one wrapped toolbar instead of a stack of rows. */
.bsx-window .bs-filter-bar {
  flex-direction: row; flex-wrap: wrap; align-items: center; gap: 6px 18px;
  padding: 8px 10px; border-radius: 8px; background: var(--bsx-well); border: 1px solid var(--bsx-hairline);
}
.bsx-window .bs-filter-row { gap: 3px; }

/* ── sections ── */
.bsx-wsection { display: flex; flex-direction: column; gap: 10px; }
.bsx-wsection-head { display: flex; align-items: center; gap: 8px; min-height: 22px; }
.bsx-wsection-title { font: 700 11px/1 var(--bsx-font-ui); letter-spacing: .14em; text-transform: uppercase; color: var(--bsx-text-secondary); white-space: nowrap; }
.bsx-wsection-count { font-size: 10px; padding: 2px 6px; border-radius: 9px; background: rgba(255,255,255,.07); color: var(--bsx-text-muted); }
.bsx-wsection-rule { flex: 1; height: 1px; background: var(--bsx-hairline); }
.bsx-wsection-note { font: 500 10px/1.3 var(--bsx-font-ui); color: var(--bsx-text-micro); }
.bsx-wsection-head > .bsx-btn { height: 24px; padding: 0 9px; }

/* ── grids and cards ── */
.bsx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(var(--bsx-grid-min, 220px), 100%), 1fr)); gap: 10px; align-items: stretch; }
.bsx-ecard {
  display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 10px;
  border-radius: 9px; border: 1px solid var(--bsx-hairline); background: var(--bsx-card);
  transition: border-color .12s, background .12s, transform .12s;
}
.bsx-ecard[data-clickable] { cursor: pointer; }
.bsx-ecard[data-clickable]:hover { border-color: rgba(255,255,255,.2); background: #1f2630; }
.bsx-ecard-main { display: flex; gap: 11px; align-items: flex-start; min-width: 0; }
.bsx-ecard-column .bsx-ecard-main { flex-direction: column; align-items: stretch; }
.bsx-ecard-column .bsx-portrait { align-self: center; }
.bsx-ecard-content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.bsx-ecard-titlerow { display: flex; align-items: flex-start; gap: 8px; }
.bsx-ecard-titles { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.bsx-ecard-title { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.bsx-ecard-name { font: 650 13px/1.15 var(--bsx-font-ui); color: var(--bsx-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bsx-ecard-note { font-size: 10px; color: var(--bsx-text-micro); }
.bsx-ecard-sub { font: 400 11px/1.25 var(--bsx-font-ui); color: var(--bsx-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bsx-ecard-footer { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.bsx-ecard-footer > .bsx-btn { flex: 1 1 auto; }
.bsx-ecard-line { display: flex; align-items: center; gap: 6px; font: 400 11px/1.3 var(--bsx-font-ui); color: var(--bsx-text-tinted); min-width: 0; }
.bsx-ecard-line .bsx-gauge-row { flex: 1; min-width: 0; }
.bsx-ecard-desc { font: 400 11px/1.35 var(--bsx-font-ui); color: var(--bsx-text-muted); }
.bsx-ecard-locked { opacity: .55; }

/* ── key figures ── */
.bsx-kpis { display: flex; flex-wrap: wrap; gap: 10px; }
.bsx-kpi { flex: 1 1 105px; min-width: 0; padding: 8px 10px; border-radius: 9px; background: var(--bsx-well); border: 1px solid var(--bsx-hairline); display: flex; flex-direction: column; gap: 5px; }
.bsx-kpi-label { font: 600 9px/1 var(--bsx-font-ui); letter-spacing: .14em; text-transform: uppercase; color: var(--bsx-text-micro); }
.bsx-kpi-value { font: 700 17px/1 var(--bsx-font-mono); }
.bsx-kpi-sub { font: 400 10px/1.3 var(--bsx-font-ui); color: var(--bsx-text-muted); }

/* ── have vs need ── */
.bsx-hvn-track { position: relative; height: 6px; border-radius: 3px; background: #242c36; overflow: hidden; }
.bsx-hvn-fill { height: 100%; border-radius: 3px; transition: width .3s; }

/* ── status pill ── */
.bsx-pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px 3px 6px; border-radius: 10px; font: 600 10px/1 var(--bsx-font-ui); white-space: nowrap; background: rgba(255,255,255,.06); }
.bsx-pill-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.bsx-pill-neutral { color: var(--bsx-text-muted); }
.bsx-pill-positive { color: var(--bsx-positive); background: rgba(79,199,107,.12); }
.bsx-pill-warn { color: var(--bsx-amber-hover); background: rgba(255,176,46,.12); }
.bsx-pill-critical { color: var(--bsx-critical-text); background: rgba(255,91,76,.13); }
.bsx-pill-info { color: var(--bsx-info-text); background: rgba(85,168,255,.12); }

/* ── staff coverage (Crew, Fleet) ── */
.bsx-coverage { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(250px, 100%), 1fr)); gap: 8px; }
.bsx-coverage-item { display: flex; flex-direction: column; gap: 6px; padding: 9px 11px; border-radius: 8px; background: var(--bsx-well); border: 1px solid var(--bsx-hairline); }
.bsx-coverage-item[data-status="missing"] { border-color: rgba(255,91,76,.38); }
.bsx-coverage-item[data-status="short"] { border-color: rgba(255,176,46,.32); }
.bsx-coverage-head { display: flex; align-items: center; gap: 8px; }
.bsx-coverage-skill { flex: 1; min-width: 0; font: 650 12px/1.2 var(--bsx-font-ui); color: var(--bsx-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bsx-coverage-figures { display: flex; justify-content: space-between; gap: 8px; font: 500 10px/1.3 var(--bsx-font-ui); color: var(--bsx-text-muted); }
.bsx-coverage-figures b { font-family: var(--bsx-font-mono); color: var(--bsx-text-secondary); }

/* ── contract outlook (#2243) ── */
.bsx-outlook { display: flex; flex-direction: column; gap: 8px; }
.bsx-outlook-row {
  display: grid; grid-template-columns: minmax(110px, 1.1fr) minmax(170px, 2fr) repeat(3, minmax(72px, .8fr)) minmax(96px, auto);
  align-items: center; gap: 12px; padding: 9px 12px; border-radius: 8px; background: var(--bsx-well); border: 1px solid var(--bsx-hairline);
}
.bsx-outlook-row[data-outlook="will_miss"] { border-color: rgba(255,91,76,.38); }
.bsx-outlook-row[data-outlook="at_risk"] { border-color: rgba(255,176,46,.32); }
.bsx-outlook-head { padding: 0 12px; background: none; border: 0; font: 600 9px/1 var(--bsx-font-ui); letter-spacing: .12em; text-transform: uppercase; color: var(--bsx-text-micro); }
.bsx-outlook-material { display: flex; align-items: center; gap: 8px; min-width: 0; font: 650 12px/1.2 var(--bsx-font-ui); }
.bsx-outlook-swatch { width: 10px; height: 10px; border-radius: 3px; flex: 0 0 10px; }
.bsx-outlook-cell { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.bsx-outlook-big { font: 650 12px/1.1 var(--bsx-font-mono); color: var(--bsx-text-primary); white-space: nowrap; }
.bsx-outlook-small { font: 400 10px/1.2 var(--bsx-font-ui); color: var(--bsx-text-micro); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bsx-outlook-supply { position: relative; height: 10px; border-radius: 5px; background: #242c36; overflow: hidden; }
.bsx-outlook-supply > span { position: absolute; top: 0; bottom: 0; }
.bsx-outlook-demand-mark { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--bsx-text-primary); border-radius: 1px; }
.bsx-outlook-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font: 500 10px/1.2 var(--bsx-font-ui); color: var(--bsx-text-micro); }
.bsx-outlook-legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }

/* ── deadline timeline (#2243) ── */
.bsx-timeline { position: relative; display: flex; flex-direction: column; gap: 5px; padding: 8px 12px 6px; border-radius: 8px; background: var(--bsx-well); border: 1px solid var(--bsx-hairline); }
.bsx-timeline-row { display: grid; grid-template-columns: 150px 1fr 64px; align-items: center; gap: 10px; min-height: 18px; }
.bsx-timeline-label { font: 500 11px/1.2 var(--bsx-font-ui); color: var(--bsx-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bsx-timeline-track { position: relative; height: 12px; border-radius: 6px; background: rgba(255,255,255,.04); }
.bsx-timeline-bar { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 6px; opacity: .85; overflow: hidden; }
.bsx-timeline-done { position: absolute; left: 0; top: 0; bottom: 0; background: rgba(255,255,255,.35); }
.bsx-timeline-hours { font: 600 10px/1 var(--bsx-font-mono); color: var(--bsx-text-muted); text-align: right; }
.bsx-timeline-axis { display: grid; grid-template-columns: 150px 1fr 64px; gap: 10px; font: 500 9px/1 var(--bsx-font-mono); color: var(--bsx-text-micro); }
.bsx-timeline-ticks { position: relative; height: 10px; }
.bsx-timeline-ticks > span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.bsx-timeline-ticks > span:first-child { transform: none; }
/* ── Crew window ── */
.bsx-ecard-hit { flex: 1; min-width: 0; display: flex; gap: 11px; align-items: flex-start; padding: 0; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.bs-crew-card-main { display: flex; gap: 8px; align-items: flex-start; min-width: 0; }
.bs-crew-aside { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; flex: 0 0 auto; }
.bs-crew-card .bsx-gauge-row { gap: 6px; }
.bs-crew-collapsing { border-color: rgba(255,91,76,.45); }
.bs-hiring-group { display: flex; flex-direction: column; gap: 9px; padding: 10px; border-radius: 10px; background: rgba(255,255,255,.02); border: 1px solid var(--bsx-hairline); }
.bs-hiring-head { display: flex; gap: 12px; align-items: center; min-width: 0; }
.bs-candidate-card { border-left: 3px solid var(--bsx-role-accent, var(--bsx-hairline)); }
.bs-candidate-fee { margin-right: auto; font-size: 12px; font-weight: 700; color: var(--bsx-amber); }
.bs-candidate-card .bsx-ecard-footer > .bsx-btn { flex: 0 0 auto; min-width: 74px; }
/* ── Fleet window ── */
.bs-fleet-grid > .bs-filter-bar { grid-column: 1 / -1; }
.bs-fleet-card .bsx-ecard-titlerow .bsx-btn, .bs-fleet-card .bsx-ecard-titlerow button { flex: 0 0 auto; }
.bs-dealer-group { display: flex; flex-direction: column; gap: 8px; }
.bs-dealer-head { display: flex; align-items: baseline; gap: 10px; }
.bs-dealer-role { font: 700 12px/1.2 var(--bsx-font-ui); color: var(--bsx-text-primary); }
.bs-dealer-licence { font: 400 10px/1.2 var(--bsx-font-ui); color: var(--bsx-text-micro); }
.bs-dealer-tiers { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(230px, 100%), 1fr)); gap: 8px; }
.bs-fleet-tier-btn { transition: border-color .12s, background .12s; }
.bs-fleet-tier-btn:not(:disabled):hover { border-color: rgba(85,168,255,.55) !important; background: #1f2630 !important; }
.bs-fleet-tier-buy { font: 700 10px/1 var(--bsx-font-ui); letter-spacing: .12em; text-transform: uppercase; color: var(--bsx-info-text); }
/* ── Contracts window ── */
.bsx-window .bsx-bounded.bs-contract-list { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); align-items: start; }
.bsx-window .bsx-bounded.bs-contract-list-closed { grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); }
.bsx-window .bs-contract-list > .bsx-empty, .bsx-window .bs-contract-list > .bs-filter-clear { grid-column: 1 / -1; }
.bs-contract-strips { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr)); gap: 10px; align-items: stretch; }
.bs-contract-fit { display: flex; align-items: center; justify-content: space-between; gap: 8px; font: 500 10px/1.2 var(--bsx-font-ui); color: var(--bsx-text-micro); }
/* ── Build window ── */
.bsx-window #bs-build-catalog, .bsx-window #bs-build-vanity { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(min(250px, 100%), 1fr)); gap: 10px !important; }
.bsx-window #bs-build-placed, .bsx-window #bs-build-sites { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(min(250px, 100%), 1fr)); gap: 8px !important; }
.bs-build-card { display: flex; flex-direction: column; gap: 9px; padding: 10px; border: 1px solid var(--bsx-hairline); border-radius: 9px; background: var(--bsx-card); min-width: 0; }
.bs-build-card-top { display: flex; gap: 11px; align-items: flex-start; min-width: 0; }
.bs-build-card-top > div:last-child { flex: 1 1 auto !important; }
.bs-build-card-top span:first-child { font-size: 12.5px !important; }
.bs-build-card-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: auto; }
.bs-build-card-actions .bs-build-buy-btn, .bs-build-card-actions .bs-build-research-btn { flex: 1 1 auto !important; padding: 7px 10px !important; font-size: 10px !important; }
.bs-build-placed-row { flex-wrap: nowrap !important; align-items: flex-start !important; gap: 9px !important; padding: 8px !important; border-radius: 9px !important; }
.bsx-window .bs-build-terrain-tools { flex-direction: row !important; flex-wrap: wrap; }
.bsx-window .bs-build-terrain-tools > button { width: auto !important; flex: 1 1 200px; }
/* ── Reading windows: Operations, Finances, Shady, Permits read as a column of text, so they stay narrower ── */
#bs-center-stage > #bs-operations-panel, #bs-center-stage > #bs-finances-panel,
#bs-center-stage > #bs-shady-panel, #bs-center-stage > #bs-permit-panel { max-width: 820px; }
.bsx-window .bs-ops-logistics { display: grid !important; grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr)); }
`;

/** Everything this module styles, in cascade order. */
export const WINDOW_STYLES_CSS = STAGE_CSS + PORTRAIT_CSS + WINDOW_CSS;

let injected = false;

/** Add the stylesheet to the page once; later calls do nothing. */
export function injectWindowStyles(): void {
  if (injected) return;
  const style = document.createElement('style');
  style.dataset['bsx'] = 'windows';
  style.textContent = WINDOW_STYLES_CSS;
  document.head.appendChild(style);
  injected = true;
}
