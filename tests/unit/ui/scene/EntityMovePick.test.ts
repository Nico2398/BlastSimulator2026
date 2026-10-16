// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { armEntityMovePick } from '../../../../src/ui/scene/EntityMovePick.js';
import { t } from '../../../../src/core/i18n/I18n.js';
import type { PlacementKit } from '../../../../src/ui/scene/PlacementKit.js';
import type {
  PlacementSelection, PlacementArmConfig, PlacementConfirmHandler, PlacementChangeHandler,
} from '../../../../src/ui/scene/PlacementController.js';

/** Stand-in for PlacementController/SelectionOverlay/ParamStrip (same shape as FleetPanel.test.ts's mock kit). */
function makeMockKit() {
  let armed = false;
  let phase: 'idle' | 'armed' | 'selected' = 'idle';
  let selection: PlacementSelection | null = null;
  let confirmHandler: PlacementConfirmHandler | null = null;
  let changeHandler: PlacementChangeHandler | null = null;
  const controller = {
    get isArmed() { return armed; },
    get currentPhase() { return phase; },
    get selection() { return selection; },
    get activeRegion() { return null; },
    get canConfirm() { return selection !== null; },
    setConfirmHandler: (cb: PlacementConfirmHandler) => { confirmHandler = cb; },
    setCancelHandler: vi.fn(),
    setChangeHandler: (cb: PlacementChangeHandler) => { changeHandler = cb; },
    arm: (config: PlacementArmConfig) => {
      armed = true;
      phase = config.initialSelection ? 'selected' : 'armed';
      selection = config.initialSelection
        ? { x1: config.initialSelection.x, z1: config.initialSelection.z, x2: config.initialSelection.x, z2: config.initialSelection.z }
        : null;
    },
    cancel: () => { armed = false; phase = 'idle'; selection = null; changeHandler?.(); },
    simulateSelect(sel: PlacementSelection) { selection = sel; phase = 'selected'; changeHandler?.(); },
    simulateConfirm() { if (selection) confirmHandler?.(selection); },
  };
  const overlay = { update: vi.fn(), clear: vi.fn(), flashConfirm: vi.fn() };
  const strip = { show: vi.fn(), hide: vi.fn(), setConfirmHandler: vi.fn(), setCancelHandler: vi.fn() };
  return { kit: { controller, overlay, strip } as unknown as PlacementKit, controller, overlay, strip };
}

const locale = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), `src/core/i18n/locales/${name}.json`), 'utf8')) as Record<string, unknown>;

describe('armEntityMovePick (#1766)', () => {
  it('arms the point pick pre-selected on the rounded own tile', () => {
    const { kit, controller } = makeMockKit();
    armEntityMovePick(kit, { kind: 'vehicle', id: 3, name: 'Hauler 3', x: 7.4, z: 11.6 }, vi.fn());
    expect(controller.isArmed).toBe(true);
    expect(controller.selection).toEqual({ x1: 7, z1: 12, x2: 7, z2: 12 });
  });

  it('shows the strip with the entity name as subtitle and the vehicle i18n title/instruction', () => {
    const { kit, strip } = makeMockKit();
    armEntityMovePick(kit, { kind: 'vehicle', id: 3, name: 'Hauler 3', x: 5, z: 5 }, vi.fn());
    const cfg = strip.show.mock.calls.at(-1)![0];
    expect(cfg.subtitle).toBe('Hauler 3');
    expect(cfg.title).toBe(t('inspector.move_pick.vehicle.title'));
    expect(cfg.instruction).toBe(t('inspector.move_pick.vehicle.instruction'));
  });

  it('shows the employee i18n title/instruction for employees', () => {
    const { kit, strip } = makeMockKit();
    armEntityMovePick(kit, { kind: 'employee', id: 9, name: 'Dorian Kask', x: 5, z: 5 }, vi.fn());
    const cfg = strip.show.mock.calls.at(-1)![0];
    expect(cfg.subtitle).toBe('Dorian Kask');
    expect(cfg.title).toBe(t('inspector.move_pick.employee.title'));
    expect(cfg.instruction).toBe(t('inspector.move_pick.employee.instruction'));
  });

  it('confirming a vehicle pick runs exactly `vehicle reposition <id> <x> <z>`', () => {
    const { kit, controller, overlay } = makeMockKit();
    const run = vi.fn();
    armEntityMovePick(kit, { kind: 'vehicle', id: 3, name: 'H', x: 5, z: 5 }, run);
    controller.simulateSelect({ x1: 18, z1: 4, x2: 18, z2: 4 });
    controller.simulateConfirm();
    expect(run.mock.calls).toEqual([['vehicle reposition 3 18 4']]);
    expect(overlay.flashConfirm).toHaveBeenCalled();
  });

  it('confirming an employee pick runs exactly `employee dispatch <id> x:<x> z:<z>`', () => {
    const { kit, controller } = makeMockKit();
    const run = vi.fn();
    armEntityMovePick(kit, { kind: 'employee', id: 9, name: 'E', x: 5, z: 5 }, run);
    controller.simulateSelect({ x1: 2, z1: 30, x2: 2, z2: 30 });
    controller.simulateConfirm();
    expect(run.mock.calls).toEqual([['employee dispatch 9 x:2 z:30']]);
  });

  it('confirming without changing the tile sends the own tile', () => {
    const { kit, controller } = makeMockKit();
    const run = vi.fn();
    armEntityMovePick(kit, { kind: 'vehicle', id: 1, name: 'H', x: 4.2, z: 8.7 }, run);
    controller.simulateConfirm();
    expect(run.mock.calls).toEqual([['vehicle reposition 1 4 9']]);
  });

  it('cancel sends nothing', () => {
    const { kit, controller } = makeMockKit();
    const run = vi.fn();
    armEntityMovePick(kit, { kind: 'vehicle', id: 1, name: 'H', x: 4, z: 4 }, run);
    controller.cancel();
    controller.simulateConfirm();
    expect(controller.isArmed).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('arming again while armed cancels (toggle) and sends nothing', () => {
    const { kit, controller } = makeMockKit();
    const run = vi.fn();
    armEntityMovePick(kit, { kind: 'vehicle', id: 1, name: 'H', x: 4, z: 4 }, run);
    armEntityMovePick(kit, { kind: 'vehicle', id: 1, name: 'H', x: 4, z: 4 }, run);
    expect(controller.isArmed).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('inspector.move_pick locale keys (#1766)', () => {
  const KEYS = ['vehicle', 'employee'].flatMap(k => [`inspector.move_pick.${k}.title`, `inspector.move_pick.${k}.instruction`]);
  for (const name of ['en', 'fr']) {
    it(`${name}.json defines the move_pick keys and drops inspector.no_move_target`, () => {
      const json = locale(name) as Record<string, unknown>;
      for (const key of KEYS) expect(typeof json[key], key).toBe('string');
      expect(json['inspector.no_move_target']).toBeUndefined();
    });
  }
});
