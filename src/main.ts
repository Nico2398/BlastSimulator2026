// BlastSimulator2026 — Browser entry point
// Initializes the 3D scene, UI, audio, save system, and exposes the console bridge.
import * as THREE from 'three';
import { SceneManager } from './renderer/SceneManager.js';
import { modelLibrary } from './renderer/models/ModelLibrary.js';
import { fetchModelBytes, preloadModels, yieldToEventLoop } from './renderer/models/ModelLoader.js';
import { GameRenderer } from './renderer/GameRenderer.js';
import { UIManager } from './ui/UIManager.js';
import { wireCrewNotifications } from './ui/notify/crewNotifications.js';
import { wireLogisticsNotifications } from './ui/notify/logisticsNotifications.js';
import { wireResearchNotifications } from './ui/notify/researchNotifications.js';
import { wireCorruptionNotifications } from './ui/notify/corruptionNotifications.js';
import { SavesModal } from './ui/panels/SavesModal.js';
import { TutorialOverlay } from './ui/TutorialOverlay.js';
import { shouldAutoStartTutorial, shouldKeepTutorialRunning, shouldRestartTutorialOnRetry, TUTORIAL_LEVEL_ID } from './ui/tutorialTrigger.js';
import { probeTutorialState } from './ui/tutorialStateProbe.js';
import { KeyboardShortcuts } from './ui/KeyboardShortcuts.js';
import { isControlLive, isRailedControl } from './ui/tutorialActivationGuard.js';
import { MainMenu } from './ui/MainMenu.js';
import { WorldMap } from './ui/screens/WorldMap.js';
import { LevelEndScreen } from './ui/screens/LevelEndScreen.js';
import { SandboxPanel } from './ui/SandboxPanel.js';
import { LoadingScreen } from './ui/LoadingScreen.js';
import type { LoadingSiteInfo } from './ui/LoadingScreen.js';
import type { CommandResult } from './console/ConsoleRunner.js';
import { getLevel, getAllLevels } from './core/campaign/Level.js';
import { getMaxBuildingTier } from './core/entities/Building.js';
import { isInsideBuilding } from './core/entities/EmployeeLocomotion.js';
import { buildLoadingSiteInfo, buildSandboxLoadingSiteInfo } from './ui/loadingSiteInfo.js';
import { SANDBOX_DEFAULTS, type SandboxConfig } from './core/campaign/Sandbox.js';
import { loadSettings } from './ui/userSettings.js';
import { AudioManager } from './audio/AudioManager.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { NULL_AUDIO_PLAYER, type AudioPlayer } from './audio/AudioPlayer.js';
import { installAudioDebug } from './audio/debug/audioDebug.js';
import { UiCues } from './audio/ui/UiCues.js';
import { CommandClaim } from './audio/ui/CommandClaim.js';
import { installAudioUnlock } from './audio/ui/audioUnlock.js';
import { installUiSounds } from './audio/ui/installUiSounds.js';
import { commandCue } from './audio/ui/commandCues.js';
import { GameAudioDirector } from './audio/director/GameAudioDirector.js';
import { createMusicDirector } from './audio/music/MusicDirector.js';
import { deriveMusicContext } from './audio/music/musicContext.js';
import { Random } from './core/math/Random.js';
import { selectSaveBackend } from './persistence/selectBackend.js';
import { loadCampaignProfile, saveCampaignProfile } from './persistence/CampaignProfileStore.js';
import { mergeCampaignIntoProfile, resetCampaignProfile, hasCampaignProgress } from './persistence/CampaignProfile.js';
import { createRunner, runCommand } from './console/createRunner.js';
import { parseCommand } from './console/ConsoleRunner.js';
import { advance, type Steps } from './core/engine/Steps.js';
import { terrainConfigOf, ensureLandscape, loadGridForState, stateForSave } from './console/commands/world.js';
import { computeVoxelColumnSurfaceY } from './core/world/VoxelGrid.js';
import { BASE_TICK_MS } from './core/engine/GameLoop.js';
import { getLivingEmployees } from './core/entities/Employee.js';
import { isDangerZoneClear } from './core/entities/Zone.js';
import { totalCollectedOreKg } from './core/economy/Logistics.js';
import { stateRubbleStockKg, totalSpoilKg } from './core/economy/SpoilHeaps.js';
import { getProfitShortfall } from './core/campaign/LevelObjective.js';
import { hasWinningOreSaleOffer, hasFillableOreSaleOffer, hasFillableSaleOffer, hasOreSaleOffer, hasRubbleDisposalOffer } from './core/economy/Contract.js';
import { isActive } from './core/events/ActiveModifiers.js';
import { findTrafficJams } from './core/events/TrafficJams.js';
import { probeUiActions, probeSelector } from './ui/uiActionProbe.js';
import { t, getLocale, setLocale, type Locale } from './core/i18n/I18n.js';
import { formatGameDuration } from './ui/formatGameDuration.js';
import { ScenePicking, pickScene, type EntityPick } from './ui/scene/ScenePicking.js';
import { anchorFootprint, isHostResolvedKind, resolveSelection, type SelectionAnchor } from './ui/scene/SelectionHost.js';
import type { GameState } from './core/state/GameState.js';
import { resolveScreenPointForTile, type ProjectToNDC, type RaycastForTile, type ScreenTileResolution } from './renderer/ScreenTileResolution.js';
import { HoverTag } from './ui/scene/HoverTag.js';
import { buildDemolishConfirm, freightOreKg } from './ui/demolishConfirm.js';
import { Inspector } from './ui/shell/Inspector.js';
import { formatBalance } from './ui/shell/TopBar.js';
import { EntityHighlight } from './renderer/EntityHighlight.js';
import { PlacementController } from './ui/scene/PlacementController.js';
import { ParamStrip } from './ui/scene/ParamStrip.js';
import { armEntityMovePick } from './ui/scene/EntityMovePick.js';
import { vehicleDisplayName } from './ui/fleetDetailSections.js';
import { SelectionOverlay } from './renderer/SelectionOverlay.js';
import { regionCenter, regionSpan, type TileRegion } from './ui/tutorialPickerRegion.js';
import { nextRampWidth } from './core/mining/RampWidening.js';
import { summariseMuckPile } from './core/mining/MuckPileSummary.js';
import { hasLevelEnded } from './core/engine/GameOverConditions.js';
import { dominantRockUnderHole } from './core/mining/ExplosiveRockFit.js';
import { outstandingChargeBlockedReason } from './core/mining/ChargeOrder.js';
import { wetHoles } from './core/mining/WetHoles.js';
import { getSurfaceY } from './core/entities/BuildingPlacement.js';

// --- 3D Scene ---
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const scene = new SceneManager(canvas);
// Entity models share the scene's cascaded shadows: the hook runs on every
// toon material the library creates, and its teardown drops the material
// from CSM's bookkeeping when the instance owning it goes away.
modelLibrary.setMaterialSetup(m => {
  scene.csm.setupMaterial(m);
  return () => { scene.csm.shaders.delete(m); };
});
// Fetch every model now, alongside the main menu; enterLevel() waits on it
// as its first phase, and any level entered earlier (a harness driving
// new_game straight away) catches up through GameRenderer.update().
const modelsReady = preloadModels(modelLibrary, fetchModelBytes, { yieldBetween: yieldToEventLoop });

// --- Game Renderer (bridges console commands → Three.js) ---
const gameRenderer = new GameRenderer(scene);

// --- Stored player settings ---
// Reads are skipped in scenario mode so a shared browser's leftover settings never reach a scenario run.
// Writes still happen there but are never read back in scenario mode.
const scenarioMode = new URLSearchParams(window.location.search).get('scenarioMode') === '1';
const storedSettings = scenarioMode ? {} : loadSettings();
if (storedSettings.locale) setLocale(storedSettings.locale);

// --- UI ---
const uiContainer = document.getElementById('bs-ui-root') ?? document.body;
const uiManager = new UIManager(uiContainer);

