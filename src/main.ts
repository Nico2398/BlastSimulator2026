// BlastSimulator2026 — Browser entry point
// Initializes the 3D scene, UI, audio, save system, and exposes the console bridge.

import { SceneManager } from './renderer/SceneManager.js';
import { GameRenderer } from './renderer/GameRenderer.js';
import { UIManager } from './ui/UIManager.js';
import { SaveLoadUI } from './ui/SaveLoadUI.js';
import { TutorialOverlay } from './ui/TutorialOverlay.js';
import { TUTORIAL_STEPS } from './ui/tutorialSteps.js';
import { KeyboardShortcuts } from './ui/KeyboardShortcuts.js';
import { MainMenu } from './ui/MainMenu.js';
import { SandboxPanel } from './ui/SandboxPanel.js';
import { LoadingScreen } from './ui/LoadingScreen.js';
import type { CommandResult } from './console/ConsoleRunner.js';
import { AudioManager } from './audio/AudioManager.js';
import { AudioHooks } from './audio/AudioHooks.js';
import { IndexedDBPersistence } from './persistence/IndexedDBPersistence.js';
import { DownloadPersistence } from './persistence/DownloadPersistence.js';
import { createRunner, runCommand } from './console/createRunner.js';
import { parseCommand } from './console/ConsoleRunner.js';
import { regenerateGrid, restoreGrid, terrainGenDatum, DEFAULT_GRID_SIZE } from './console/commands/world.js';
import { encodeVoxelGrid } from './core/state/VoxelGridCodec.js';
import { getBiome } from './core/world/BiomeCatalog.js';
import { BASE_TICK_MS } from './core/engine/GameLoop.js';
import { probeUiActions, probeSelector } from './ui/uiActionProbe.js';
import { t } from './core/i18n/I18n.js';
import { summariseMuckPile } from './core/mining/MuckPileSummary.js';

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
saveLoadUI.setGetState(() => {
  // Embed the current voxel grid right before a save is taken (#458 T0.3) —
  // encoded lazily here rather than kept live on ctx.state, since most ticks
  // never save. SaveLoadUI only sees GameState; it has no idea VoxelGrid or
  // its codec exist, by design.
  if (ctx.state && ctx.grid && ctx.state.world) {
    ctx.state.world = { ...ctx.state.world, voxels: encodeVoxelGrid(ctx.grid, terrainGenDatum(ctx.state)) };
  }
  return ctx.state;
});

// --- Main Menu ---
const mainMenu = new MainMenu(uiContainer);
mainMenu.setOnNewCampaign(() => {
  // Show world map so the player can pick a level. The tutorial (if not yet
  // completed) triggers later, once a level is actually entered — starting it
  // here would stack its coach-marks on top of the level-selection cards.
  mainMenu.showWorldMap(null);
});
mainMenu.setOnStartLevel((levelId) => {
  // Ensure a base GameState (with campaign) exists before starting a level.
  const commands = ctx.state ? [] : ['new_game'];
  void enterLevel([...commands, `campaign start level:${levelId}`]).then(() => {
    // First-time players get tutorial guidance once their level is actually
    // loaded, not while still picking one from the world map.
    if (!TutorialOverlay.isCompleted()) tutorial.start(ctx.state ?? undefined);
  });
});
mainMenu.setOnLoad(() => { saveLoadUI.show(); });
mainMenu.setOnSettings(() => { uiManager.showPanel('settings'); });
// Settings is reachable from the main menu, so a language switch made there has
// to redraw the menu sitting underneath the panel as well as the panel itself.
uiManager.setLanguageChangeHandler(() => {
  mainMenu.refreshLocale();
  saveLoadUI.refreshLocale();
  saveLoadBtn.textContent = '💾 ' + t('ui.toolbar.saves');
});
mainMenu.show();

// --- Level loading ---
// Entering a level blocks the main thread for seconds. enterLevel splits that
// into phases the loading screen can paint between, so the wait reads as a
// load rather than a hang. Terrain generation and scene meshing are roughly
// half the cost each, which is why the renderer sync is deferred out of the
// command and run as its own phase.
const loadingScreen = new LoadingScreen(uiContainer);

