// @vitest-environment jsdom
// UIManager routes the building inspector's Move / Upgrade / Research to the
// Build panel's shared flows without ever opening the panel (#1758).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UIManager } from '../../../src/ui/UIManager.js';
import { MiniMap } from '../../../src/ui/MiniMap.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { PlacementKit } from '../../../src/ui/scene/PlacementKit.js';
import type { PlacementSelection, PlacementArmConfig, PlacementConfirmHandler } from '../../../src/ui/scene/PlacementController.js';
import type { CommandResult } from '../../../src/console/ConsoleRunner.js';

function makeKit() {
  let armed = false;
  let selection: PlacementSelection | null = null;
  let confirmHandler: PlacementConfirmHandler | null = null;
  const controller = {
    get isArmed() { return armed; },
    get currentPhase() { return armed ? (selection ? 'selected' : 'armed') : 'idle'; },
    get selection() { return selection; },
    activeRegion: null,
    hoveredTile: null,
    previewOrigin: null,
    get canConfirm() { return selection !== null; },
    setConfirmHandler: (cb: PlacementConfirmHandler) => { confirmHandler = cb; },
    setCancelHandler: vi.fn(),
    setChangeHandler: vi.fn(),
    setFootprintCheck: vi.fn(),
    arm: (_c: PlacementArmConfig) => { armed = true; },
    cancel: () => { armed = false; selection = null; },
    select(sel: PlacementSelection) { selection = sel; },
    confirm() { return selection ? confirmHandler?.(selection) : undefined; },
  };
  const overlay = { update: vi.fn(), clear: vi.fn(), flashConfirm: vi.fn() };
  const strip = { show: vi.fn(), hide: vi.fn(), setConfirmHandler: vi.fn(), setCancelHandler: vi.fn() };
  return { kit: { controller, overlay, strip } as unknown as PlacementKit, controller };
}

describe('UIManager — building flows without the Build panel (#1758)', () => {
  let container: HTMLElement;
  let ui: UIManager;
  let gameConsole: ReturnType<typeof vi.fn<[string], CommandResult>>;
  let state: GameState;

  const buildPanel = (): HTMLElement => container.querySelector('#bs-build-panel') as HTMLElement;
  const panelOpen = (): boolean => buildPanel().style.display !== 'none' && buildPanel().style.display !== '';

  beforeEach(() => {
    vi.spyOn(MiniMap.prototype, 'update').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
    ui = new UIManager(container);
    gameConsole = vi.fn<[string], CommandResult>().mockReturnValue({ success: true, output: '' });
    ui.setGameConsole(gameConsole);
    state = createGame({ seed: 42, mineType: 'desert' });
    state.cash = 99999;
    state.buildings.buildings = [{ id: 7, type: 'management_office', tier: 1, x: 5, z: 5, hp: 100, active: true, occupantIds: [] }];
  });

  afterEach(() => {
    ui.dispose();
    container.remove();
    vi.restoreAllMocks();
  });

  it('moveBuilding arms the placement tool and a confirmed spot dispatches build move, panel closed', () => {
    const { kit, controller } = makeKit();
    ui.setPlacementKit(kit);
    ui.update(state);

    ui.moveBuilding(7);

    expect(controller.isArmed).toBe(true);
    expect(panelOpen()).toBe(false);
    controller.select({ x1: 20, z1: 21, x2: 20, z2: 21 });
    controller.confirm();
    expect(gameConsole).toHaveBeenCalledWith('build move 7 to:20,21');
    expect(panelOpen()).toBe(false);
  });

  it('moveBuilding on an unknown id arms nothing', () => {
    const { kit, controller } = makeKit();
    ui.setPlacementKit(kit);
    ui.update(state);
    ui.moveBuilding(404);
    expect(controller.isArmed).toBe(false);
  });

  it('upgradeBuilding dispatches build upgrade for an unlocked tier, panel closed', () => {
    state.buildings.unlockedTiers['management_office'] = 2;
    ui.update(state);
    ui.upgradeBuilding(7);
    expect(gameConsole).toHaveBeenCalledWith('build upgrade 7');
    expect(panelOpen()).toBe(false);
  });

  it('upgradeBuilding on a locked tier does not upgrade', () => {
    ui.update(state);
    ui.upgradeBuilding(7);
    expect(gameConsole).not.toHaveBeenCalledWith(expect.stringContaining('build upgrade'));
  });

  it('queueBuildingResearch dispatches research queue for the next tier of the building, panel closed', () => {
    ui.update(state);
    ui.queueBuildingResearch(7);
    expect(gameConsole).toHaveBeenCalledWith('research queue type:management_office tier:2');
    expect(panelOpen()).toBe(false);
  });

  it('the state fed to update() is the one the flows read, even with the Build panel hidden', () => {
    const { kit, controller } = makeKit();
    ui.setPlacementKit(kit);
    // No update yet: the building is unknown, so nothing arms.
    ui.moveBuilding(7);
    expect(controller.isArmed).toBe(false);
    ui.update(state);
    ui.moveBuilding(7);
    expect(controller.isArmed).toBe(true);
  });
});
