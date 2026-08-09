// BlastSimulator2026 — Browser entry point
// Initializes the 3D scene, UI, audio, save system, and exposes the console bridge.

import * as THREE from 'three';
import { SceneManager } from './renderer/SceneManager.js';
import { GameRenderer } from './renderer/GameRenderer.js';
import { UIManager } from './ui/UIManager.js';
import { SavesModal } from './ui/panels/SavesModal.js';
import { TutorialOverlay } from './ui/TutorialOverlay.js';
import { TUTORIAL_STEPS } from './ui/tutorialSteps.js';
import { KeyboardShortcuts } from './ui/KeyboardShortcuts.js';
import { MainMenu } from './ui/MainMenu.js';
import { WorldMap } from './ui/screens/WorldMap.js';
import { LevelEndScreen } from './ui/screens/LevelEndScreen.js';
import { SandboxPanel } from './ui/SandboxPanel.js';
import { LoadingScreen } from './ui/LoadingScreen.js';
import type { LoadingSiteInfo } from './ui/LoadingScreen.js';
import type { CommandResult } from './console/ConsoleRunner.js';
import { getLevel, getAllLevels, type LevelDef } from './core/campaign/Level.js';
import { formatMoney } from './core/economy/formatMoney.js';
import { SANDBOX_DEFAULTS, sandboxLevelDef, type SandboxConfig } from './core/campaign/Sandbox.js';
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
import { t, getLocale, setLocale, type Locale } from './core/i18n/I18n.js';
import { ScenePicking } from './ui/scene/ScenePicking.js';
import { HoverTag } from './ui/scene/HoverTag.js';
import { SelectionBar } from './ui/shell/SelectionBar.js';
import { EntityHighlight } from './renderer/EntityHighlight.js';
import { PlacementController } from './ui/scene/PlacementController.js';
import { ParamStrip } from './ui/scene/ParamStrip.js';
import { SelectionOverlay } from './renderer/SelectionOverlay.js';
import { regionCenter, regionSpan, type TileRegion } from './ui/tutorialPickerRegion.js';
import { createWeatherCycle } from './core/weather/WeatherCycle.js';
import { Random } from './core/math/Random.js';
import { summariseMuckPile } from './core/mining/MuckPileSummary.js';

// --- 3D Scene ---
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const scene = new SceneManager(canvas);

// --- Game Renderer (bridges console commands → Three.js) ---
const gameRenderer = new GameRenderer(scene);

// --- UI ---
const uiContainer = document.getElementById('bs-ui-root') ?? document.body;
const uiManager = new UIManager(uiContainer);

// --- Scene picking: hover tags, click-to-select, selection bar (redesign P2) ---
// Declared here (with the other core objects) but wired further down, once
// window.__gameConsole/t()/ctx are ready — same declare-early/wire-when-ready
// shape the rest of this file already uses for uiManager itself.
const scenePicking = new ScenePicking(canvas, scene.camera, gameRenderer);
const entityHighlight = new EntityHighlight(scene.scene);
const hoverTag = new HoverTag(uiContainer, canvas, scene.camera);
const selectionBar = new SelectionBar(uiContainer);

/**
 * How far back the camera sits to frame a guided placement region.
 *
 * Scales with the region so a 13-tile ramp corridor is not framed half
 * off-screen. The floor is what matters for a one-tile target: closer than
 * this, the game's ground-level camera sits low enough that a tile near the
 * edge of the map is grazed rather than faced by its own camera ray, and the
 * click lands on no tile at all. It also keeps the target clear of the
 * bottom-docked strip and the tutorial card.
 */
const PLACEMENT_FRAMING_MIN_DISTANCE = 40;
const placementFramingDistance = (region: TileRegion): number =>
  Math.max(PLACEMENT_FRAMING_MIN_DISTANCE, regionSpan(region) * 3.5);

