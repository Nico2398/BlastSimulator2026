// BlastSimulator2026 — Browser entry point
// Initializes the 3D scene and exposes the console bridge for the screenshot script.

import { SceneManager } from './renderer/SceneManager.js';
import { createRunner } from './console/createRunner.js';

// --- 3D Scene ---
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const scene = new SceneManager(canvas);
scene.start();

// --- Console Bridge ---
// window.__gameConsole(cmd) routes commands to the same ConsoleRunner used in CLI mode.
// Required by scripts/screenshot.ts to drive the game from headless Chrome.
const { runner } = createRunner();

declare global {
  interface Window {
    __gameConsole: (cmd: string) => string;
  }
}

window.__gameConsole = (cmd: string): string => {
  const result = runner.run(cmd);
  return result.output;
};
