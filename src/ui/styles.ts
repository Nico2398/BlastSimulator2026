// BlastSimulator2026 — UI stylesheet injection
// Injects a <style> block at runtime so all UI components share consistent styling.

const CSS = `
/* ─── Base overlay ─── */
.bs-ui {
  position: fixed;
  pointer-events: none;
  font-family: 'Segoe UI', Arial, sans-serif;
  font-size: 13px;
  color: #e8e0d0;
  user-select: none;
  z-index: 100;
}
.bs-ui * { box-sizing: border-box; }
.bs-panel {
  background: rgba(10,8,4,0.78);
  border: 1px solid rgba(180,150,80,0.35);
  border-radius: 5px;
  padding: 8px 10px;
  pointer-events: all;
}

/* ─── HUD strips ─── */
#bs-hud-top {
  top: 0; left: 0; right: 0;
  display: flex;
  align-items: center;
  padding: 4px 10px;
  gap: 12px;
  background: rgba(10,8,4,0.70);
  border-bottom: 1px solid rgba(180,150,80,0.25);
  pointer-events: all;
}
#bs-hud-scores {
  top: 44px; right: 10px;
  width: 160px;
}
.bs-score-row { margin-bottom: 5px; }
.bs-score-label { font-size: 11px; color: #b0a080; margin-bottom: 2px; }
.bs-score-bar-bg {
  background: rgba(255,255,255,0.12);
  border-radius: 3px;
  height: 6px;
  overflow: hidden;
}
.bs-score-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.4s ease;
}
.bs-score-wellbeing  .bs-score-bar-fill { background: #4caf50; }
.bs-score-safety     .bs-score-bar-fill { background: #2196f3; }
.bs-score-ecology    .bs-score-bar-fill { background: #66bb6a; }
.bs-score-nuisance   .bs-score-bar-fill { background: #ff7043; }
#bs-hud-top .bs-balance { font-size: 16px; font-weight: 700; color: #ffd54f; }
#bs-hud-top .bs-time { flex: 1; text-align: center; font-size: 12px; color: #b0a080; }
#bs-hud-top .bs-speed-btn {
  cursor: pointer;
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 3px;
  padding: 2px 8px;
  color: #e8e0d0;
  font-size: 12px;
}
#bs-hud-top .bs-speed-btn:hover { background: rgba(255,255,255,0.2); }
#bs-hud-top .bs-weather { font-size: 18px; line-height: 1; }
.bs-event-badge {
  background: rgba(255,87,34,0.85);
  border-radius: 3px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  animation: bs-pulse 1.2s ease infinite;
}
@keyframes bs-pulse {
  0%,100% { opacity: 1; } 50% { opacity: 0.6; }
}

/* ─── Panels (shared) ─── */
.bs-panel-title {
  font-weight: 700;
  font-size: 13px;
  color: #ffd54f;
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(180,150,80,0.3);
  padding-bottom: 4px;
}
.bs-btn {
  cursor: pointer;
  border: none;
  border-radius: 3px;
  padding: 4px 10px;
  font-size: 12px;
  font-family: inherit;
  color: #e8e0d0;
  background: rgba(255,255,255,0.12);
  transition: background 0.15s;
}
.bs-btn:hover { background: rgba(255,255,255,0.22); }
.bs-btn-danger { background: rgba(200,50,30,0.55); }
.bs-btn-danger:hover { background: rgba(200,50,30,0.75); }
.bs-btn-primary { background: rgba(255,170,0,0.55); color: #fff; }
.bs-btn-primary:hover { background: rgba(255,170,0,0.75); }
.bs-select, .bs-input {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 3px;
  padding: 3px 6px;
  color: #e8e0d0;
  font-size: 12px;
  font-family: inherit;
  width: 100%;
}

/* ─── Blast plan UI ─── */
#bs-blast-panel { bottom: 10px; left: 10px; width: 220px; }
.bs-hole-row { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; font-size: 11px; }
.bs-hole-id { color: #ffd54f; font-weight: 600; width: 24px; }
.bs-charge-info { flex: 1; color: #b0a080; }
.bs-blast-btn { width: 100%; margin-top: 6px; font-size: 13px; font-weight: 700; padding: 6px; }
.bs-confirm-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
  z-index: 200;
}
.bs-confirm-box { background: #1a160d; border: 1px solid #c8a040; border-radius: 6px; padding: 20px; text-align: center; }
.bs-confirm-box p { margin-bottom: 14px; font-size: 15px; }
.bs-confirm-box .bs-btn { margin: 0 6px; }

/* ─── Contract UI ─── */
#bs-contract-panel { top: 44px; left: 10px; width: 300px; max-height: 60vh; overflow-y: auto; }
.bs-contract-row { border-bottom: 1px solid rgba(255,255,255,0.08); padding: 6px 0; font-size: 11px; }
.bs-contract-row:last-child { border-bottom: none; }
.bs-contract-btns { display: flex; gap: 4px; margin-top: 4px; }
.bs-progress-bar-bg { background: rgba(255,255,255,0.12); border-radius: 3px; height: 5px; margin-top: 3px; }
.bs-progress-bar-fill { height: 100%; background: #4caf50; border-radius: 3px; transition: width 0.4s; }

/* ─── Build menu ─── */
#bs-build-panel { top: 44px; left: 10px; width: 260px; }
.bs-build-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.bs-build-item {
  cursor: pointer; border: 1px solid rgba(255,255,255,0.15);
  border-radius: 4px; padding: 6px; text-align: center; font-size: 10px;
  background: rgba(255,255,255,0.05);
}
.bs-build-item:hover { background: rgba(255,255,255,0.12); }
.bs-build-item.selected { border-color: #ffd54f; background: rgba(255,213,79,0.15); }
.bs-build-icon { font-size: 18px; display: block; }
.bs-build-cost { color: #ffd54f; font-size: 10px; }
.bs-ghost-building {
  position: fixed; pointer-events: none; z-index: 150;
  background: rgba(0,255,100,0.3); border: 2px solid #00e676;
  border-radius: 3px;
}

/* ─── Vehicle & Employee panels ─── */
#bs-vehicle-panel, #bs-employee-panel { top: 44px; right: 170px; width: 280px; max-height: 55vh; overflow-y: auto; }
.bs-entity-row {
  display: flex; align-items: center; gap: 6px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  padding: 5px 0; font-size: 11px;
}
.bs-entity-row:last-child { border-bottom: none; }
.bs-entity-info { flex: 1; }
.bs-entity-name { font-weight: 600; color: #e8e0d0; }
.bs-entity-sub { color: #908070; font-size: 10px; }
.bs-hp-bar-bg { background: rgba(255,255,255,0.12); border-radius: 2px; height: 4px; width: 60px; }
.bs-hp-bar-fill { height: 100%; background: #4caf50; border-radius: 2px; transition: width 0.3s; }

/* ─── Event dialog ─── */
#bs-event-dialog {
  position: fixed; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.6); z-index: 300;
}
.bs-event-box {
  background: #1a160d; border: 1px solid #c8a040;
  border-radius: 8px; padding: 24px; max-width: 480px;
  width: 90%;
}
.bs-event-title { font-size: 16px; font-weight: 700; color: #ffd54f; margin-bottom: 10px; }
.bs-event-text { font-size: 13px; line-height: 1.6; color: #d0c8b8; margin-bottom: 16px; }
.bs-event-outcome { font-size: 12px; color: #a0e080; margin-bottom: 12px; font-style: italic; }
.bs-event-choices { display: flex; flex-direction: column; gap: 6px; }
.bs-event-choice { text-align: left; padding: 8px 12px; font-size: 12px; line-height: 1.4; }

/* ─── Survey UI ─── */
#bs-survey-panel { bottom: 10px; right: 170px; width: 220px; }
.bs-ore-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 11px; }
.bs-ore-bar-bg { flex: 1; background: rgba(255,255,255,0.12); border-radius: 3px; height: 8px; }
.bs-ore-bar-fill { height: 100%; border-radius: 3px; background: #ffd54f; }

/* ─── Settings menu ─── */
#bs-settings-panel { top: 50%; left: 50%; transform: translate(-50%,-50%); width: 300px; }
.bs-settings-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; gap: 8px; }
.bs-settings-label { color: #b0a080; font-size: 12px; }

/* ─── Mini-map ─── */
#bs-minimap { bottom: 10px; right: 10px; width: 150px; }
#bs-minimap-canvas { width: 130px; height: 130px; display: block; cursor: pointer; background: #1a2010; }

/* ─── Toolbar (panel toggle buttons) ─── */
#bs-toolbar {
  position: fixed; top: 44px; left: 10px;
  display: flex; flex-direction: column; gap: 4px;
  z-index: 100;
}
.bs-toolbar-btn {
  cursor: pointer; background: rgba(10,8,4,0.78);
  border: 1px solid rgba(180,150,80,0.35); border-radius: 4px;
  padding: 5px 10px; color: #e8e0d0; font-size: 12px;
  font-family: inherit; width: 100px; text-align: left;
  pointer-events: all;
}
.bs-toolbar-btn:hover { background: rgba(180,150,80,0.2); }
.bs-toolbar-btn.active { border-color: #ffd54f; color: #ffd54f; }
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