// --- In-scene placement (redesign P3): the grid-select tool that replaced the 2D tile picker ---
const placementController = new PlacementController(canvas, scene.camera, gameRenderer, scene.cameraController);
const selectionOverlay = new SelectionOverlay(scene.scene, (x, z) => gameRenderer.surfaceYAt(x, z));
const paramStrip = new ParamStrip(uiContainer);
placementController.setArmedStateHandler((armed) => {
  // Entity hover/select would otherwise fight the placement tool for the same clicks.
  scenePicking.setEnabled(!armed);
  // The canvas itself is always on screen, armed or not — tutorialStages.ts's
  // picker-canvas stage target needs a signal that actually means "the tool
  // is ready for a tile click now," not "the canvas element exists."
  document.body.classList.toggle('bs-placement-armed', armed);

  const region = armed ? placementController.activeRegion : null;
  selectionOverlay.setRegion(region);
  // Frame the target before the player looks for it. A guided region can open
  // off-screen, or low enough that the docked strip and the tutorial card cover
  // it — clicks there land on DOM instead of the terrain and the tile "does not
  // respond" (#489). Both playtest and scenario definitions used to paper over
  // this with their own camera moves, which is exactly the path a player's
  // mouse does not take.
  if (region) {
    const { x, z } = regionCenter(region);
    scene.cameraController.focus(x, gameRenderer.surfaceYAt(x, z), z, placementFramingDistance(region));
  }
});
// Kept separate from the panels' own change handlers: which panel armed the
// tool must not decide whether the guided region and the refused tile are drawn.
placementController.setFeedbackHandler(() => {
  selectionOverlay.setBlockedTile(placementController.refusedTile);
});
// ParamStrip only renders what it's told; pressing its own CONFIRM/ESC buttons
// has to reach back into the controller that armed it.
paramStrip.setConfirmHandler(() => placementController.confirm());
paramStrip.setCancelHandler(() => placementController.cancel());
uiManager.setPlacementKit({ controller: placementController, overlay: selectionOverlay, strip: paramStrip });

// Survey confidence overlay's player-facing visibility toggle (#496): the
// panel's own click handler drives the renderer; the renderer's current
// preference seeds the panel once at startup so its button state matches.
uiManager.setSurveyOverlayToggleHandler((visible) => { gameRenderer.setSurveyOverlayVisible(visible); });
uiManager.setSurveyOverlayVisible(gameRenderer.surveyOverlayVisible);

// --- Persistence ---
let saveBackend;
try {
  saveBackend = new IndexedDBPersistence();
} catch {
  saveBackend = new DownloadPersistence();
}

// --- Saves Modal (redesign P8) ---
const savesModal = new SavesModal(uiContainer);
savesModal.setBackend(saveBackend);
savesModal.setGetState(() => {
  // Embed the current voxel grid right before a save is taken (#458 T0.3) —
  // encoded lazily here rather than kept live on ctx.state, since most ticks
  // never save. SavesModal only sees GameState; it has no idea VoxelGrid or
  // its codec exist, by design.
  if (ctx.state && ctx.grid && ctx.state.world) {
    ctx.state.world = { ...ctx.state.world, voxels: encodeVoxelGrid(ctx.grid, terrainGenDatum(ctx.state)) };
  }
  return ctx.state;
});

// --- Main Menu ---
const mainMenu = new MainMenu(uiContainer);
mainMenu.setBackend(saveBackend);
mainMenu.setOnNewCampaign(() => {
  // Show world map so the player can pick a level. The tutorial (if not yet
  // completed) triggers later, once a level is actually entered — starting it
  // here would stack its coach-marks on top of the level-selection cards.
  mainMenu.hide();
  worldMap.show(null);
});
mainMenu.setOnContinue((slotId) => {
  mainMenu.hide();
  void savesModal.loadFromSlot(slotId);
});
mainMenu.setOnLoad(() => { savesModal.show(); });
mainMenu.setOnSettings(() => { uiManager.showPanel('settings'); });
// Settings is reachable from the main menu, so a language switch made there has
// to redraw the menu sitting underneath the panel as well as the panel itself.
uiManager.setLanguageChangeHandler(() => {
  mainMenu.refreshLocale();
  worldMap.refreshLocale();
  levelEndScreen.refreshLocale();
  savesModal.refreshLocale();
  selectionBar.refreshLocale();
  tutorial.refreshLocale();
});
// Symmetric with the above: a language switch made from the main menu's own
// EN/FR pills has to reach uiManager's owned tree (settings panel included)
// and every sibling screen, the same set uiManager's handler refreshes.
mainMenu.setOnLanguageChange(() => {
  uiManager.refreshLocale();
  worldMap.refreshLocale();
  levelEndScreen.refreshLocale();
  savesModal.refreshLocale();
  selectionBar.refreshLocale();
  tutorial.refreshLocale();
});
mainMenu.show();

