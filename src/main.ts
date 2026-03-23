// BlastSimulator2026 — Browser entry point
// Initializes the 3D scene, UI, audio, save system, and exposes the console bridge.

import { SceneManager } from './renderer/SceneManager.js';
import { GameRenderer } from './renderer/GameRenderer.js';
import { UIManager } from './ui/UIManager.js';
import { SaveLoadUI } from './ui/SaveLoadUI.js';
import { TutorialOverlay } from './ui/TutorialOverlay.js';
import { KeyboardShortcuts } from './ui/KeyboardShortcuts.js';
import { MainMenu } from './ui/MainMenu.js';
import { AudioManager } from './audio/AudioManager.js';
import { AudioHooks } from './audio/AudioHooks.js';
import { IndexedDBPersistence } from './persistence/IndexedDBPersistence.js';
import { DownloadPersistence } from './persistence/DownloadPersistence.js';
import { createRunner } from './console/createRunner.js';
import { BASE_TICK_MS } from './core/engine/GameLoop.js';

// --- 3D Scene ---
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const scene = new SceneManager(canvas);

// --- Game Renderer (bridges console commands → Three.js) ---
const gameRenderer = new GameRenderer(scene);

// --- UI ---
const uiContainer = document.getElementById('bs-ui-root') ?? document.body;
const uiManager = new UIManager(uiContainer);

// --- Persistence ---
let saveBackend;
try {
  saveBackend = new IndexedDBPersistence();
} catch {
  saveBackend = new DownloadPersistence();
}

// --- Save/Load UI ---
const saveLoadUI = new SaveLoadUI(uiContainer);
saveLoadUI.setBackend(saveBackend);
saveLoadUI.setGetState(() => ctx.state);

// --- Main Menu ---
const mainMenu = new MainMenu(uiContainer);
mainMenu.setOnNewCampaign(() => {
  // Show world map so the player can pick a level.
  // Tutorial overlay sits on top and doesn't block the map.
  mainMenu.showWorldMap(null);
  if (!TutorialOverlay.isCompleted()) tutorial.start();
});
mainMenu.setOnStartLevel((levelId) => {
  // Ensure a base GameState (with campaign) exists before starting a level.
  if (!ctx.state) window.__gameConsole('new_game');
  window.__gameConsole(`campaign start level:${levelId}`);
});
mainMenu.setOnLoad(() => { saveLoadUI.show(); });
mainMenu.setOnSettings(() => { uiManager.showPanel('settings'); });
mainMenu.show();

// --- Tutorial ---
const tutorial = new TutorialOverlay(uiContainer);

// --- Audio ---
const audioMgr = new AudioManager();
const audioHooks = new AudioHooks(audioMgr);
// Resume AudioContext on first user interaction (browser autoplay policy)
document.addEventListener('pointerdown', () => {
  audioMgr.resume().then(() => audioHooks.startAmbient());
}, { once: true });

// --- Console Bridge ---
// window.__gameConsole(cmd) routes commands to the same ConsoleRunner used in CLI mode.
// Required by scripts/screenshot.ts to drive the game from headless Chrome.
const { runner, ctx, emitter } = createRunner();

// --- Subscribe to game-over emitter events for UI notifications ---
emitter.on('bankruptcy:triggered', ({ cash }) => {
  uiManager.showNotification?.(`💸 BANKRUPTCY! Cash: $${Math.floor(cash)}. Level failed.`);
});
emitter.on('bankruptcy:warning', ({ ticksRemaining }) => {
  uiManager.showNotification?.(`⚠️ Low funds! Bankruptcy in ${ticksRemaining} ticks.`);
});
emitter.on('ecology:shutdown', () => {
  uiManager.showNotification?.('🌿 ECOLOGICAL SHUTDOWN! Government closed the mine. Level failed.');
});
emitter.on('ecology:warning', ({ ticksRemaining }) => {
  uiManager.showNotification?.(`⚠️ Ecological violation! Shutdown in ${ticksRemaining} ticks.`);
});
emitter.on('arrest:triggered', () => {
  uiManager.showNotification?.('🚔 CRIMINAL ARREST! Mafia exposure too high. Level failed.');
});
emitter.on('revolt:triggered', () => {
  uiManager.showNotification?.('✊ WORKER REVOLT! Permanent strike declared. Level failed.');
});
emitter.on('revolt:warning', ({ ticksRemaining }) => {
  uiManager.showNotification?.(`⚠️ Workers furious! Revolt in ${ticksRemaining} ticks.`);
});

declare global {
  interface Window {
    __gameConsole: (cmd: string) => string;
    __gameState: () => Record<string, unknown> | null;
    __uiState: () => Record<string, unknown>;
  }
}