function enterLevel(commands: readonly string[]): Promise<void> {
  return loadingScreen.runPhases([
    { run: () => { for (const cmd of commands) runGameCommand(cmd, { syncRenderer: false }); } },
    { run: () => { gameRenderer.syncFromContext(ctx); } },
  ]);
}

// --- Tutorial ---
const tutorial = new TutorialOverlay(uiContainer);
mainMenu.setOnTutorial(() => {
  mainMenu.hide();
  void enterLevel(['new_game seed:42 size:24', 'campaign start level:tutorial_pit'])
    .then(() => { tutorial.start(ctx.state ?? undefined); });
});

// --- Sandbox ---
const sandboxPanel = new SandboxPanel(uiContainer);
mainMenu.setOnSandbox(() => { mainMenu.hide(); sandboxPanel.show(); });
sandboxPanel.setOnBack(() => { mainMenu.show(); });
sandboxPanel.setOnStart((config) => {
  const explosives = config.availableExplosives.length > 0
    ? ` explosives:${config.availableExplosives.join(',')}`
    : '';
  void enterLevel([
    `sandbox start biome:${config.biome} seed:${config.seed} size:${config.size}` +
    ` depth:${config.depth} cash:${config.startingCash} goal:${config.unlockThreshold}` +
    ` events:${config.eventFreqMultiplier} prices:${config.contractPriceMultiplier}` +
    ` decay:${config.scoreDecayRate} mixed_rock:${config.mixedRockHardness}${explosives}`,
  ]);
});

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
  uiManager.showNotification?.(t('notification.bankruptcy_triggered', { cash: Math.floor(cash) }));
});
emitter.on('bankruptcy:warning', ({ ticksRemaining }) => {
  uiManager.showNotification?.(t('notification.bankruptcy_warning', { ticksRemaining }));
});
emitter.on('ecology:shutdown', () => {
  uiManager.showNotification?.(t('notification.ecology_shutdown'));
});
emitter.on('ecology:warning', ({ ticksRemaining }) => {
  uiManager.showNotification?.(t('notification.ecology_warning', { ticksRemaining }));
});
emitter.on('arrest:triggered', () => {
  uiManager.showNotification?.(t('notification.arrest_triggered'));
});
emitter.on('revolt:triggered', () => {
  uiManager.showNotification?.(t('notification.revolt_triggered'));
});
emitter.on('revolt:warning', ({ ticksRemaining }) => {
  uiManager.showNotification?.(t('notification.revolt_warning', { ticksRemaining }));
});
// Terrain mesh rebuild is event-driven, not command-name-matched: every voxel
// mutator (generation, blast, drill, ramp) emits this after mutating the grid
// (#458 T0.2). Runs synchronously inside runCommand(), before onBlast() below
// ever sees the command result — so onBlast() no longer needs its own remesh.
// Re-marches only the chunks the region touches (#458 T3.1) rather than the
// whole grid — a single drill dig no longer pays for a full terrain rebuild.
// A grid-identity change (new_game, campaign start, load) is handled
// separately by syncFromContext()'s own comparison, which runs right after
// this and does a full rebuildTerrain() with the new grid's real dimensions.
emitter.on('terrain:updated', ({ region }) => {
  gameRenderer.remeshTerrainRegion(ctx, region);
});
// Bird flocks near a blast panic and scatter for a few seconds (#458 T7.2/D12/A26).
emitter.on('blast:started', ({ originX, originZ }) => {
  gameRenderer.notifyBlastScatter(originX, originZ);
});

declare global {
  interface Window {
    __gameConsole: (cmd: string) => import('./console/ConsoleRunner.js').CommandResult;
    __gameState: () => Record<string, unknown> | null;
    __uiState: () => Record<string, unknown>;
    __cameraOrbit: (yaw: number, pitch: number) => void;
    __cameraFocus: (x: number, z: number, distance: number) => void;
    __cameraReset: () => void;
    __skipBlastPlayback: () => void;
    __seekBlastPlayback: (t: number) => void;
    __blastPlaybackDuration: () => number;
    __startTutorial: () => void;
    __uiActions: () => ReturnType<typeof probeUiActions>;
    __probeSelector: (selector: string) => ReturnType<typeof probeSelector>;
    __tutorialState: () => { active: boolean; stepIndex: number; stepId: string | null; title: string; total: number; stageIndex: number; stageTotal: number; stageTarget: string | null; clockHeld: boolean };
    __resetTickAccumulator: () => void;
    __setAutoTick: (enabled: boolean) => void;
    __setRenderEnabled: (enabled: boolean) => void;
    __renderFrame: () => void;
    __debugGridInfo: () => Record<string, unknown>;
  }
}