// --- World Map ("The Portfolio") ---
const worldMap = new WorldMap(uiContainer);
worldMap.setOnBack(() => {
  worldMap.hide();
  mainMenu.show();
});
worldMap.setOnStartLevel((levelId) => {
  worldMap.hide();
  // Ensure a base GameState (with campaign) exists before starting a level.
  const commands = ctx.state ? [] : ['new_game'];
  const level = getLevel(levelId);
  void enterLevel([...commands, `campaign start level:${levelId}`], level ? buildLoadingSiteInfo(level) : undefined).then(() => {
    // First-time players get tutorial guidance once their level is actually
    // loaded, not while still picking one from the world map.
    if (!TutorialOverlay.isCompleted()) tutorial.start(ctx.state ?? undefined);
  });
});

// --- Level End Screen (redesign P8) ---
const levelEndScreen = new LevelEndScreen(uiContainer);
levelEndScreen.setOnReplay((levelId) => {
  levelEndScreen.hide();
  const level = getLevel(levelId);
  void enterLevel([`campaign start level:${levelId}`], level ? buildLoadingSiteInfo(level) : undefined);
});
levelEndScreen.setOnContinue((nextLevelId) => {
  levelEndScreen.hide();
  const level = getLevel(nextLevelId);
  void enterLevel([`campaign start level:${nextLevelId}`], level ? buildLoadingSiteInfo(level) : undefined);
});
levelEndScreen.setOnBackToPortfolio(() => {
  levelEndScreen.hide();
  worldMap.show(ctx.state?.campaign ?? null);
});

// --- Level loading ---
// Entering a level blocks the main thread for seconds. enterLevel splits that
// into phases the loading screen can paint between, so the wait reads as a
// load rather than a hang. Terrain generation and scene meshing are roughly
// half the cost each, which is why the renderer sync is deferred out of the
// command and run as its own phase.
const loadingScreen = new LoadingScreen(uiContainer);

/**
 * Biome id (campaign LevelDef.biome / SandboxConfig.biome) → loading screen
 * eyebrow category key. Mirrors WorldMap's own BIOME_STYLE categorisation
 * (screens/WorldMap.ts) — small local duplication of a 3-entry map rather
 * than exporting WorldMap's private table for one caller (#493).
 */
const BIOME_CATEGORY_KEY: Record<string, string> = {
  desert_badlands: 'ui.portfolio.biome.desert',
  alpine_granite: 'ui.portfolio.biome.mountain',
  tropical_karst: 'ui.portfolio.biome.tropical',
};
const DEFAULT_BIOME_CATEGORY_KEY = 'ui.portfolio.biome.mountain';

/** Loading screen content (eyebrow/subtitle/briefing) for a campaign level entry. */
function buildLoadingSiteInfo(level: LevelDef): LoadingSiteInfo {
  return {
    siteNumber: level.difficultyTier,
    biomeCategoryKey: BIOME_CATEGORY_KEY[level.biome] ?? DEFAULT_BIOME_CATEGORY_KEY,
    difficulty: level.difficultyTier,
    descriptionKey: level.descKey,
    briefing: [
      { labelKey: 'loading.brief.starting_cash', value: `$${formatMoney(level.startingCash)}` },
      { labelKey: 'loading.brief.target', value: `$${formatMoney(level.unlockThreshold)}` },
      { labelKey: 'loading.brief.explosives', value: String(level.availableExplosives.length) },
    ],
  };
}

/** Loading screen content for a sandbox site — no site number, no difficulty pips. */
function buildSandboxLoadingSiteInfo(config: SandboxConfig): LoadingSiteInfo {
  const level = sandboxLevelDef(config);
  return {
    siteNumber: null,
    biomeCategoryKey: BIOME_CATEGORY_KEY[config.biome] ?? DEFAULT_BIOME_CATEGORY_KEY,
    difficulty: 0,
    descriptionKey: 'loading.sandbox_subtitle',
    briefing: [
      { labelKey: 'loading.brief.starting_cash', value: `$${formatMoney(level.startingCash)}` },
      { labelKey: 'loading.brief.target', value: `$${formatMoney(level.unlockThreshold)}` },
      { labelKey: 'loading.brief.explosives', value: String(level.availableExplosives.length) },
    ],
  };
}

