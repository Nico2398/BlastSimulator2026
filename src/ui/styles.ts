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

/* ─── HUD top bar ─── */
#bs-hud-top {
  top: 0; left: 0; right: 0;
  height: 44px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 14px;
  background: rgba(6,5,2,0.92);
  border-bottom: 1px solid rgba(200,160,60,0.2);
  pointer-events: all;
  backdrop-filter: blur(6px);
  box-shadow: 0 2px 12px rgba(0,0,0,0.5);
  z-index: 150;
}
#bs-hud-top .bs-balance {
  font-size: 17px;
  font-weight: 800;
  color: #ffd54f;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
#bs-hud-top .bs-time {
  flex: 1;
  text-align: center;
  font-size: 12px;
  color: #a89878;
  white-space: nowrap;
}
#bs-hud-top .bs-speed-btn {
  cursor: pointer;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 4px;
  padding: 3px 10px;
  color: #e8e0d0;
  font-size: 12px;
  font-family: inherit;
  transition: background 0.15s;
  pointer-events: all;
}
#bs-hud-top .bs-speed-btn:hover { background: rgba(255,255,255,0.18); }
#bs-hud-top .bs-weather { font-size: 18px; line-height: 1; }
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

/* ─── Score bars (top-right, below HUD) ─── */
#bs-hud-scores {
  top: 52px;
  right: 128px;
  width: 160px;
}
.bs-score-row { margin-bottom: 7px; }
.bs-score-row:last-child { margin-bottom: 0; }
.bs-score-label {
  font-size: 10px;
  color: #9a8868;
  margin-bottom: 3px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.bs-score-bar-bg {
  background: rgba(255,255,255,0.1);
  border-radius: 4px;
  height: 6px;
  overflow: hidden;
}
.bs-score-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.4s ease;
}
.bs-score-wellbeing  .bs-score-bar-fill { background: linear-gradient(90deg, #2e7d32, #66bb6a); }
.bs-score-safety     .bs-score-bar-fill { background: linear-gradient(90deg, #1565c0, #42a5f5); }
.bs-score-ecology    .bs-score-bar-fill { background: linear-gradient(90deg, #2e7d32, #81c784); }
.bs-score-nuisance   .bs-score-bar-fill { background: linear-gradient(90deg, #bf360c, #ff7043); }

/* ─── Toolbar (right side, vertically centered) ─── */
#bs-toolbar {
  position: fixed;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 3px;
  z-index: 200;
  pointer-events: all;
}
.bs-toolbar-btn {
  cursor: pointer;
  background: rgba(8,6,3,0.88);
  border: 1px solid rgba(200,160,60,0.3);
  border-radius: 6px;
  padding: 8px 14px;
  color: #b8a888;
  font-size: 11px;
  font-family: inherit;
  font-weight: 600;
  letter-spacing: 0.03em;
  width: 108px;
  text-align: left;
  pointer-events: all;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  backdrop-filter: blur(4px);
}
.bs-toolbar-btn:hover {
  background: rgba(200,160,60,0.18);
  color: #e8d8b0;
  border-color: rgba(200,160,60,0.55);
}
.bs-toolbar-btn.active {
  border-color: #ffc840;
  color: #ffc840;
  background: rgba(255,200,64,0.12);
}

/* ─── Panels (left side, below HUD) ─── */
#bs-blast-panel     { top: 52px; left: 10px; width: 240px; max-height: calc(100vh - 62px); overflow-y: auto; }
#bs-contract-panel  { top: 52px; left: 10px; width: 300px; max-height: calc(100vh - 62px); overflow-y: auto; }
#bs-build-panel     { top: 52px; left: 10px; width: 270px; max-height: calc(100vh - 62px); overflow-y: auto; }
#bs-vehicle-panel   { top: 52px; left: 10px; width: 290px; max-height: calc(100vh - 62px); overflow-y: auto; }
#bs-employee-panel  { top: 52px; left: 10px; width: 290px; max-height: calc(100vh - 62px); overflow-y: auto; }
#bs-survey-panel    { top: 52px; left: 10px; width: 240px; max-height: calc(100vh - 62px); overflow-y: auto; }
#bs-settings-panel  {
  top: 50%;
  left: 50%;
  transform: translate(-50%,-50%);
  width: 320px;
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
  z-index: 600;
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
.bs-contract-details { font-size: 10px; color: #7a7060; }
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
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  padding: 6px 0;
  font-size: 11px;
}
.bs-employee-row:last-child { border-bottom: none; }
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

/* ─── Section headers ─── */
.bs-section-header {
  font-size: 10px;
  color: #7a7060;
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
  z-index: 600;
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
.bs-event-outcome { font-size: 12px; color: #80c878; margin-bottom: 14px; font-style: italic; }
.bs-event-choices { display: flex; flex-direction: column; gap: 6px; }
.bs-event-choice { text-align: left; padding: 9px 14px; font-size: 12px; line-height: 1.4; }

/* ─── Survey UI ─── */
.bs-ore-row { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; font-size: 11px; }
.bs-ore-bar-bg { flex: 1; background: rgba(255,255,255,0.1); border-radius: 3px; height: 8px; }
.bs-ore-bar-fill { height: 100%; border-radius: 3px; background: #ffc840; }

/* ─── Mini-map (bottom-right) ─── */
#bs-minimap { bottom: 10px; right: 10px; width: fit-content; }
#bs-minimap-canvas { display: block; cursor: crosshair; background: #141e10; border-radius: 4px; }

/* ─── Tile Select Overlay ─── */
.bs-tile-select-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
  z-index: 700;
  pointer-events: all;
  backdrop-filter: blur(2px);
}
.bs-tile-select-panel {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 18px;
  background: rgba(10,8,4,0.95);
  border: 1px solid rgba(200,160,60,0.4);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 12px 60px rgba(0,0,0,0.85);
  max-width: 95vw;
  max-height: 95vh;
}
.bs-tile-select-canvas {
  display: block;
  cursor: crosshair;
  border-radius: 6px;
  border: 1px solid rgba(200,160,60,0.25);
  max-width: 60vw;
  max-height: 75vh;
}
.bs-tile-select-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 200px;
  max-width: 240px;
}
.bs-tile-select-title {
  font-weight: 700;
  font-size: 13px;
  color: #ffc840;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border-bottom: 1px solid rgba(200,160,60,0.25);
  padding-bottom: 8px;
}
.bs-tile-select-hint {
  font-size: 11px;
  color: #7a7060;
  line-height: 1.5;
}
.bs-tile-select-info {
  font-size: 11px;
  color: #b0a888;
  background: rgba(255,255,255,0.05);
  border-radius: 4px;
  padding: 6px 8px;
  min-height: 32px;
  line-height: 1.5;
}
.bs-tile-select-fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bs-tile-select-field-label {
  font-size: 10px;
  color: #908070;
  margin-bottom: 2px;
  display: block;
}
.bs-tile-select-btns {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: auto;
}
.bs-tile-select-btns .bs-btn { width: 100%; }

/* ─── Notification toast ─── */
.bs-notification {
  position: fixed;
  bottom: 20px;
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
