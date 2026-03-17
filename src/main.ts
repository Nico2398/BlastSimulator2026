// BlastSimulator2026 — Browser entry point
// Initializes the 3D scene, UI, and exposes the console bridge.

import { SceneManager } from './renderer/SceneManager.js';
import { GameRenderer } from './renderer/GameRenderer.js';
import { UIManager } from './ui/UIManager.js';
import { createRunner } from './console/createRunner.js';

// --- 3D Scene ---
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const scene = new SceneManager(canvas);

// --- Game Renderer (bridges console commands → Three.js) ---
const gameRenderer = new GameRenderer(scene);

// --- UI ---
const uiContainer = document.getElementById('bs-ui-root') ?? document.body;
const uiManager = new UIManager(uiContainer);

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
  // Trigger blast effects and terrain rebuild after a blast
  const cmdName = cmd.trim().split(/\s+/)[0] ?? '';
  if (cmdName === 'blast' && result.success) {
    gameRenderer.onBlast(ctx);
  }
  // Show blast plan overlay during planning commands
  if (['drill_plan', 'charge', 'sequence'].includes(cmdName)) {
    gameRenderer.showBlastPlanOverlay(ctx);
  }
  // Update UI after every command
  if (ctx.state) uiManager.update(ctx.state);
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
  if (ctx.state) uiManager.update(ctx.state);
});