let lastCommandOutput = '';
const consoleLogs: string[] = [];

// Capture console.log for diagnostics
const origLog = console.log;
console.log = (...args: unknown[]) => {
  const msg = args.map(a => String(a)).join(' ');
  consoleLogs.push(msg);
  origLog.apply(console, args);
};

/**
 * Run a console command.
 *
 * `syncRenderer: false` runs everything except the scene rebuild, so a level
 * load can charge the player for generation and meshing as two separate
 * phases with a painted frame between them (see LoadingScreen). Only the
 * level-entry paths pass it; every other caller gets the immediate sync.
 */
function runGameCommand(cmd: string, opts?: { syncRenderer?: boolean }): CommandResult {
  const result = runCommand({ runner, ctx, emitter }, cmd);
  // Cap what __gameState relays: every harness round-trips this string over
  // CDP on every step, and an unbounded command output (a `state full` once
  // shipped 318 MB, #481) turns each of those reads into a protocol timeout.
  lastCommandOutput = result.output.length > 1_000_000
    ? `${result.output.slice(0, 1_000_000)}\n…[truncated ${result.output.length - 1_000_000} of ${result.output.length} chars]`
    : result.output;
  // Sync the renderer after every command so visual changes appear immediately
  if (opts?.syncRenderer !== false) gameRenderer.syncFromContext(ctx);
  const cmdName = parseCommand(cmd).command;

  // A fresh game replaces whatever the splash screen was showing — the normal
  // click paths (world map "Start", tutorial button) already call
  // mainMenu.hide() themselves, but `new_game` run directly (console mode,
  // scenario harness) bypassed that and left the overlay covering the canvas.
  if (cmdName === 'new_game' && result.success) {
    mainMenu.hide();
  }

  // Trigger blast effects after a blast (terrain remesh already happened via
  // the terrain:updated subscription above, fired from inside executeBlast).
  if (cmdName === 'blast' && result.success && ctx.state) {
    gameRenderer.onBlast(ctx);
    audioHooks.onBlast(ctx.state.sequenceDelays);
  }
  // Show blast plan overlay during planning commands, and refresh it whenever
  // a preview command runs or software tier changes — otherwise the overlay's
  // softwareTier and preview data are frozen at whatever the last drill_plan/
  // charge/sequence call baked in, and a purchased tier's overlay never appears.
  if (['drill_plan', 'charge', 'sequence', 'preview', 'buy_software', 'blast_preview'].includes(cmdName)) {
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
  if (ctx.state) tutorial.onCommandExecuted(ctx.state);
  return result;
}

window.__gameConsole = (cmd: string) => runGameCommand(cmd);

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
    // The site's live bounding box, so a harness can map grid coordinates to
    // the tile picker without inferring them from a terrain bounding box that
    // blasts and ramps change underneath it. Size is a bounding box, not a
    // size, once the site has grown (#473) — hence the origin alongside it.
    worldSizeX: s.world?.sizeX ?? null,
    worldSizeZ: s.world?.sizeZ ?? null,
    worldMinX: s.world?.minX ?? null,
    worldMinZ: s.world?.minZ ?? null,
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
    // Qualifications the roster holds, so a playtest can prove a skill was
    // actually obtained rather than that a button merely looked clickable.
    qualificationCount: s.employees.employees
      .reduce((n, e) => n + e.qualifications.length, 0),
    proficiencyTotal: s.employees.employees
      .reduce((n, e) => n + e.qualifications.reduce((m, q) => m + q.proficiencyLevel, 0), 0),
    trainingCount: s.employees.employees.filter(e => e.trainingState !== null).length,
    levelEnded: s.levelEnded,
    levelEndReason: s.levelEndReason,
    // ── Game-over detection fields ──
    bankrupt: s.bankruptcy.bankrupt,
    revolted: s.revolt.revolted,
    ecologicalShutdown: s.ecological.shutdown,
    arrested: s.arrest.arrested,
    cash: s.cash,
    profit: s.levelStats?.totalWealth ?? 0,
    muckPile: ctx.grid
      ? summariseMuckPile(s.logistics.fragments.map(f => f.fragment), ctx.grid)
      : null,
    lastCommandOutput,
    frameCount: scene.frameCount,
    ctxGridId: ctx.grid?.id ?? null,
    consoleLogs: consoleLogs.splice(0, 50),
    // Sample voxels at blast center to check if they're cleared
    gridSample: ctx.grid ? (() => {
      const g = ctx.grid;
      const sample: Record<string, number> = {};
      for (let y = 0; y < Math.min(g.sizeY, 10); y++) {
        const v = g.getVoxel(15, y, 15);
        sample[`15,${y},15`] = v?.density ?? -1;
      }
      return sample;
    })() : null,
    // Cross-section: sample a line of columns at y=0,1,2 through the blast center
    gridCrossSection: ctx.grid ? (() => {
      const g = ctx.grid;
      const xs = [10,11,12,13,14,15,16,17,18,19,20,21,22];
      const sample: Record<string, number> = {};
      for (const x of xs) {
        for (let y = 0; y < Math.min(g.sizeY, 6); y++) {
          const v = g.getVoxel(x, y, 15);
          sample[`${x},${y},15`] = v?.density ?? -1;
        }
      }
      return sample;
    })() : null,
    // Terrain mesh bounding box from Three.js geometry
    meshBounds: gameRenderer.terrain?.getBounds() ?? null,
  };
};