function enterLevel(commands: readonly string[], siteInfo?: LoadingSiteInfo): Promise<void> {
  return loadingScreen.runPhases([
    { run: () => { for (const cmd of commands) runGameCommand(cmd, { syncRenderer: false }); } },
    { run: () => { gameRenderer.syncFromContext(ctx); } },
  ], siteInfo);
}

// --- Tutorial ---
const tutorial = new TutorialOverlay(uiContainer);
const tutorialPitLevel = getLevel('tutorial_pit');
mainMenu.setOnTutorial(() => {
  mainMenu.hide();
  void enterLevel(
    ['new_game seed:42 size:24', 'campaign start level:tutorial_pit'],
    tutorialPitLevel ? buildLoadingSiteInfo(tutorialPitLevel) : undefined,
  ).then(() => { tutorial.start(ctx.state ?? undefined); });
});
// Settings' REPLAY TUTORIAL button (10.x): same fresh-tutorial-level entry
// point as MainMenu's own TUTORIAL button above — the tutorial's steps are
// tuned to that specific map (tutorialStages.ts's REGION table), not to
// whatever the player currently has loaded.
uiManager.setReplayTutorialHandler(() => {
  void enterLevel(
    ['new_game seed:42 size:24', 'campaign start level:tutorial_pit'],
    tutorialPitLevel ? buildLoadingSiteInfo(tutorialPitLevel) : undefined,
  ).then(() => { tutorial.start(ctx.state ?? undefined); });
});

// --- Settings: persistence wiring (redesign P10; audio wired below, once
// audioMgr exists) ---
uiManager.setBackend(saveBackend);
uiManager.setGetState(() => ctx.state);

// --- Sandbox ---
const sandboxPanel = new SandboxPanel(uiContainer);
mainMenu.setOnSandbox(() => { mainMenu.hide(); sandboxPanel.show(); });
sandboxPanel.setOnBack(() => { mainMenu.show(); });
sandboxPanel.setOnStart((config) => {
  void enterLevel([
    `sandbox start biome:${config.biome} difficulty:${config.difficulty} seed:${config.seed}`,
  ], buildSandboxLoadingSiteInfo(config));
});