window.__gameConsole = (cmd: string): string => {
  const result = runner.run(cmd);
  // Sync the renderer after every command so visual changes appear immediately
  gameRenderer.syncFromContext(ctx);
  const cmdName = cmd.trim().split(/\s+/)[0] ?? '';

  // Trigger blast effects and terrain rebuild after a blast
  if (cmdName === 'blast' && result.success && ctx.state) {
    gameRenderer.onBlast(ctx);
    audioHooks.onBlast(ctx.state.sequenceDelays);
  }
  // Show blast plan overlay during planning commands
  if (['drill_plan', 'charge', 'sequence'].includes(cmdName)) {
    gameRenderer.showBlastPlanOverlay(ctx);
  }
  // UI click sound for any command
  audioHooks.onUIClick();

  // Weather change audio
  if (ctx.weatherCycle) {
    audioHooks.onWeatherChange(ctx.weatherCycle.current);
  }

  // Update UI after every command
  if (ctx.state) uiManager.update(ctx.state, ctx.weatherCycle?.current);
  return result.output;
};

// --- State extraction bridges (used by scenario tests) ---
window.__gameState = () => {
  if (!ctx.state) return null;
  const s = ctx.state;
  return {
    seed: s.seed,
    time: s.time,
    tickCount: s.tickCount,
    isPaused: s.isPaused,
    mineType: s.mineType,
    drillHoles: s.drillHoles,
    chargesByHole: s.chargesByHole,
    sequenceDelays: s.sequenceDelays,
    finances: { cash: s.finances.cash },
    holeCount: s.drillHoles.length,
    chargedCount: Object.keys(s.chargesByHole).length,
    sequencedCount: Object.keys(s.sequenceDelays).length,
    buildingCount: s.buildings.buildings.length,
    vehicleCount: s.vehicles.vehicles.length,
    employeeCount: s.employees.employees.length,
    levelEnded: s.levelEnded,
    levelEndReason: s.levelEndReason,
  };
};

window.__uiState = () => {
  const panels = ['bs-blast-panel', 'bs-contract-panel', 'bs-build-panel',
    'bs-vehicle-panel', 'bs-employee-panel', 'bs-survey-panel'];
  const panelStates: Record<string, unknown> = {};
  for (const id of panels) {
    const el = document.getElementById(id);
    if (el) {
      const computed = getComputedStyle(el);
      panelStates[id] = {
        display: computed.display,
        pointerEvents: computed.pointerEvents,
        visible: computed.display !== 'none',
      };
    }
  }
  // Check all buttons in blast panel
  const blastPanel = document.getElementById('bs-blast-panel');
  const buttons: Record<string, unknown>[] = [];
  if (blastPanel) {
    blastPanel.querySelectorAll('button').forEach(btn => {
      const computed = getComputedStyle(btn);
      buttons.push({
        text: btn.textContent,
        display: computed.display,
        pointerEvents: computed.pointerEvents,
        disabled: btn.disabled,
        offsetWidth: btn.offsetWidth,
        offsetHeight: btn.offsetHeight,
      });
    });
  }
  return { panels: panelStates, blastPanelButtons: buttons };
};

uiManager.setGameConsole(window.__gameConsole);
uiManager.setSpeedChangeHandler((speed) => {
  window.__gameConsole(`time speed ${speed}`);
});
uiManager.setQuitHandler(() => {
  mainMenu.show();
});

// Return-to-map button (fixed top bar, visible during gameplay)
mainMenu.makeReturnToMapButton(uiContainer, () => {
  mainMenu.show();
  mainMenu.showWorldMap(ctx.state?.campaign ?? null);
});
saveLoadUI.setOnLoad((state) => {
  // Restore loaded state into the runner context
  ctx.state = state;
  gameRenderer.syncFromContext(ctx);
});

// --- Keyboard Shortcuts ---
new KeyboardShortcuts({
  togglePause: () => window.__gameConsole('pause'),
  setSpeed: (n) => window.__gameConsole(`speed ${n}`),
  togglePanel: (name) => uiManager.togglePanel(name as any),
  quickSave: () => { if (ctx.state) void saveLoadUI['autoSave'](ctx.state); },
  openSettings: () => uiManager.togglePanel('settings'),
});

// --- Render loop + game tick timer ---
// The game ticks at BASE_TICK_MS intervals, adjusted for time scale.
// At 1x speed: 1 tick/second. At 4x: 4 ticks/second.
// Accumulated time prevents tick drift from frame-rate variation.
let accumulatedGameMs = 0;
let hadPendingEvent = false;

scene.start((dt) => {
  gameRenderer.update(dt);

  // Advance game time
  if (ctx.state && !ctx.state.isPaused) {
    accumulatedGameMs += dt * 1000;
    // Tick every BASE_TICK_MS ms; timeScale is handled inside tickCommand
    while (accumulatedGameMs >= BASE_TICK_MS) {
      accumulatedGameMs -= BASE_TICK_MS;
      window.__gameConsole(`tick ${ctx.state.timeScale}`);
      // Stop if game paused mid-loop (e.g. an event fired)
      if (ctx.state.isPaused) {
        accumulatedGameMs = 0;
        break;
      }
    }
  }

  // Play chime when a new pending event appears
  if (ctx.state) {
    const hasPendingEvent = !!ctx.state.events.pendingEvent;
    if (hasPendingEvent && !hadPendingEvent) {
      audioHooks.onEventNotification();
    }
    hadPendingEvent = hasPendingEvent;
  }

  // Update UI from current state on each frame
  if (ctx.state) {
    uiManager.update(ctx.state, ctx.weatherCycle?.current);
    saveLoadUI.onTick(ctx.state);
  }
});