// --- Audio ---
// The manager owns the Web Audio context and the volume channels; Settings needs it everywhere, headless included.
const audioMgr = new AudioManager();
if (storedSettings.volumes) audioMgr.applyVolumes(storedSettings.volumes);
uiManager.setAudioManager(audioMgr);
// Sound variation is not gameplay, so it seeds from the clock rather than from a game seed.
const audioRandom = new Random(Date.now());
// A scenario run (headless Chromium, no gesture, no speakers) gets the null player: every handler below
// still runs, so a fault in one surfaces there, but nothing is fetched, decoded or played.
const audioEngine = scenarioMode ? null : new AudioEngine(audioMgr, { random: audioRandom });
// `?audioLog=1` records every request in window.__audioLog (the browser smoke test reads it); otherwise this is the player itself.
const audioPlayer: AudioPlayer = installAudioDebug(window, window.location.search, audioEngine ?? NULL_AUDIO_PLAYER, () => ({
  ready: audioEngine?.ready ?? false,
  preloaded: audioEngine?.preloaded ?? false,
  failedAssets: audioEngine?.failedAssets ?? [],
  contextState: audioMgr.context?.state ?? 'none',
}));
// Decode after the models are in, so the main menu does not hitch; the engine drops sounds until it is ready.
if (audioEngine) void modelsReady.catch(() => undefined).then(() => audioEngine.preload());
// A command's own cue, or the panel/modal a click opened, supersedes the generic click of that control: all sides share this claim.
const commandClaim = new CommandClaim();
const uiCues = new UiCues(audioPlayer, { claim: commandClaim });
uiManager.setUiCues(uiCues);
// Buttons, dropdowns and sliders all get their sound from this one listener. The tutorial's activation guard is
// installed later (when the tutorial starts), so inert railed controls are muted through `isInert`, not by order.
installUiSounds(document, audioPlayer, { isInert: target => isRailedControl(target), claim: commandClaim });
// No streaming in scenario runs; with an empty track catalogue the director does nothing either way.
const music = scenarioMode ? null : createMusicDirector(audioMgr);
// Browsers hold audio back until a gesture they accept: every gesture retries until the context is running.
installAudioUnlock(document, audioMgr, music);

// --- Scene picking: hover tags, click-to-select, entity inspector (redesign P2) ---
// Declared here (with the other core objects) but wired further down, once
// window.__gameConsole/t()/ctx are ready — same declare-early/wire-when-ready
// shape the rest of this file already uses for uiManager itself.
const scenePicking = new ScenePicking(canvas, scene.camera, gameRenderer);
const entityHighlight = new EntityHighlight(scene.scene);
const hoverTag = new HoverTag(uiContainer, canvas, scene.camera);
const inspector = new Inspector(uiContainer);

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
const selectionOverlay = new SelectionOverlay(
  scene.scene,
  (x, z) => gameRenderer.surfaceYAt(x, z),
  (x, z) => gameRenderer.smoothSurfaceYAt(x, z),
);
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
// A refused placement click (not a hover over a refused tile) gets its own buzz; the accepted one is voiced by the build command.
placementController.setRefusedHandler(() => uiCues.placementRefused());
// Read-only site-claim preview (#558): would this tile's claim be refused,
// and why. `ctx` is assigned below (createRunner()) but this closure only
// reads it once the player actually hovers/anchors a tile, well after that
// assignment has run.
placementController.setClaimCheck((x, z) => {
  if (!ctx.playableArea) return null;
  if (ctx.playableArea.contains(Math.floor(x), Math.floor(z))) return null;
  return ctx.playableArea.previewClaim(Math.floor(x), Math.floor(z));
});
// ParamStrip only renders what it's told; pressing its own CONFIRM/ESC buttons
// has to reach back into the controller that armed it.
paramStrip.setConfirmHandler(() => placementController.confirm());
paramStrip.setCancelHandler(() => placementController.cancel());
uiManager.setClaimAreaPreview((rect) => ctx.playableArea?.previewClaimArea(rect) ?? null);
const placementKit = { controller: placementController, overlay: selectionOverlay, strip: paramStrip };
uiManager.setPlacementKit(placementKit);
// Build panel's footprint-flatness preview (#1008) reads the same ground
// truth checkFootprintPlacement does — the raw voxel surface, not a
// smoothed/rendered height — so the strip and the console never disagree.
uiManager.setBuildSurfaceSampler((x, z) => ctx.grid ? getSurfaceY(ctx.grid, x, z) : 0);
uiManager.setEstimateGridProvider(() => ctx.grid ?? null);
uiManager.setHoleRockSampler(h => ctx.grid ? dominantRockUnderHole(ctx.grid, h) : null);

// Survey confidence overlay's player-facing visibility toggle (#496): the
// panel's own click handler drives the renderer; the renderer's current
// preference seeds the panel once at startup so its button state matches.
function applySurveyOverlayVisible(visible: boolean): void {
  gameRenderer.setSurveyOverlayVisible(visible);
  if (!visible) hoverTag.hide(); // the tag only shows with the overlay on
}
uiManager.setSurveyOverlayToggleHandler(applySurveyOverlayVisible);
uiManager.setSurveyOverlayVisible(gameRenderer.surveyOverlayVisible);

// --- Persistence ---
// IndexedDB construction never throws; failures surface when it opens, so probe it
// and fall back to a session-only in-memory backend (#1325).
const { backend: saveBackend, kind: saveBackendKind } = await selectSaveBackend();

// --- Saves Modal (redesign P8) ---
const savesModal = new SavesModal(uiContainer);
savesModal.setBackend(saveBackend);
savesModal.setBackendKind(saveBackendKind);
savesModal.setConfirmHandler((cfg) => uiManager.showConfirm(cfg));
savesModal.setOnAutoSaveFailed(() => uiManager.notify({ severity: 'warn', title: t('ui.saves.autosave_failed'), body: '' }));
// Every save SavesModal takes — manual slots, auto-save and quick-save — reads
// its state here: a snapshot carrying the terrain encoded from the live grid
// at that moment (#458 T0.3). SavesModal only sees GameState; it has no idea
// VoxelGrid or its codec exist, by design.
savesModal.setGetState(() => {
  finishBlastJob(); // never save a blast half-resolved (#1603)
  return ctx.state ? stateForSave(ctx, ctx.state) : null;
});

// --- Main Menu ---
const mainMenu = new MainMenu(uiContainer);
mainMenu.setBackend(saveBackend);
mainMenu.setOnNewCampaign(() => {
  // Show world map so the player can pick a level. The tutorial (tutorial_pit
  // only, if not yet completed) triggers later, once that level is entered — starting it
  // here would stack its coach-marks on top of the level-selection cards.
  const begin = (): void => {
    mainMenu.hide();
    worldMap.show(ctx.campaignProfile.campaign);
  };
  if (!hasCampaignProgress(ctx.campaignProfile)) { begin(); return; }
  uiManager.showConfirm({
    icon: 'warn',
    title: t('ui.menu.new_campaign_confirm_title'),
    body: t('ui.menu.new_campaign_confirm_body'),
    confirmLabel: t('ui.menu.new_campaign_confirm_button'),
    onConfirm: () => {
      resetCampaignProfile(ctx.campaignProfile);
      persistCampaignProfile();
      begin();
    },
  });
});
mainMenu.setOnContinue((slotId) => {
  // The menu stays up until the load succeeds (onLoad hides it): it is the gate
  // (fullScreenMenuUp) that stops the previous ctx.state ticking/autosaving.
  // A missing/failed/refused load leaves the menu showing with the reason.
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
  inspector.refreshLocale();
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
  inspector.refreshLocale();
  tutorial.refreshLocale();
});
mainMenu.show();

// --- World Map ("The Portfolio") ---
const worldMap = new WorldMap(uiContainer);
worldMap.setOnBack(() => {
  worldMap.hide();
  mainMenu.show();
});
/** A live game: a state exists and its level has not ended. */
const isLiveGame = (): boolean => !!ctx.state && !hasLevelEnded(ctx.state);
mainMenu.setLiveGameProbe(isLiveGame);
mainMenu.setOnResume(() => {
  mainMenu.hide();
  uiManager.show();
  // Return to Menu suspended the tutorial with its progress kept; pick it back up guided.
  if (ctx.state && !tutorial.isActive && shouldKeepTutorialRunning(ctx.state.campaign.activeLevelId)) tutorial.resume(ctx.state);
});
worldMap.setOnReturnToSite(() => { worldMap.hide(); uiManager.show(); });
function startLevel(levelId: string): void {
  worldMap.hide();
  // `campaign start` plays campaign levels on the persistent profile, so a
  // first-ever level entry needs no priming new_game (and no throwaway
  // terrain generation for a sandbox world this never shows).
  const level = getLevel(levelId);
  void enterLevel([`campaign start level:${levelId}`], level ? buildLoadingSiteInfo(level) : undefined).then(() => {
    // First-time players get tutorial guidance once the tutorial level is
    // actually loaded, not while picking from the world map; other levels never.
    if (shouldAutoStartTutorial(levelId, TutorialOverlay.isCompleted())) tutorial.start(ctx.state ?? undefined);
  });
}
worldMap.setOnStartLevel((levelId) => {
  if (!isLiveGame()) { startLevel(levelId); return; }
  uiManager.showConfirm({
    icon: 'blast',
    title: t('ui.portfolio.restart_confirm_title'),
    body: t('ui.portfolio.restart_confirm_body'),
    confirmLabel: t('ui.portfolio.restart_confirm_button'),
    onConfirm: () => startLevel(levelId),
  });
});