// --- Audio ---
const audioMgr = new AudioManager();
uiManager.setAudioManager(audioMgr);
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
  uiManager.notify({ severity: 'critical', title: t('notification.title.bankruptcy'), body: t('notification.bankruptcy_triggered', { cash: Math.floor(cash) }) });
});
emitter.on('bankruptcy:warning', ({ ticksRemaining }) => {
  uiManager.notify({ severity: 'warn', title: t('notification.title.bankruptcy'), body: t('notification.bankruptcy_warning', { ticksRemaining }) });
});
emitter.on('ecology:shutdown', () => {
  uiManager.notify({ severity: 'critical', icon: 'rock', title: t('notification.title.ecology'), body: t('notification.ecology_shutdown') });
});
emitter.on('ecology:warning', ({ ticksRemaining }) => {
  uiManager.notify({ severity: 'warn', icon: 'rock', title: t('notification.title.ecology'), body: t('notification.ecology_warning', { ticksRemaining }) });
});
emitter.on('arrest:triggered', () => {
  uiManager.notify({ severity: 'critical', icon: 'gavel', title: t('notification.title.arrest'), body: t('notification.arrest_triggered') });
});
emitter.on('revolt:triggered', () => {
  uiManager.notify({ severity: 'critical', icon: 'union', title: t('notification.title.revolt'), body: t('notification.revolt_triggered') });
});
emitter.on('revolt:warning', ({ ticksRemaining }) => {
  uiManager.notify({ severity: 'warn', icon: 'union', title: t('notification.title.revolt'), body: t('notification.revolt_warning', { ticksRemaining }) });
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
    __entityWorldPosition: (kind: 'building' | 'vehicle' | 'employee' | 'fragment', id: number) => { x: number; z: number } | null;
    /** Scenario-harness hooks for the P3 in-scene placement tool — see PlacementController.paintRect for why this bypasses real pointer events. */
    __placement: {
      isArmed: () => boolean;
      paintRect: (x1: number, z1: number, x2: number, z2: number) => void;
      confirm: () => void;
      cancel: () => void;
    };
    /** World tile → screen pixel, for interaction mode's real clicks on the P3 placement canvas (unlike __placement, which scenario-mode uses directly). */
    __worldToScreen: (x: number, z: number) => { px: number; py: number; onScreen: boolean } | null;
    /**
     * Preview the loading screen without running a real (multi-second,
     * main-thread-blocking) level load — the visual-testing scenario has no
     * other deterministic way to see it (#493). `kind` picks a campaign level
     * or a sandbox site; `locale` optionally renders it in the other
     * language, restored once the synchronous `show()` call returns.
     */
    __loadingScreenPreview: (kind?: 'level' | 'sandbox', locale?: 'en' | 'fr') => void;
    __loadingScreenHide: () => void;
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
  const prevState = ctx.state;
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

  // Whether this command replaced ctx.state with a new object — new_game,
  // campaign level transitions, sandbox start, and any future entry point
  // that does the same. Comparing identity rather than matching command
  // names means this can't miss one.
  const enteredNewLevel = Boolean(ctx.state && ctx.state !== prevState);

  // A fresh game replaces whatever the splash screen was showing — the normal
  // click paths (world map "Start", tutorial button) already call
  // mainMenu.hide() themselves, but a level-entry command run directly
  // (console mode, scenario harness) bypassed that and left the overlay
  // covering the canvas. Same identity change also has to close any overlay
  // whose visibility is a stale carry-over from the PREVIOUS level's ended
  // state (e.g. BlastReportModal left open from an earlier site's last
  // blast) — a second `sandbox start` otherwise left that site's "Rating:
  // Perfect" dialog covering the new site's terrain (#504).
  if (enteredNewLevel) {
    mainMenu.hide();
    uiManager.closeStaleLevelOverlays();
  }

  // (Re)seed the weather cycle whenever ctx.state was replaced with a new
  // object. Previously ctx.weatherCycle only ever got created lazily inside
  // weatherCommand (the `weather` console command, which nothing
  // player-facing calls), so outside of manual console/test use the weather
  // popover would have had nothing real to show, and a second game in the
  // same session would have kept the first game's weather cycle at the wrong
  // seed.
  if (enteredNewLevel && ctx.state) {
    ctx.weatherCycle = createWeatherCycle(ctx.state.seed);
    ctx.rng = new Random(ctx.state.seed + 1000);
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
  if (ctx.state) {
    uiManager.update(ctx.state, ctx.weatherCycle, ctx.rng);
    // A game exists — reveal HUD chrome unless the player is looking at the
    // menu on purpose (Quit, or mid-game Site Map). Self-correcting on every
    // command so no entry point (button, console, scenario harness) can miss it.
    if (!mainMenu.visible) uiManager.show();
  }
  if (ctx.state) tutorial.onCommandExecuted(ctx.state);
  // Deferred while the tutorial overlay is active: its own "victory" step
  // already waits on this exact state.levelEndReason transition and shows a
  // brief congratulations card of its own — the real recap takes over once
  // that finishes, rather than both fighting for the screen at once.
  if (ctx.state && !tutorial.isActive) levelEndScreen.update(ctx.state);
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
    timeScale: s.timeScale,
    mineType: s.mineType,
    weather: ctx.weatherCycle?.current ?? null,
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
    surveyCount: s.surveyResults.length,
    pendingActionCount: s.pendingActions.length,
    buildingCount: s.buildings.buildings.length,
    vehicleCount: s.vehicles.vehicles.length,
    employeeCount: s.employees.employees.length,
    // Qualifications the roster holds, so an interaction-mode check can prove
    // a skill was actually obtained rather than that a button merely looked clickable.
    qualificationCount: s.employees.employees
      .reduce((n, e) => n + e.qualifications.length, 0),
    proficiencyTotal: s.employees.employees
      .reduce((n, e) => n + e.qualifications.reduce((m, q) => m + q.proficiencyLevel, 0), 0),
    trainingCount: s.employees.employees.filter(e => e.trainingState !== null).length,
    // Needs mechanics: proves fatigue actually built up and collapse actually
    // fired, rather than a scenario guessing at it from a screenshot alone.
    collapsedCount: s.employees.employees.filter(e => e.collapsing).length,
    minFatigue: s.employees.employees.reduce((m, e) => Math.min(m, e.fatigue), 100),
    stuckEmployeeCount: s.employees.employees.filter(e => e.isMoveStuck).length,
    activeContractCount: s.contracts.active.length,
    deathCount: s.damage.deathCount,
    levelEnded: s.levelEnded,
    levelEndReason: s.levelEndReason,
    // ── Game-over detection fields ──
    bankrupt: s.bankruptcy.bankrupt,
    revolted: s.revolt.revolted,
    ecologicalShutdown: s.ecological.shutdown,
    arrested: s.arrest.arrested,
    cash: s.cash,
    profit: s.levelStats?.totalWealth ?? 0,
    wellBeing: s.scores.wellBeing,
    safety: s.scores.safety,
    ecology: s.scores.ecology,
    nuisance: s.scores.nuisance,
    muckPile: ctx.grid
      ? summariseMuckPile(s.logistics.fragments.map(f => f.fragment), ctx.grid)
      : null,
    storedMassKg: s.logistics.storedMassKg,
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
    ambientClockSeconds: gameRenderer.ambientClockSeconds,
  };
};

window.__resetTickAccumulator = () => { accumulatedGameMs = 0; };

// A Puppeteer-driven run (scenario/interaction mode) navigates with
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
    surveyOverlayVisible: gameRenderer.surveyOverlayVisible,
  };
};

