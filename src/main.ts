// BlastSimulator2026 — Browser entry point
// Initializes the 3D scene, UI, audio, and exposes the console bridge.

import { SceneManager } from './renderer/SceneManager.js';
import { GameRenderer } from './renderer/GameRenderer.js';
import { UIManager } from './ui/UIManager.js';
import { AudioManager } from './audio/AudioManager.js';
import { AudioHooks } from './audio/AudioHooks.js';
import { createRunner } from './console/createRunner.js';

// --- 3D Scene ---
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const scene = new SceneManager(canvas);

// --- Game Renderer (bridges console commands → Three.js) ---
const gameRenderer = new GameRenderer(scene);

// --- UI ---
const uiContainer = document.getElementById('bs-ui-root') ?? document.body;
const uiManager = new UIManager(uiContainer);

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
const { runner, ctx } = createRunner();

declare global {
  interface Window {
    __gameConsole: (cmd: string) => string;
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

uiManager.setGameConsole(window.__gameConsole);
uiManager.setSpeedChangeHandler((speed) => {
  window.__gameConsole(`speed ${speed}`);
});

// --- Render loop ---
scene.start((dt) => {
  gameRenderer.update(dt);
  // Update UI from current state on each frame
  if (ctx.state) uiManager.update(ctx.state, ctx.weatherCycle?.current);
});