// --- Level End Screen (redesign P8) ---
const levelEndScreen = new LevelEndScreen(uiContainer);
levelEndScreen.setOnReplay((levelId) => {
  const restartTutorial = shouldRestartTutorialOnRetry(levelId, ctx.state?.levelEndReason);
  levelEndScreen.hide();
  if (restartTutorial) { startTutorial(); return; }
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
  worldMap.show(ctx.campaignProfile.campaign);
});
levelEndScreen.setOnKeepPlaying(() => {
  const result = runGameCommand('campaign keep_playing');
  if (!result.success) {
    uiManager.notify({ severity: 'warn', title: t('ui.level_end.keep_playing'), body: result.output });
    return;
  }
  // Clears the render cache so a later defeat renders; hiding also lets the sim loop resume.
  levelEndScreen.reset();
});

// --- Level loading ---
// Entering a level blocks the main thread for seconds. enterLevel splits that
// into several weighted phases the loading screen can paint between (#474),
// so the bar advances roughly in proportion to the work rather than sitting
// still through the biggest step and snapping at the end. See
// LOAD_PHASE_WEIGHT and enterLevel() below.
const loadingScreen = new LoadingScreen(uiContainer);

/**
 * Weighted LoadPhase costs for enterLevel() below (#474) — default-and-record,
 * since the sandbox this was tuned in measures the same load anywhere from
 * 16s to 32s (a property of the environment, not the game) and re-measuring
 * cleanly needs a GPU this sandbox doesn't have. Ranked by what each step
 * actually walks: terrain generation and the playable mesh both touch the
 * full 3D voxel grid, so they get the heaviest weight; the landscape map and
 * its mesh cover a coarser, 2D-ish structure past the playable rect, so half
 * that; the ambient rebuild is a handful of particle systems, cheapest of
 * the five. Re-tune against real measurements if they diverge from this.
 */
const LOAD_PHASE_WEIGHT = {
  models: 1,
  terrain: 3,
  landscapeMap: 2,
  playableMesh: 3,
  landscapeMesh: 2,
  ambient: 1,
} as const;

function enterLevel(commands: readonly string[], siteInfo?: LoadingSiteInfo): Promise<void> {
  return loadingScreen.runPhases([
    // Entity models (workers, vehicles, buildings) must be in the library
    // before buildPlayableMesh() instantiates them, or the level opens on
    // stand-in boxes. A cache hit after the first level.
    { weight: LOAD_PHASE_WEIGHT.models, run: async () => { await modelsReady; } },
    {
      weight: LOAD_PHASE_WEIGHT.terrain,
      run: () => { for (const cmd of commands) runGameCommand(cmd, { syncRenderer: false }); },
    },
    {
      weight: LOAD_PHASE_WEIGHT.landscapeMap,
      // Forces ensureLandscape()'s lazy build now, as its own weighted step,
      // rather than letting it happen implicitly (and uncounted) inside the
      // playable-mesh phase's edge-height sampler below — buildPlayableMesh()
      // still calls ensureLandscape() itself, but by then it's a cache hit.
      run: () => {
        const cfg = ctx.state && terrainConfigOf(ctx.state);
        if (cfg) ensureLandscape(ctx, cfg);
      },
    },
    { weight: LOAD_PHASE_WEIGHT.playableMesh, run: () => { gameRenderer.buildPlayableMesh(ctx); } },
    { weight: LOAD_PHASE_WEIGHT.landscapeMesh, run: () => { gameRenderer.buildLandscapeMesh(ctx); } },
    {
      weight: LOAD_PHASE_WEIGHT.ambient,
      run: () => { gameRenderer.buildAmbient(ctx); gameRenderer.finishLevelLoad(ctx); },
    },
  ], siteInfo);
}

// --- Tutorial ---
// Scenario mode leaves clock writes and step transitions to command boundaries (#1550, #1580).
const tutorial = new TutorialOverlay(uiContainer, { clockFollowsTimer: !scenarioMode });
tutorial.setConfirmHandler((cfg) => uiManager.showConfirm(cfg));
const tutorialPitLevel = getLevel(TUTORIAL_LEVEL_ID);
/** Enter the fresh tutorial level and start the guide (the tutorial's steps are
 *  tuned to that specific map — tutorialStages.ts's REGION table). */
function startTutorial(): void {
  mainMenu.hide();
  void enterLevel(
    ['new_game seed:42 size:24', `campaign start level:${TUTORIAL_LEVEL_ID}`],
    tutorialPitLevel ? buildLoadingSiteInfo(tutorialPitLevel) : undefined,
  ).then(() => { tutorial.start(ctx.state ?? undefined); });
}
// A live game is discarded by the tutorial, so ask first; Cancel leaves the menu and RESUME intact.
mainMenu.setOnTutorial(() => {
  if (!isLiveGame()) { startTutorial(); return; }
  uiManager.showConfirm({
    icon: 'warn',
    title: t('ui.settings.replay_confirm_title'),
    body: t('ui.settings.replay_confirm_body'),
    confirmLabel: t('ui.settings.replay_confirm_button'),
    onConfirm: startTutorial,
  });
});
// Settings' REPLAY TUTORIAL button (10.x): same entry point as MainMenu's TUTORIAL.
uiManager.setReplayTutorialHandler(startTutorial);

// --- Settings: persistence wiring (redesign P10; audio wired below, once
// audioMgr exists) ---
uiManager.setBackend(saveBackend);
uiManager.setGetState(() => ctx.state);

// --- Sandbox ---
const sandboxPanel = new SandboxPanel(uiContainer);
mainMenu.setOnSandbox(() => { mainMenu.hide(); sandboxPanel.show(); });
sandboxPanel.setOnBack(() => { mainMenu.show(); });
function startSandbox(config: SandboxConfig): void {
  void enterLevel([
    `sandbox start biome:${config.biome} difficulty:${config.difficulty} seed:${config.seed}`,
  ], buildSandboxLoadingSiteInfo(config));
}
sandboxPanel.setOnStart(startSandbox);
levelEndScreen.setOnRetrySandbox(() => {
  levelEndScreen.hide();
  startSandbox(sandboxPanel.getConfig());
});
levelEndScreen.setOnBackToSandbox(() => {
  levelEndScreen.hide();
  sandboxPanel.show();
});

// --- Console Bridge ---
// window.__gameConsole(cmd) routes commands to the same ConsoleRunner used in CLI mode.
// Required by scripts/screenshot.ts to drive the game from headless Chrome.
const { runner, ctx, emitter } = createRunner();
// An armed blast resolves a few slices per frame instead of freezing one
// (#1603). Scenario runs keep the synchronous fire their scripted steps expect.
ctx.sliceBlasts = !scenarioMode;

// The world's sound: core events, per-tick state changes, the blast timeline, weather and distant life.
// It reads the renderer's live entity positions (a hired worker or a bought vehicle sounds where it stands).
const gameAudio = new GameAudioDirector({
  player: audioPlayer,
  emitter,
  random: audioRandom,
  entityPosition: (kind, id) => {
    const position = gameRenderer.entityWorldPosition(kind, id);
    return position ? { x: position.x, z: position.z } : null;
  },
});
// A blast sounds at the instant its flash and shake start: the renderer reports that one moment, on the sliced
// path (landBlast) and the synchronous one (afterGameCommand) alike, so a blast is voiced exactly once.
gameRenderer.setBlastTriggeredHandler((info) => {
  gameAudio.onBlast(info);
  music?.duck();
});
gameRenderer.setLightningHandler(() => gameAudio.onLightning());

// Campaign progress outlives any one GameState (#1312). Scenario runs ignore
// (and never write) the stored profile so a shared browser's leftovers cannot
// make a scenario depend on what ran before it.
if (!scenarioMode) {
  const stored = loadCampaignProfile();
  mergeCampaignIntoProfile(ctx.campaignProfile, stored.campaign, stored.bestStars);
}
const persistCampaignProfile = (): void => {
  if (!scenarioMode) saveCampaignProfile(ctx.campaignProfile);
};
// Registered after createRunner's own level:complete listener, which records
// the stars, so the saved profile already holds this win.
emitter.on('level:complete', persistCampaignProfile);