window.__uiState = () => {
  const panels = ['bs-blast-panel', 'bs-contract-panel', 'bs-finances-panel', 'bs-operations-panel', 'bs-build-panel',
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

// What can a player actually click right now? Used by interaction mode so a
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
// Live entity position for harnesses that need to click a scene entity
// without baking in a guessed world coordinate — a scenario step that hires
// an employee doesn't otherwise know where the game decided to spawn them.
window.__entityWorldPosition = (kind, id) => {
  const pos = gameRenderer.entityWorldPosition(kind, id);
  return pos ? { x: pos.x, z: pos.z } : null;
};
window.__placement = {
  isArmed: () => placementController.isArmed,
  paintRect: (x1, z1, x2, z2) => placementController.paintRect(x1, z1, x2, z2),
  confirm: () => placementController.confirm(),
  cancel: () => placementController.cancel(),
};
window.__worldToScreen = (x, z) => {
  // Centre of the tile, not its corner — a ray fired back from a
  // corner-projected pixel can land on a neighbouring tile instead (surface
  // height varies fastest near tile edges), same reasoning the retired 2D
  // picker's tileToPoint centred on for the flat-canvas case.
  const cx = x + 0.5;
  const cz = z + 0.5;
  // raycastSurfaceY, not surfaceYAt: surfaceYAt's voxel-column height can
  // diverge from the rendered mesh enough to throw the projected pixel off
  // the tile — the click raycast then misses the terrain entirely.
  const startY = gameRenderer.raycastSurfaceY(cx, cz) ?? gameRenderer.surfaceYAt(cx, cz);
  let candidate = scene.cameraController.projectToNDC(cx, startY, cz);
  // The camera ray through a pixel is never vertical, so on sloped ground —
  // and this game's default camera is ground-level, i.e. steeply angled —
  // the point directly above/below (cx, cz) isn't always the point the
  // camera's own ray would hit when aimed at that pixel. Converge on a pixel
  // that truly round-trips: re-derive the height from what a click here would
  // actually hit, and reproject. Tracks the best candidate seen rather than
  // trusting the last iteration outright — a fixed-point sequence like this
  // one isn't guaranteed to improve monotonically, and landing on a worse
  // guess than the vertical-raycast starting point would be a regression.
  let best = candidate;
  let bestError = Infinity;
  for (let i = 0; i < 5; i++) {
    const hit = gameRenderer.raycastTerrainFromNDC(candidate.x, candidate.y, scene.camera);
    if (!hit) break;
    const error = Math.hypot(hit.x - cx, hit.z - cz);
    if (error < bestError) { bestError = error; best = candidate; }
    if (error < 0.05) break;
    candidate = scene.cameraController.projectToNDC(cx, hit.y, cz);
  }
  const ndc = best;
  const rect = canvas.getBoundingClientRect();
  return {
    px: rect.left + (ndc.x * 0.5 + 0.5) * rect.width,
    py: rect.top + (1 - (ndc.y * 0.5 + 0.5)) * rect.height,
    onScreen: ndc.z < 1,
  };
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

// Loading screen debug/preview bridge (#493) — see the declare-global doc comment.
window.__loadingScreenPreview = (kind = 'level', locale) => {
  const prevLocale = locale ? getLocale() : null;
  if (locale) setLocale(locale as Locale);
  try {
    if (kind === 'sandbox') {
      loadingScreen.show(buildSandboxLoadingSiteInfo(SANDBOX_DEFAULTS));
    } else {
      const level = getLevel('grumpstone_ridge') ?? getAllLevels()[0];
      loadingScreen.show(level ? buildLoadingSiteInfo(level) : undefined);
    }
  } finally {
    if (prevLocale) setLocale(prevLocale);
  }
};
window.__loadingScreenHide = () => { loadingScreen.hide(); };

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
  uiManager.hide();
});

// Site-map and Saves buttons live in the top bar's right cluster (shell/TopBar.ts) —
// folded in from two ad-hoc floating buttons that used to collide with the
// paused/event chip (spec §5 defect).
uiManager.setSiteMapHandler(() => {
  worldMap.show(ctx.state?.campaign ?? null);
});
uiManager.setOpenSavesHandler(() => savesModal.show());
uiManager.setMapFocusHandler((x, z) => {
  scene.cameraController.focus(x, gameRenderer.surfaceYAt(x, z), z, 60);
});
uiManager.setSelectVehicleHandler((vehicleId) => {
  scenePicking.select({ kind: 'vehicle', id: vehicleId, point: new THREE.Vector3(), distance: 0 });
});

// --- Scene picking wiring (redesign P2) ---
scenePicking.setHoverChangeHandler((hover) => {
  if (ctx.state) hoverTag.update(hover, ctx.state);
});
scenePicking.setSelectChangeHandler((entity) => {
  if (entity && ctx.state) {
    selectionBar.show(entity, ctx.state);
    const pos = gameRenderer.entityWorldPosition(entity.kind, entity.id);
    if (pos) entityHighlight.show(pos, entity.kind);
  } else {
    selectionBar.hide();
    entityHighlight.hide();
  }
});
// Esc deselects before falling through to the panel/modal layers beneath it —
// registered last among the shell's own layers so it's tried first (most
// recently registered wins, per UIManager.registerEscLayer).
uiManager.registerEscLayer(() => {
  if (!scenePicking.selection) return false;
  scenePicking.clearSelection();
  return true;
});

/** Report a failed console command from a selection-bar action as a toast; success is silent (the world visibly changing is the feedback). */
function reportIfFailed(title: string, result: CommandResult): void {
  if (!result.success) uiManager.notify({ severity: 'warn', title, body: result.output });
}
selectionBar.setActionHandler((action, entity) => {
  switch (action) {
    case 'detail':
    case 'train':
      uiManager.showEmployeeDetail(entity.id);
      break;
    case 'dispatch_here': {
      // "Here" = wherever the player is currently pointing on the ground —
      // the live hover state, read at the moment the button is clicked.
      const terrain = scenePicking.aim?.terrain;
      if (!terrain) {
        // `no_move_target` ("point at the ground…"), not `no_haul_target`
        // ("no fragment nearby to haul") — this step fails because the cursor
        // is not over terrain, which has nothing to do with fragments. The
        // haul-specific text was copied here and told the player to look for
        // the wrong thing.
        uiManager.notify({ severity: 'warn', title: t('shell.selection.dispatch_here'), body: t('shell.selection.no_move_target') });
        break;
      }
      reportIfFailed(t('shell.selection.dispatch_here'), window.__gameConsole(`employee dispatch ${entity.id} x:${terrain.tileX} z:${terrain.tileZ}`));
      break;
    }
    case 'move_here': {
      // Vehicle counterpart of Dispatch Here: drive to whatever tile the
      // player is currently pointing at. Note the parser's coordinate form
      // here is `to:x,z` (one comma-joined argument), not the `x:… z:…` pair
      // `employee dispatch` takes — see src/console/commands/vehicle.ts.
      const terrain = scenePicking.aim?.terrain;
      if (!terrain) {
        uiManager.notify({ severity: 'warn', title: t('shell.selection.move_here'), body: t('shell.selection.no_move_target') });
        break;
      }
      reportIfFailed(t('shell.selection.move_here'), window.__gameConsole(`vehicle move ${entity.id} to:${terrain.tileX},${terrain.tileZ}`));
      break;
    }
    case 'follow':
    case 'focus': {
      const pos = gameRenderer.entityWorldPosition(entity.kind, entity.id);
      if (pos) scene.cameraController.focus(pos.x, pos.y, pos.z, action === 'follow' ? 40 : 20);
      break;
    }
    case 'haul': {
      // Same live-hover pattern as Dispatch Here: haul whichever fragment the
      // player is currently pointing at.
      const hovered = scenePicking.aim?.entity;
      if (!hovered || hovered.kind !== 'fragment') {
        uiManager.notify({ severity: 'warn', title: t('shell.selection.haul'), body: t('shell.selection.no_haul_target') });
        break;
      }
      reportIfFailed(t('shell.selection.haul'), window.__gameConsole(`vehicle haul ${entity.id} fragment:${hovered.id}`));
      break;
    }
    case 'unassign':
      reportIfFailed(t('shell.selection.unassign'), window.__gameConsole(`vehicle driver ${entity.id} none`));
      break;
    case 'upgrade':
      reportIfFailed(t('shell.selection.upgrade'), window.__gameConsole(`build upgrade ${entity.id}`));
      break;
    case 'move':
      // Move needs a tile picker — the in-scene placement layer is P3's job.
      // Until then this routes to the Build panel's own move flow.
      uiManager.showPanel('build');
      break;
    case 'demolish':
      reportIfFailed(t('shell.selection.demolish'), window.__gameConsole(`build destroy ${entity.id}`));
      scenePicking.clearSelection(); // the entity is gone — nothing left to keep selected
      break;
  }
});

savesModal.setOnLoad((state) => {
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
// Toggles between `time pause`/`time resume` — shared by the Space-bar
// shortcut and the top bar's pause button so both reflect one source of truth.
function togglePause(): void {
  window.__gameConsole(ctx.state?.isPaused ? 'time resume' : 'time pause');
}
uiManager.setTogglePauseHandler(togglePause);
new KeyboardShortcuts({
  togglePause,
  // Was dispatching the bare `speed ${n}` command, which was never
  // registered — every keyboard speed change (1-4) silently no-op'd.
  setSpeed: (n) => window.__gameConsole(`time speed ${n}`),
  togglePanel: (name) => uiManager.togglePanel(name),
  quickSave: () => { if (ctx.state) void savesModal['autoSave'](ctx.state); },
  onEscape: () => uiManager.handleEscape(),
  onToggleNavGrid: () => uiManager.toggleNavGridOverlay(),
  // Keep the panel's own button in sync even while the panel is closed —
  // its click handler is the other path into the same preference, and the
  // two must never disagree the next time the panel opens.
  onToggleSurveyOverlay: () => uiManager.setSurveyOverlayVisible(gameRenderer.toggleSurveyOverlayVisible()),
});

// --- Render loop + game tick timer ---
// The game ticks at BASE_TICK_MS intervals, adjusted for time scale.
// At 1x speed: 1 tick/second. At 4x: 4 ticks/second.
// Accumulated time prevents tick drift from frame-rate variation.
let accumulatedGameMs = 0;
let hadPendingEvent = false;

scene.start((dt) => {
  gameRenderer.update(dt);
  entityHighlight.update(dt);
  // Keep the selection ring on a moving vehicle/employee; if the selected
  // entity is gone (destroyed, hauled away, collected), deselect it —
  // the select-change handler above then hides the ring and the bar.
  if (scenePicking.selection) {
    const pos = gameRenderer.entityWorldPosition(scenePicking.selection.kind, scenePicking.selection.id);
    if (pos) entityHighlight.setPosition(pos);
    else scenePicking.clearSelection();
  }

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
    uiManager.update(ctx.state, ctx.weatherCycle, ctx.rng);
    if (!mainMenu.visible) uiManager.show();
    savesModal.onTick(ctx.state);
  }
  if (ctx.state && !tutorial.isActive) levelEndScreen.update(ctx.state);
});