window.__resetTickAccumulator = () => { accumulatedGameMs = 0; };

// A Puppeteer-driven run (scenario/interaction mode, playtest) navigates with
// `?scenarioMode=1` so only its own scripted `tick N` commands advance
// simulation time — otherwise the render loop's own real-time ticking races
// scripted checkpoints and desyncs them (see #406). Exposed as a bridge too,
// for a mode that wants to flip it after load.
let autoTickEnabled = new URLSearchParams(window.location.search).get('scenarioMode') !== '1';
window.__setAutoTick = (enabled: boolean) => { autoTickEnabled = enabled; };

// Drawing control for the browser-driven harnesses (#475). They need pixels
// only at a screenshot, but every CDP call they make waits on the render
// loop — which the terrain material makes cost seconds per frame in software
// rasterisation. Suspending the draw and forcing one frame per capture keeps
// the images identical and stops the suites paying for frames nobody sees.
window.__setRenderEnabled = (enabled: boolean) => { scene.setDrawingEnabled(enabled); };
window.__renderFrame = () => { scene.renderFrame(); };

// Debug: expose grid reference info for diagnostics
window.__debugGridInfo = () => {
  return {
    ctxGridId: ctx.grid?.id ?? null,
    lastGridId: gameRenderer.lastGridId,
    terrainGridId: gameRenderer.terrain?.gridId ?? null,
    ghostCount: gameRenderer.ghostCount,
    ghostPreviewsInState: ctx.state?.ghostPreviews.length ?? -1,
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

// What can a player actually click right now? Used by the playtest harness so a
// failure reports "Run is disabled because <hint>" rather than a selector timeout.
window.__uiActions = () => probeUiActions();
window.__probeSelector = (selector: string) => probeSelector(selector);

// Where the tutorial believes it is. A harness that only checks for thrown
// errors cannot tell a completed step from a silently stuck one.
window.__tutorialState = () => {
  const el = document.querySelector('.bs-tutorial-box .bs-panel-title');
  const counter = document.querySelector('.bs-tutorial-progress');
  const parsed = /(\d+)\s*\/\s*(\d+)/.exec(counter?.textContent ?? '');
  const stage = tutorial.stageProgress;
  const paused = document.querySelector('.bs-tutorial-paused') as HTMLElement | null;
  return {
    active: tutorial.isActive,
    stepIndex: parsed ? Number(parsed[1]) - 1 : -1,
    stepId: TUTORIAL_STEPS[parsed ? Number(parsed[1]) - 1 : -1]?.id ?? null,
    title: el?.textContent ?? '',
    total: parsed ? Number(parsed[2]) : 0,
    // Which click of the step the player is on — a step is several controls,
    // and a harness that only knew the step could not tell them apart.
    stageIndex: stage.index,
    stageTotal: stage.total,
    stageTarget: stage.target,
    clockHeld: paused !== null && paused.style.display !== 'none',
  };
};

// Camera control bridges (used by scenario-test.ts for multi-angle screenshots)
window.__cameraOrbit = (yaw: number, pitch: number) => {
  scene.cameraController.setOrbit(yaw, pitch);
};
// Centre + zoom the camera on a world (x, z) point at the correct terrain
// height, for shots that need to frame a specific feature (e.g. a ramp)
// rather than the whole-site default view (#410).
window.__cameraFocus = (x: number, z: number, distance: number) => {
  scene.cameraController.focus(x, gameRenderer.surfaceYAt(x, z), z, distance);
};
window.__cameraReset = () => {
  scene.cameraController.reset();
};
// Put the collapse straight on its resting place, for shots of the settled muck
// pile. The animation only walks rock to where the blast already put it, so
// skipping it changes nothing — and without a GPU it would otherwise take
// minutes of wall clock to play out (#475).
window.__skipBlastPlayback = () => {
  gameRenderer.skipFragmentPlayback();
};
// Hold the collapse at a chosen moment, so a harness can step through it at the
// spacing the pictures need rather than the spacing the frame rate allows.
window.__seekBlastPlayback = (t: number) => {
  gameRenderer.seekFragmentPlayback(t);
};
window.__blastPlaybackDuration = () => gameRenderer.fragmentPlaybackDuration;

uiManager.setGameConsole(window.__gameConsole);
tutorial.setGameConsole(window.__gameConsole);

// Tutorial start bridge (Puppeteer) + console command (scenario tests)
window.__startTutorial = () => tutorial.start(ctx.state ?? undefined);
runner.register('tutorial_start', 'Start the tutorial overlay', () => {
  window.__startTutorial();
  return { success: true, output: 'Tutorial started' };
});
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

// Save/Load button (fixed top bar, visible during gameplay). The Settings
// panel's own Save/Load buttons only fire the bare `save`/`load` console
// commands — this is the only in-game path to the full slot-list panel
// (multiple slots, auto-save indicator, export/import), which was previously
// reachable only from the main menu's "Load" button before a game existed (#408).
const saveLoadBtn = document.createElement('button');
saveLoadBtn.id = 'bs-saveload-btn';
saveLoadBtn.className = 'bs-btn bs-return-map';
saveLoadBtn.style.cssText = 'position:fixed;top:8px;right:250px;z-index:300;font-size:10px;padding:3px 8px';
saveLoadBtn.textContent = '💾 ' + t('ui.toolbar.saves');
saveLoadBtn.addEventListener('click', () => saveLoadUI.show());
uiContainer.appendChild(saveLoadBtn);

saveLoadUI.setOnLoad((state) => {
  // Restore loaded state into the runner context. A v6+ save carries its
  // voxel grid embedded in state.world.voxels (#458 T0.3) — restoring from
  // it preserves blast craters/ramps instead of discarding them. A save
  // without that payload (pre-v6, or one taken with no grid) falls back to
  // regenerating pristine terrain from seed, same as the console `load`
  // command and this codebase's whole prior history here (#408).
  ctx.state = state;
  const biome = getBiome(state.mineType);
  if (state.world?.voxels) {
    restoreGrid(ctx, state.world.voxels);
  } else if (biome) {
    const { sizeX, sizeY, sizeZ } = state.world ?? {
      sizeX: DEFAULT_GRID_SIZE, sizeY: DEFAULT_GRID_SIZE, sizeZ: DEFAULT_GRID_SIZE, gridReady: true,
    };
    regenerateGrid(ctx, { seed: state.seed, climateBias: biome.climateCenter, sizeX, sizeY, sizeZ });
  }
  gameRenderer.syncFromContext(ctx);
});

// --- Keyboard Shortcuts ---
new KeyboardShortcuts({
  togglePause: () => window.__gameConsole('pause'),
  setSpeed: (n) => window.__gameConsole(`speed ${n}`),
  togglePanel: (name) => uiManager.togglePanel(name),
  quickSave: () => { if (ctx.state) void saveLoadUI['autoSave'](ctx.state); },
  openSettings: () => uiManager.togglePanel('settings'),
  onToggleNavGrid: () => uiManager.toggleNavGridOverlay(),
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
  if (ctx.state && !ctx.state.isPaused && autoTickEnabled) {
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