// --- Subscribe to game-over emitter events for UI notifications ---
// The four game-over toasts below are silent: the audio director plays the `lose` sting for the same events.
emitter.on('bankruptcy:triggered', ({ cash }) => {
  uiManager.notify({ severity: 'critical', silent: true, title: t('notification.title.bankruptcy'), body: t('notification.bankruptcy_triggered', { cash: formatBalance(cash) }) });
});
emitter.on('bankruptcy:warning', ({ ticksRemaining }) => {
  uiManager.notify({ severity: 'warn', title: t('notification.title.bankruptcy'), body: t('notification.bankruptcy_warning', { duration: formatGameDuration(ticksRemaining) }) });
});
emitter.on('ecology:shutdown', () => {
  uiManager.notify({ severity: 'critical', silent: true, icon: 'rock', title: t('notification.title.ecology'), body: t('notification.ecology_shutdown') });
});
emitter.on('ecology:warning', ({ ticksRemaining }) => {
  uiManager.notify({ severity: 'warn', icon: 'rock', title: t('notification.title.ecology'), body: t('notification.ecology_warning', { duration: formatGameDuration(ticksRemaining) }) });
});
emitter.on('arrest:triggered', () => {
  uiManager.notify({ severity: 'critical', silent: true, icon: 'gavel', title: t('notification.title.arrest'), body: t('notification.arrest_triggered') });
});
emitter.on('arrest:warning', ({ exposure }) => {
  uiManager.notify({ severity: 'warn', icon: 'gavel', title: t('notification.title.arrest'), body: t('notification.arrest_warning', { percent: Math.round(exposure * 100) }) });
});
emitter.on('revolt:triggered', () => {
  uiManager.notify({ severity: 'critical', silent: true, icon: 'union', title: t('notification.title.revolt'), body: t('notification.revolt_triggered') });
});
emitter.on('revolt:warning', ({ ticksRemaining }) => {
  uiManager.notify({ severity: 'warn', icon: 'union', title: t('notification.title.revolt'), body: t('notification.revolt_warning', { duration: formatGameDuration(ticksRemaining) }) });
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
// A blast's region is the exception (#1603): its dozen chunks are marched over
// the next few frames and swapped in together, under the flash and dust, so
// the detonate frame does not pay for them. executeBlast brackets its carve
// with blast:started/blast:ended, which is what marks the region as a blast's.
let blastCarving = false;
emitter.on('terrain:updated', ({ region }) => {
  gameRenderer.remeshTerrainRegion(ctx, region, { defer: blastCarving });
});
// Bird flocks near a blast panic and scatter for a few seconds (#458 T7.2/D12/A26).
emitter.on('blast:started', ({ originX, originZ }) => {
  blastCarving = true;
  gameRenderer.notifyBlastScatter(originX, originZ);
});
emitter.on('blast:ended', () => { blastCarving = false; });

wireCrewNotifications(emitter, () => ctx.state, n => uiManager.notify(n));
wireResearchNotifications(emitter, n => uiManager.notify(n));
wireLogisticsNotifications(emitter, n => uiManager.notify(n));
wireCorruptionNotifications(emitter, n => uiManager.notify(n));

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
 * Level-entry fix-ups shared by every path that replaces ctx.state: hide the
 * splash menu, close stale overlays from the previous level's ended state
 * (#504), and reseed weather + RNG so a second game never keeps the first
 * game's cycle at the wrong seed.
 */
function onLevelStateReplaced(state: GameState): void {
  mainMenu.hide();
  uiManager.closeStaleLevelOverlays(state);
  // Selection, armed placement and the ended-state screen belong to the old level (#1322).
  scenePicking.clearSelection();
  placementController.disarm();
  levelEndScreen.reset();
  // The tutorial's steps are tuned to its own map: a swap to any other level
  // ends it (#1319), else it would block that level's end screen.
  if (tutorial.isActive && !shouldKeepTutorialRunning(state.campaign.activeLevelId)) tutorial.abandon();
}

/**
 * Run a console command.
 *
 * `syncRenderer: false` runs everything except the scene rebuild, so a level
 * load can charge the player for generation, meshing and dressing as several
 * separate weighted phases, each with a painted frame between them (see
 * LoadingScreen, enterLevel()). Only the level-entry paths pass it; every
 * other caller gets the immediate sync.
 */
function runGameCommand(cmd: string, opts?: { syncRenderer?: boolean; scripted?: boolean }): CommandResult {
  finishBlastJob();
  const prevState = ctx.state;
  const prevBlastReport = ctx.state?.lastBlastReport ?? null;
  const result = runCommand({ runner, ctx, emitter }, cmd);
  const parsed = parseCommand(cmd);
  afterGameCommand(result, parsed.command, prevState, prevBlastReport, opts);
  // Sound, once per command and not in afterGameCommand (landBlast re-enters that). Owners: commandCue voices the
  // order, hire or refusal (a player's act); the director voices what the world did (built, scrapped, paid, blown).
  // `scripted` marks commands the tutorial runs for the player, which must not click like the player's own.
  commandCue(audioPlayer, parsed, result.success, { scripted: opts?.scripted === true, claim: commandClaim });
  gameAudio.onCommand({ parsed, success: result.success, prevState, state: ctx.state });
  return result;
}

/** Frame time a blast being resolved in slices may take (#1603), leaving room for the frame's own work. */
const BLAST_JOB_FRAME_BUDGET_MS = 5;

/**
 * A blast the simulation has resolved whose visuals and UI are still catching
 * up: the fragments spawn a slice at a time, then everything a command's
 * result updates runs on a frame of its own (#1603).
 */
let blastLanding: Steps<void> | null = null;
/**
 * The blast report as it stood when the resolving job was first stepped
 * (undefined while no job is running): the job writes the new report a few
 * slices before it returns, so "did a blast land" compares against this.
 */
let reportBeforeBlastJob: NonNullable<typeof ctx.state>['lastBlastReport'] | null | undefined;

/** True while a blast is resolving or landing: the game clock waits for it. */
function blastInProgress(): boolean {
  return Boolean(ctx.blastJob) || blastLanding !== null;
}

/**
 * Advance a blast being resolved in slices, then its landing, by up to
 * `budgetMs` of this frame. Infinity finishes both now.
 */
function stepBlastJob(budgetMs: number): void {
  const start = performance.now();
  const outOfTime = (): boolean => performance.now() - start >= budgetMs;
  const job = ctx.blastJob;
  if (job) {
    if (reportBeforeBlastJob === undefined) reportBeforeBlastJob = ctx.state?.lastBlastReport ?? null;
    const next = advance(job, outOfTime);
    if (next.done !== true) return;
    ctx.blastJob = null;
    blastLanding = landBlast(next.value, reportBeforeBlastJob);
    reportBeforeBlastJob = undefined;
    if (outOfTime()) return;
  }
  if (blastLanding !== null && advance(blastLanding, outOfTime).done === true) blastLanding = null;
}

function* landBlast(result: CommandResult, prevBlastReport: NonNullable<typeof ctx.state>['lastBlastReport'] | null): Steps<void> {
  const report = ctx.state?.lastBlastReport ?? null;
  if (ctx.state && report !== null && report !== prevBlastReport) {
    yield* gameRenderer.onBlastSteps(ctx);
    yield;
  }
  // The blast's report is already drawn above: tell the follow-up so it does not draw it again.
  afterGameCommand(result, 'tick', ctx.state, report);
}

/** Land a blast still resolving in slices, before anything else reads or changes the game. */
function finishBlastJob(): void {
  stepBlastJob(Infinity);
}

/** Everything that follows a command: renderer sync, blast effects, UI, tutorial and recap. */
function afterGameCommand(
  result: CommandResult,
  cmdName: string,
  prevState: typeof ctx.state,
  prevBlastReport: NonNullable<typeof ctx.state>['lastBlastReport'] | null,
  opts?: { syncRenderer?: boolean },
): void {
  // Cap what __gameState relays: every harness round-trips this string over
  // CDP on every step, and an unbounded command output (a `state full` once
  // shipped 318 MB, #481) turns each of those reads into a protocol timeout.
  lastCommandOutput = result.output.length > 1_000_000
    ? `${result.output.slice(0, 1_000_000)}\n…[truncated ${result.output.length - 1_000_000} of ${result.output.length} chars]`
    : result.output;
  // Sync the renderer after every command so visual changes appear immediately
  if (opts?.syncRenderer !== false) gameRenderer.syncFromContext(ctx);

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
  if (enteredNewLevel && ctx.state) onLevelStateReplaced(ctx.state);

  // Trigger blast effects after a blast (terrain remesh already happened via
  // the terrain:updated subscription above, fired from inside executeBlast).
  // Keyed on a new blast report rather than the command name (#1362): a
  // detonation can fire from inside `tick` once its zone clears, and a
  // `blast` subcommand can succeed without firing anything.
  if (!enteredNewLevel && ctx.state && ctx.state.lastBlastReport !== prevBlastReport && ctx.state.lastBlastReport !== null) {
    gameRenderer.onBlast(ctx);
  }
  // Show blast plan overlay during planning commands, and refresh it whenever
  // a preview command runs or software tier changes — otherwise the overlay's
  // softwareTier and preview data are frozen at whatever the last drill_plan/
  // charge call baked in, and a purchased tier's overlay never appears.
  if (['drill_plan', 'charge', 'preview', 'buy_software', 'blast_preview'].includes(cmdName)) {
    gameRenderer.showBlastPlanOverlay(ctx);
  }
  // Update UI after every command
  if (ctx.state) {
    uiManager.update(ctx.state, gameRenderer.blastPlayback);
    // A game exists — reveal HUD chrome unless the player is looking at the
    // menu on purpose (Quit, or mid-game Site Map). Self-correcting on every
    // command so no entry point (button, console, scenario harness) can miss it.
    if (!mainMenu.visible) uiManager.show();
  }
  if (ctx.state) tutorial.onCommandExecuted(ctx.state);
  // Deferred while the tutorial overlay is active: its own "free-play" step
  // already waits on this exact state.levelEndReason transition and shows a
  // brief congratulations card of its own — the real recap takes over once
  // that finishes, rather than both fighting for the screen at once.
  if (ctx.state && !tutorial.isActive) levelEndScreen.update(ctx.state);
}

window.__gameConsole = (cmd: string) => runGameCommand(cmd);

// --- State extraction bridges (used by scenario tests) ---
window.__gameState = () => {
  if (!ctx.state) return null;
  const s = ctx.state;
  const livingEmployees = getLivingEmployees(s.employees.employees);
  const jams = findTrafficJams(s.builtRamps, s.employees.employees);
  return {
    seed: s.seed,
    time: s.time,
    tickCount: s.tickCount,
    isPaused: s.isPaused,
    timeScale: s.timeScale,
    mineType: s.mineType,
    weather: ctx.state?.weather.current ?? null,
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
    finances: { cash: s.finances.cash },
    holeCount: s.drillHoles.length,
    // Holes ordered but not yet drilled (state.plannedDrillHoles.length) --
    // mirrors serializeGameState's own field (console-api.ts). Missing here
    // made every interaction-mode scenario asserting orderedHoleCount fail
    // with "undefined" rather than a real mismatch (#553's original
    // implementation added the field to command mode only).
    orderedHoleCount: s.plannedDrillHoles.length,
    // Charges ordered but not yet loaded (state.plannedChargesByHole) --
    // mirrors serializeGameState's own field (console-api.ts), same
    // rationale as orderedHoleCount above (#554).
    orderedChargeCount: Object.keys(s.plannedChargesByHole).length,
    chargeOrderBlockedReason: outstandingChargeBlockedReason(s),
    wetHoleCount: wetHoles(s).length,
    // Remaining not-yet-`done` segments across every in-flight
    // state.plannedRamps entry -- mirrors serializeGameState's own field
    // (console-api.ts), same rationale as orderedHoleCount/orderedChargeCount
    // above (#555). A ramp is spliced out of plannedRamps entirely once its
    // last segment lands, so this reaches 0 exactly when every ordered ramp
    // has finished.
    orderedRampSegmentCount: s.plannedRamps.reduce(
      (n, r) => n + r.segments.filter(seg => !seg.done).length, 0,
    ),
    // Finished ramps and the first one's width -- mirrors serializeGameState
    // (console-api.ts); proves a selectable/widenable ramp exists (#1298).
    builtRampCount: s.builtRamps.length,
    builtRampWidth: s.builtRamps[0]?.width ?? 0,
    // Buildings ordered but not yet built (state.plannedBuildings.length) --
    // mirrors serializeGameState's own field (console-api.ts), same
    // rationale as orderedHoleCount/orderedRampSegmentCount above (#556).
    orderedBuildingCount: s.plannedBuildings.length,
    chargedCount: Object.keys(s.chargesByHole).length,
    // Research tasks queued at a Research Center, in progress or pending --
    // mirrors serializeGameState's own field (console-api.ts). Proves a
    // research task actually completed (reaches 0) rather than a `tick N`
    // pad merely running, which a spontaneous mid-window event can silently
    // cut short.
    researchQueueLength: s.buildings.researchQueue.length,
    surveyCount: s.surveyResults.length,
    pendingActionCount: s.pendingActions.length,
    unreachableGhostCount: s.ghostPreviews.filter(g => g.unreachable === true).length,
    buildingCount: s.buildings.buildings.length,
    maxBuildingTier: getMaxBuildingTier(s.buildings),
    vehicleCount: s.vehicles.vehicles.length,
    // Mirrors serializeGameState (console-api.ts): active jams, silencing ignored (#1208).
    trafficJamCount: jams.length,
    trafficJams: jams.map(j => ({ kind: j.kind, rampId: j.rampId })),
    // Raw roster size, dead included — deliberate: `killEmployee` never
    // splices `employees` (only `fireEmployee` does), so this stays a
    // total-ever-hired count. `deathCount` tracks how many of them died; the
    // six fields below this one filter to the living roster instead.
    employeeCount: s.employees.employees.length,
    // Qualifications the roster holds, so an interaction-mode check can prove
    // a skill was actually obtained rather than that a button merely looked clickable.
    qualificationCount: livingEmployees
      .reduce((n, e) => n + e.qualifications.length, 0),
    proficiencyTotal: livingEmployees
      .reduce((n, e) => n + e.qualifications.reduce((m, q) => m + q.proficiencyLevel, 0), 0),
    trainingCount: livingEmployees.filter(e => e.trainingState !== null).length,
    // Needs mechanics: proves fatigue actually built up and collapse actually
    // fired, rather than a scenario guessing at it from a screenshot alone.
    collapsedCount: livingEmployees.filter(e => e.collapsing).length,
    minFatigue: livingEmployees.reduce((m, e) => Math.min(m, e.fatigue), 100),
    insideBuildingCount: livingEmployees.filter(e => isInsideBuilding(e.locomotion)).length,
    stuckEmployeeCount: livingEmployees.filter(e => e.isMoveStuck).length,
    activeContractCount: s.contracts.active.length,
    // An offered ore_sale the site could fill outright right now — the
    // condition a scenario waits on before clicking Accept, since which ore
    // the board asks for and how much of it are both random per refresh.
    // Mirrors console-api.ts's own field so both modes read the same thing.
    fillableOreSaleOffered: hasFillableOreSaleOffer(s.contracts.available, s.collectedOre),
    fillableDirtiteSaleOffered: hasFillableOreSaleOffer(s.contracts.available, s.collectedOre, 'dirtite'),
    fillableRustiteSaleOffered: hasFillableOreSaleOffer(s.contracts.available, s.collectedOre, 'rustite'),
    winningRustiteSaleOffered: hasWinningOreSaleOffer(s.contracts.available, s.collectedOre, 'rustite', getProfitShortfall(s.campaign.activeLevelId, s.finances)),
    // An offered rubble_disposal contract, present in the pool at all — the
    // condition a scenario waits on before opening the Contracts panel for
    // that offer's own Accept button (issue #1263 CI-fix). Mirrors
    // console-api.ts's own field so both modes read the same thing.
    rubbleDisposalOffered: hasRubbleDisposalOffer(s.contracts.available),
    blastBanned: isActive(s.events.activeModifiers, 'blast_ban', s.tickCount), // mirrors serializeGameState
    blingiteSaleOffered: hasOreSaleOffer(s.contracts.available, 'blingite'),
    fillableSaleOffered: hasFillableSaleOffer(s.contracts.available, s.collectedOre, stateRubbleStockKg(s)),
    deathCount: s.damage.deathCount,
    vehicleBoardingCount: s.vehicles.driverBoardingCount ?? 0,
    levelEnded: s.levelEnded,
    levelEndReason: s.levelEndReason,
    // Typed mirror of `ctx.state.events.pendingEvent !== null` (EventSystem.ts)
    // for the scenario harness — `resolveEventIfPending`/`waitUntil`
    // (interaction-executor.ts) used to infer this by regex-matching
    // `event status`'s text output, the same "ask the game, not the DOM"
    // principle those actions already apply to clicks, just not yet to this
    // one console command's own copy.
    pendingEvent: s.events.pendingEvent !== null,
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
    storedSpoilKg: totalSpoilKg(s.buildings.buildings),
    // Sum across every material key in state.collectedOre (kg) -- mirrors
    // serializeGameState's own field (console-api.ts), same rationale as
    // orderedHoleCount above: a scenario asserting ore was actually
    // delivered (not just spoil) needs a single numeric field to check
    // increased/decreased/changedBy against (#671).
    collectedOreTotal: totalCollectedOreKg(s.collectedOre),
    dangerZoneClear: isDangerZoneClear(s.drillHoles, s.vehicles, s.employees), // mirrors serializeGameState (#557)
    corruptionLevel: s.corruption.level, // mirrors serializeGameState (#1407)
    taxAuditCount: s.taxAudit.auditsCount, // mirrors serializeGameState (#1409)
    lastCommandOutput,
    frameCount: scene.frameCount,
    ctxGridId: ctx.grid?.id ?? null,
    consoleLogs: consoleLogs.splice(0, 50),
    // Sample voxels at blast center to check if they're cleared — centered on
    // the column's real surface, not a fixed low window: the grid has no
    // vertical cap, so a dug-below-0 or built-up site would otherwise sample
    // the wrong rows (#1187).
    gridSample: ctx.grid ? (() => {
      const g = ctx.grid;
      const surface = computeVoxelColumnSurfaceY(g, 15, 15) ?? 0;
      const sample: Record<string, number> = {};
      for (let y = surface - 4; y < surface + 5; y++) {
        const v = g.getVoxel(15, y, 15);
        sample[`15,${y},15`] = v?.density ?? -1;
      }
      return sample;
    })() : null,
    // Cross-section: sample a line of columns through the blast center, each
    // centered on its own real surface (#1187) so the section tracks uneven
    // or dug terrain rather than a fixed low window.
    gridCrossSection: ctx.grid ? (() => {
      const g = ctx.grid;
      const xs = [10,11,12,13,14,15,16,17,18,19,20,21,22];
      const sample: Record<string, number> = {};
      for (const x of xs) {
        const surface = computeVoxelColumnSurfaceY(g, x, 15) ?? 0;
        for (let y = surface - 2; y < surface + 3; y++) {
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
let autoTickEnabled = !scenarioMode;
window.__setAutoTick = (enabled: boolean) => { autoTickEnabled = enabled; };
window.__setTutorialClockFollowsTimer = (enabled: boolean) => tutorial.setClockFollowsTimer(enabled);

// Drawing control for the browser-driven harnesses (#475). They need pixels
// only at a screenshot, but every CDP call they make waits on the render
// loop — which the terrain material makes cost seconds per frame in software
// rasterisation. Suspending the draw and forcing one frame per capture keeps
// the images identical and stops the suites paying for frames nobody sees.
window.__setRenderEnabled = (enabled: boolean) => { scene.setDrawingEnabled(enabled); };
// A scenario run starts with drawing already suspended, before the loop
// below draws anything. Every harness suspends drawing as soon as it sees
// the canvas, and every capture forces its own frame (`captureFrame`), so
// the frames drawn between page load and that first `suspendDrawing` were
// never looked at — and without a GPU they are the whole cost of a page
// boot: ~10 s of shader compilation and software rasterisation per tab,
// paid once per scenario in the batch runner, before its first step ran.
// The loop itself still runs: rAF resolves, `onUpdate` fires, the UI
// updates — only the draw waits for a harness to ask for one.
if (scenarioMode) scene.setDrawingEnabled(false);
// Resolves once every model asset is in (or reported failed). A harness that
// enters a level through __gameConsole skips enterLevel()'s wait on this, so
// it awaits it here before capturing a frame it wants to show real assets.
window.__modelsReady = () => modelsReady.then(r => ({ loaded: r.loaded.length, failed: r.failed }));
// A forced frame shows settled terrain: a deferred blast remesh lands first (#1603).
window.__renderFrame = () => { finishBlastJob(); gameRenderer.finishTerrainRemesh(); scene.renderFrame(); };
// Landscape chunks still queued for the current camera position (#1153's
// streamer is budgeted per frame). A capture taken while this is non-zero
// shows sky where ground has not been built yet, with scenery floating in
// it — so `captureFrame` drains the queue through __landscapeFlush and
// checks __landscapePending before it shoots. Waiting the budget out is not
// an option there: without a GPU one drawn frame costs seconds, so the ~56
// frames a full ladder needs are minutes per screenshot.
window.__landscapePending = () => gameRenderer.landscapePendingChunks;
window.__landscapeFlush = () => gameRenderer.flushLandscapeStreaming();

// Debug: expose grid reference info for diagnostics
window.__debugGridInfo = () => {
  return {
    ctxGridId: ctx.grid?.id ?? null,
    lastGridId: gameRenderer.lastGridId,
    terrainGridId: gameRenderer.terrain?.gridId ?? null,
    ghostCount: gameRenderer.ghostCount,
    taskProgressBarCount: gameRenderer.taskProgressBarCount,
    pictogramCount: gameRenderer.pictogramCount,
    ghostPreviewsInState: ctx.state?.ghostPreviews.length ?? -1,
    surveyOverlayVisible: gameRenderer.surveyOverlayVisible,
    lastGhostRevisionSynced: gameRenderer.lastGhostRevisionSynced,
    terrainMeshRevisionCount: gameRenderer.terrainMeshRevisionCount,
    lastTerrainRevisionSynced: gameRenderer.lastTerrainRevisionSynced,
    modelsLoaded: modelLibrary.size,
    modelRevision: modelLibrary.revision,
    ambientMissingModelIds: gameRenderer.ambientMissingModelIds,
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
  return {
    panels: panelStates,
    blastPanelButtons: buttons,
    // Which Blast Workshop step tab is active, for the scenario harness's
    // `ensureStep` action (interaction-executor.ts) — the panel's own
    // autoAdvance can move the tab out from under a scenario mid-sequence.
    activeBlastStep: uiManager.blastActiveStep,
    // The entity inspector (6.18): whether it is open and on what.
    inspector: { open: inspector.open, kind: inspector.target?.kind ?? null, id: inspector.target?.id ?? null },
  };
};

// What can a player actually click right now? Used by interaction mode so a
// failure reports "Run is disabled because <hint>" rather than a selector timeout.
window.__uiActions = () => probeUiActions();
window.__probeSelector = (selector: string) => probeSelector(selector);

// Where the tutorial believes it is. A harness that only checks for thrown
// errors cannot tell a completed step from a silently stuck one.
window.__tutorialState = () => probeTutorialState(tutorial);

// Camera control bridges (used by scenario-test.ts for multi-angle screenshots)
window.__cameraOrbit = (yaw?: number, pitch?: number) => {
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
  currentPhase: () => placementController.currentPhase,
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
  // Accept-on-tile-match: reproduce the same combined entity+terrain pick a
  // real click resolves through (pickScene/PlacementController), so an
  // occluding entity or a terraced/stepped tile is never accepted as a
  // best-guess nearest point — see ScreenTileResolution.ts.
  //
  // Quantized through integer CSS pixels, not raw NDC: a real MouseEvent's
  // clientX/clientY are always integers (DOM spec), so a real click can
  // only ever land on the pixel this rounds to — never the exact
  // floating-point NDC projectToNDC returns. On steep or near-tangential
  // terrain (a pit wall, this being an open-pit mine) that sub-pixel
  // rounding is enough to shift the ray onto a completely different
  // surface: verified against the unquantized NDC, pixel (442, 360) round-
  // tripped to tile (5, 5); the same pixel, read back as an integer
  // MouseEvent.clientX/Y the way PlacementController's tileUnderCursor
  // does, resolved tile (1, -7) instead. Rounding to the pixel a real click
  // will actually deliver, then re-deriving NDC from that same integer
  // pixel before raycasting, makes every candidate this loop accepts one a
  // real click at the returned px/py is guaranteed to reproduce.
  const rect = canvas.getBoundingClientRect();
  const project: ProjectToNDC = (px, py, pz) => {
    const raw = scene.cameraController.projectToNDC(px, py, pz);
    const quantizedPx = Math.round(rect.left + (raw.x * 0.5 + 0.5) * rect.width);
    const quantizedPy = Math.round(rect.top + (1 - (raw.y * 0.5 + 0.5)) * rect.height);
    return {
      x: ((quantizedPx - rect.left) / rect.width) * 2 - 1,
      y: -((quantizedPy - rect.top) / rect.height) * 2 + 1,
      z: raw.z,
    };
  };
  const raycastForTile: RaycastForTile = (ndcX, ndcY) => {
    const pick = pickScene(ndcX, ndcY, scene.camera, gameRenderer, undefined, false);
    if (!pick.terrain) return null; // entity occlusion or a miss — honestly a miss, never silently ignored
    return { x: pick.terrain.point.x, y: pick.terrain.point.y, z: pick.terrain.point.z };
  };
  // onScreen is independent of tileConfirmed: it asks only whether the tile
  // centre's own projection lands in front of the camera — the same z < 1
  // behind-camera check the pre-#1227 code used for its own onScreen —
  // computed here, before resolveScreenPointForTile's convergence loop ever
  // runs. Without this, an on-screen tile that fails to resolve (entity
  // occlusion, terraced ground) was misreported as off-screen, since both
  // fields were set from the same success/failure branch — defeating the two
  // distinct throws scripts/shared/tile-picker.ts's worldToScreenPoint relies
  // on to tell "frame it with a camera move" apart from "occluded/mismatched".
  const onScreen = project(cx, startY, cz).z < 1;
  const result: ScreenTileResolution = resolveScreenPointForTile(project, raycastForTile, x, z, startY);
  if (!result.resolved) {
    return result.reason === undefined
      ? { px: 0, py: 0, onScreen, tileConfirmed: false }
      : { px: 0, py: 0, onScreen, tileConfirmed: false, failureReason: result.reason };
  }
  // ndc is already pixel-quantized (project() rounds it above), so this
  // recovers exactly the integer pixel that was verified — Math.round only
  // guards against float round-trip noise, not a second rounding decision.
  const ndc = result.ndc;
  return {
    px: Math.round(rect.left + (ndc.x * 0.5 + 0.5) * rect.width),
    py: Math.round(rect.top + (1 - (ndc.y * 0.5 + 0.5)) * rect.height),
    onScreen,
    tileConfirmed: true,
  };
};
// Put the collapse straight on its resting place, for shots of the settled muck
// pile. The animation only walks rock to where the blast already put it, so
// skipping it changes nothing — and without a GPU it would otherwise take
// minutes of wall clock to play out (#475).
window.__skipBlastPlayback = () => {
  finishBlastJob();
  gameRenderer.finishTerrainRemesh();
  gameRenderer.skipFragmentPlayback();
  gameAudio.cancelBlast(); // the debris rain is scheduled ahead on the audio clock: cut what has not landed
};
// Hold the collapse at a chosen moment, so a harness can step through it at the
// spacing the pictures need rather than the spacing the frame rate allows.
window.__seekBlastPlayback = (t: number) => {
  gameRenderer.seekFragmentPlayback(t);
  gameAudio.cancelBlast();
};
window.__blastPlaybackDuration = () => gameRenderer.fragmentPlaybackDuration;
// How far a blast's deferred crater remesh has to go (#1603), for a harness waiting on it.
window.__terrainRemeshPending = () => gameRenderer.terrain?.pendingRemeshCount ?? 0;

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
// The tutorial only runs scripted demonstrations through this console, so its commands make no player sound.
tutorial.setGameConsole((cmd) => runGameCommand(cmd, { scripted: true }));

// Tutorial start bridge (Puppeteer) + console command (scenario tests)
window.__startTutorial = () => tutorial.start(ctx.state ?? undefined);
runner.register('tutorial_start', 'Start the tutorial overlay', () => {
  window.__startTutorial();
  return { success: true, output: 'Tutorial started' };
});
// Picking a speed also resumes: the speed segments and the pause segment form one radio group.
function selectSpeedAndResume(n: number): void {
  window.__gameConsole(`time speed ${n} resume:true`);
}
uiManager.setSpeedChangeHandler(selectSpeedAndResume);
uiManager.setQuitHandler(() => {
  tutorial.suspend(); // lifts the rails so the menu is clickable; keeps progress so Resume continues guided
  levelEndScreen.hide();
  mainMenu.show();
  uiManager.hide();
});

// Site-map and Saves buttons live in the top bar's right cluster (shell/TopBar.ts) —
// folded in from two ad-hoc floating buttons that used to collide with the
// paused/event chip (spec §5 defect).
uiManager.setSiteMapHandler(() => {
  savesModal.hide();
  uiManager.closeActivePanel();
  worldMap.show(ctx.campaignProfile.campaign, { canReturnToSite: isLiveGame() });
});
uiManager.setOpenSavesHandler(() => savesModal.show());
uiManager.setMapFocusHandler((x, z) => {
  scene.cameraController.focus(x, gameRenderer.surfaceYAt(x, z), z, 60);
});
uiManager.setSelectVehicleHandler((vehicleId) => {
  scenePicking.select({ kind: 'vehicle', id: vehicleId, point: new THREE.Vector3(), distance: 0 });
});

uiManager.setSelectBuildingHandler((buildingId) => {
  scenePicking.select({ kind: 'building', id: buildingId, point: new THREE.Vector3(), distance: 0 });
});

uiManager.setSelectEmployeeHandler((employeeId) => {
  scenePicking.select({ kind: 'employee', id: employeeId, point: new THREE.Vector3(), distance: 0 });
});

// --- Scene picking wiring (redesign P2) ---
scenePicking.setRestChangeHandler((rest) => {
  if (ctx.state) hoverTag.update(rest, ctx.state, gameRenderer.surveyOverlayVisible);
});
/** Anchor the selection outline was last drawn on; a change (employee steps out, fragment loaded, site finished, ramp widened) re-draws it. */
let shownAnchorKey: string | null = null;
function anchorKey(entity: EntityPick, anchor: SelectionAnchor, state: GameState): string {
  const ramp = entity.kind === 'ramp' ? state.builtRamps.find(r => r.id === entity.id) : undefined;
  if (ramp) return `ramp:${ramp.width}`;
  if (anchor.type === 'self') return 'self';
  if (anchor.type === 'host') return `host:${anchor.kind}:${anchor.id}`;
  const f = anchor.footprint;
  return `site:${f.minX},${f.maxX},${f.minZ},${f.maxZ}`;
}
function anchorWorldPosition(entity: EntityPick, anchor: SelectionAnchor, state: GameState): THREE.Vector3 | null {
  const f = anchorFootprint(anchor, state);
  if (!f) return gameRenderer.entityWorldPosition(anchor.type === 'host' ? anchor.kind : entity.kind, anchor.type === 'host' ? anchor.id : entity.id);
  const x = (f.minX + f.maxX + 1) / 2, z = (f.minZ + f.maxZ + 1) / 2;
  return new THREE.Vector3(x, gameRenderer.smoothSurfaceYAt(x, z), z);
}
/**
 * Whether the selected entity no longer exists. Host-resolved kinds answer from their resolution
 * (null when no state yet: not gone); other kinds are gone when the renderer has no position for them.
 */
function isSelectionGone(resolvedExists: boolean | null, hostResolved: boolean, pos: THREE.Vector3 | null): boolean {
  if (resolvedExists !== null) return !resolvedExists;
  return !hostResolved && !pos;
}
function showSelection(entity: EntityPick, state: GameState): void {
  inspector.show(entity, state);
  const resolved = isHostResolvedKind(entity.kind) ? resolveSelection(state, entity.kind, entity.id) : null;
  const anchor: SelectionAnchor = resolved?.exists ? resolved.anchor : { type: 'self' };
  shownAnchorKey = anchorKey(entity, anchor, state);
  const pos = anchorWorldPosition(entity, anchor, state);
  const footprint = anchorFootprint(anchor, state);
  const ramp = entity.kind === 'ramp' ? state.builtRamps.find(r => r.id === entity.id) : undefined;
  if (pos && ramp) entityHighlight.showFootprint(ramp.footprint, pos, (x, z) => gameRenderer.smoothSurfaceYAt(x, z));
  else if (pos && footprint) entityHighlight.showFootprint(footprint, pos, (x, z) => gameRenderer.smoothSurfaceYAt(x, z));
  else if (pos) entityHighlight.show(pos, anchor.type === 'host' ? anchor.kind : entity.kind);
  else entityHighlight.hide();
}
scenePicking.setSelectChangeHandler((entity) => {
  uiManager.setListSelection(entity ? { kind: entity.kind, id: entity.id } : null);
  if (entity && ctx.state) {
    showSelection(entity, ctx.state);
    uiCues.entitySelected(entity.kind);
  } else {
    shownAnchorKey = null;
    inspector.hide();
    entityHighlight.hide();
  }
});
// Esc deselects before falling through to the panel/modal layers beneath it —
// registered before the Site Map layer, which outranks it (most recently
// registered wins, per UIManager.registerEscLayer).
uiManager.registerEscLayer(() => {
  // An armed pick (Move Here / Dispatch Here) outranks deselecting: Esc cancels it first.
  if (placementController.isArmed || !scenePicking.selection) return false;
  scenePicking.clearSelection();
  return true;
});
// Esc on the Site Map returns to the live site (unless a confirm is up — that closes first).
// Registered after the deselect layer so it is tried first (most recently registered wins).
uiManager.registerEscLayer(() => !uiManager.confirmOpen && worldMap.requestReturnToSite());
// Esc closes the Saves modal, outranking deselect/Site Map; a confirm or event modal on top keeps Esc.
uiManager.registerEscLayer(() => !uiManager.confirmOpen && !uiManager.eventModalVisible && savesModal.handleEscape());

/** Report a failed console command from an inspector action as a toast; success is silent (the world visibly changing is the feedback). */
function reportIfFailed(title: string, result: CommandResult): void {
  if (!result.success) uiManager.notify({ severity: 'warn', title, body: result.output });
}
/** Order-style actions finish later, so success says "ordered" (the command's own output) rather than staying silent (#1392). */
function reportOrderResult(title: string, result: CommandResult): void {
  uiManager.notify({ severity: result.success ? 'info' : 'warn', title, body: result.output });
}
inspector.setSelectHandler((entity) => scenePicking.select(entity));
inspector.setCloseHandler(() => scenePicking.clearSelection());
inspector.setCommandHandler((command) => reportIfFailed(t('inspector.command_failed'), window.__gameConsole(command)));
inspector.setConfirmHandler((cfg) => uiManager.showConfirm(cfg));
inspector.setActionHandler((action, entity) => {
  switch (action) {
    case 'dispatch_here': {
      // Touch-friendly: arms the in-scene tile pick (own tile pre-selected) instead of reading a hover.
      const employee = ctx.state?.employees.employees.find(e => e.id === entity.id);
      if (!employee) break;
      const title = t('inspector.action.dispatch_here');
      armEntityMovePick(placementKit, { kind: 'employee', id: employee.id, name: employee.name, x: employee.x, z: employee.z },
        (cmd) => reportIfFailed(title, window.__gameConsole(cmd)));
      break;
    }
    case 'upgrade_vehicle':
      reportIfFailed(t('inspector.action.upgrade_vehicle'), window.__gameConsole(`vehicle upgrade ${entity.id}`));
      break;
    case 'move_here': {
      const vehicle = ctx.state?.vehicles.vehicles.find(v => v.id === entity.id);
      if (!vehicle) break;
      const title = t('inspector.action.move_here');
      armEntityMovePick(placementKit, { kind: 'vehicle', id: vehicle.id, name: vehicleDisplayName(vehicle.type, vehicle.tier), x: vehicle.x, z: vehicle.z },
        (cmd) => reportIfFailed(title, window.__gameConsole(cmd)));
      break;
    }
    case 'locate': {
      // An employee inside a building or vehicle has no mesh: frame the host the outline is on.
      const state = ctx.state;
      const resolved = state && isHostResolvedKind(entity.kind) ? resolveSelection(state, entity.kind, entity.id) : null;
      const pos = state && resolved?.exists
        ? anchorWorldPosition(entity, resolved.anchor, state)
        : gameRenderer.entityWorldPosition(entity.kind, entity.id);
      const distance = entity.kind === 'vehicle' || entity.kind === 'employee' ? 40 : 20;
      if (pos) scene.cameraController.focus(pos.x, pos.y, pos.z, distance);
      break;
    }
    case 'upgrade':
      // The Build panel's own flow (research guard, cutoff confirm) without opening the panel (#1758).
      uiManager.upgradeBuilding(entity.id);
      break;
    case 'research':
      uiManager.queueBuildingResearch(entity.id);
      break;
    case 'move':
      uiManager.moveBuilding(entity.id);
      break;
    case 'widen': {
      const ramp = ctx.state?.builtRamps.find(r => r.id === entity.id);
      const next = ramp ? nextRampWidth(ramp.width) : null;
      if (next !== null) reportIfFailed(t('inspector.action.widen'), window.__gameConsole(`widen_ramp id:${entity.id} width:${next}`));
      break;
    }
    case 'demolish': {
      const placedBuilding = ctx.state?.buildings.buildings.find(x => x.id === entity.id);
      if (!placedBuilding) break;
      const storedOreKg = ctx.state ? freightOreKg(ctx.state.logistics, placedBuilding) : 0;
      uiManager.showConfirm(buildDemolishConfirm(placedBuilding, () => {
        reportOrderResult(t('inspector.action.demolish'), window.__gameConsole(`build destroy ${entity.id}`));
      }, { storedOreKg }));
      break;
    }
  }
});

savesModal.setOnLoad((state) => {
  // Restore loaded state into the runner context via the shared
  // version-check + restore/regenerate branch (`loadGridForState`,
  // world.ts, #1181) — the same one the console `load` command uses, so the
  // two can't drift out of sync the way `regenerateGrid`'s own doc comment
  // warns about (#408). A save with no embedded voxels at all falls back to
  // regenerating pristine terrain from seed; a present payload whose
  // generator version doesn't match this build is refused outright instead.
  const refusal = loadGridForState(ctx, state);
  if (refusal) {
    return refusal;
  }
  // Same level-entry fix-ups as starting a level (#571, #1315). `state`, not
  // `ctx.state`: loadGridForState assigned it, but TS cannot see that.
  persistCampaignProfile();
  onLevelStateReplaced(state);
  // The overlay still holds the replaced state, so abandoning clears that
  // state's progress, never the loaded one's (#1333).
  if (tutorial.isActive) tutorial.abandon();
  worldMap.hide();
  uiManager.show();
  gameRenderer.syncFromContext(ctx);
  if (shouldKeepTutorialRunning(state.campaign.activeLevelId)) tutorial.resume(state);
  return null;
});

// --- Keyboard Shortcuts ---
// Space-bar shortcut toggles `time pause`/`time resume`; the top bar's pause
// segment only pauses (idempotent) — resuming is picking a speed.
function togglePause(): void {
  window.__gameConsole(ctx.state?.isPaused ? 'time resume' : 'time pause');
}
function pauseClock(): void {
  window.__gameConsole('time pause');
}
uiManager.setTogglePauseHandler(pauseClock);
new KeyboardShortcuts({
  togglePause,
  // Same path as the top-bar speed segments: pick the speed and resume.
  setSpeed: selectSpeedAndResume,
  togglePanel: (name) => uiManager.togglePanel(name),
  quickSave: () => { void savesModal.quickSave(); },
  onEscape: () => uiManager.handleEscape(),
  onToggleNavGrid: () => uiManager.toggleNavGridOverlay(),
  // Keep the panel's own button in sync even while the panel is closed —
  // its click handler is the other path into the same preference, and the
  // two must never disagree the next time the panel opens.
  onToggleSurveyOverlay: () => {
    const visible = !gameRenderer.surveyOverlayVisible;
    applySurveyOverlayVisible(visible);
    uiManager.setSurveyOverlayVisible(visible);
  },
}, { isSuppressed: fullScreenMenuUp, isControlLive });

// --- Render loop + game tick timer ---
// The game ticks at BASE_TICK_MS intervals, adjusted for time scale.
// At 1x speed: 1 tick/second. At 4x: 4 ticks/second.
// Accumulated time prevents tick drift from frame-rate variation.
let accumulatedGameMs = 0;

/** A full-screen menu covers the mine; the simulation must not run behind it. */
function fullScreenMenuUp(): boolean {
  return mainMenu.visible || worldMap.visible || levelEndScreen.visible || loadingScreen.visible || sandboxPanel.visible;
}

scene.start((dt) => {
  gameRenderer.update(dt);
  entityHighlight.update(dt);
  // Keep the selection ring on a moving vehicle/employee; if the selected
  // entity is gone (destroyed, hauled away, collected), deselect it —
  // the select-change handler above then hides the ring and the inspector.
  const selection = scenePicking.selection;
  if (selection) {
    const state = ctx.state;
    const kind = selection.kind;
    const hostResolved = isHostResolvedKind(kind);
    const resolved = state && hostResolved ? resolveSelection(state, kind, selection.id) : null;
    const pos = state && resolved
      ? (resolved.exists ? anchorWorldPosition(selection, resolved.anchor, state) : null)
      : hostResolved ? null : gameRenderer.entityWorldPosition(selection.kind, selection.id);
    if (isSelectionGone(resolved ? resolved.exists : null, hostResolved, pos)) scenePicking.clearSelection();
    else {
      if (state) inspector.update(state);
      // The inspector hides itself once the entity left the state; the selection and outline follow.
      if (state && !inspector.open) scenePicking.clearSelection();
      else if (state && anchorKey(selection, resolved?.exists ? resolved.anchor : { type: 'self' }, state) !== shownAnchorKey) {
        showSelection(selection, state);
      } else if (pos) entityHighlight.setPosition(pos);
    }
  }

  // Advance game time. A blast resolving in slices holds the clock until it lands (#1603).
  if (blastInProgress()) {
    stepBlastJob(BLAST_JOB_FRAME_BUDGET_MS);
    accumulatedGameMs = 0;
  } else if (ctx.state && !ctx.state.isPaused && autoTickEnabled && !hasLevelEnded(ctx.state) && !fullScreenMenuUp()) {
    accumulatedGameMs += dt * 1000;
    // Tick every BASE_TICK_MS ms; timeScale is handled inside tickCommand
    while (accumulatedGameMs >= BASE_TICK_MS) {
      accumulatedGameMs -= BASE_TICK_MS;
      window.__gameConsole(`tick ${ctx.state.timeScale}`);
      // Stop if game paused mid-loop (e.g. an event fired), or a blast started resolving
      if (ctx.state.isPaused || ctx.blastJob) {
        accumulatedGameMs = 0;
        break;
      }
    }
  } else {
    // Gate closed: drop banked time so reopening does not burst-tick.
    accumulatedGameMs = 0;
  }

  // Update UI from current state on each frame
  if (ctx.state) {
    uiManager.update(ctx.state, gameRenderer.blastPlayback);
    if (!mainMenu.visible) uiManager.show();
    if (!fullScreenMenuUp()) savesModal.onTick(ctx.state);
  }
  if (ctx.state && !tutorial.isActive) levelEndScreen.update(ctx.state);

  // Sound follows the camera's ground target (stable under blast shake, unlike camera.position) and its right
  // vector, with real seconds: the sim's speed never changes how long a sound lasts.
  const viewTarget = scene.cameraController.viewTarget;
  const right = scene.cameraController.groundRight();
  const viewDistance = scene.cameraController.distance;
  gameAudio.update({
    dtS: dt,
    state: ctx.state,
    menuUp: fullScreenMenuUp(),
    listener: { x: viewTarget.x, z: viewTarget.z, rightX: right.x, rightZ: right.z, viewDistance },
  });
  music?.update(deriveMusicContext({
    menuVisible: mainMenu.visible || worldMap.visible || sandboxPanel.visible,
    loadingVisible: loadingScreen.visible,
    levelEndVisible: levelEndScreen.visible,
    mineType: ctx.state?.mineType,
    activeLevelId: ctx.state?.campaign.activeLevelId,
  }));
});
