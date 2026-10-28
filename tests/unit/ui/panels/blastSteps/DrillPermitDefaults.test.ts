// @vitest-environment jsdom
// #2101: the Drill grid's opening depth follows the site's permit grade, and
// the player's own stepping always beats that default.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DrillStep } from '../../../../../src/ui/panels/blastSteps/Drill.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { createGradeState } from '../../../../../src/core/economy/MineGrade.js';
import { gridHoleLimitWarning } from '../../../../../src/ui/panels/permitPreview.js';
import { DRILL_GRID_DEFAULT_DEPTH_M } from '../../../../../src/core/config/balance.js';
import type { PlacementKit } from '../../../../../src/ui/scene/PlacementKit.js';
import type { PlacementSelection, PlacementArmConfig, PlacementConfirmHandler, PlacementChangeHandler } from '../../../../../src/ui/scene/PlacementController.js';

function makeState(grade: number | undefined) {
  const state = createGame({ seed: 1, mineType: 'desert' });
  if (grade === undefined) delete (state as { grade?: unknown }).grade;
  else {
    state.grade = createGradeState();
    state.grade.grade = grade;
  }
  return state;
}

/** Lightweight stand-in for the placement kit: enough surface for DrillStep's arm/confirm logic, no Three.js. */
function makeMockKit() {
  let phase: 'idle' | 'armed' | 'selected' = 'idle';
  let selection: PlacementSelection | null = null;
  let confirmHandler: PlacementConfirmHandler | null = null;
  let changeHandler: PlacementChangeHandler | null = null;

  const controller = {
    get isArmed() { return phase !== 'idle'; },
    get currentPhase() { return phase; },
    get selection() { return selection; },
    get activeRegion() { return null; },
    get canConfirm() { return selection !== null; },
    setConfirmHandler: (cb: PlacementConfirmHandler) => { confirmHandler = cb; },
    setCancelHandler: vi.fn(),
    setChangeHandler: (cb: PlacementChangeHandler) => { changeHandler = cb; },
    arm: (_config: PlacementArmConfig) => { phase = 'armed'; },
    cancel: () => { phase = 'idle'; selection = null; changeHandler?.(); },
    simulateSelect(sel: PlacementSelection) { selection = sel; phase = 'selected'; changeHandler?.(); },
    simulateConfirm() { if (selection) confirmHandler?.(selection); },
  };
  const overlay = { update: vi.fn(), clear: vi.fn(), flashConfirm: vi.fn() };
  const strip = { show: vi.fn(), hide: vi.fn(), setConfirmHandler: vi.fn(), setCancelHandler: vi.fn() };
  return { kit: { controller, overlay, strip } as unknown as PlacementKit, controller, strip };
}

type StripField = { key: string; value: number; onInc: () => void; onDec: () => void };
type StripArg = { fields: StripField[]; result: string; confirmEnabled: boolean };

function setup(state: ReturnType<typeof makeState>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const step = new DrillStep(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  step.setGameConsole(gameConsole);
  const mock = makeMockKit();
  step.setPlacementKit(mock.kit);
  step.update(state, 'sunny');
  return { step, gameConsole, ...mock };
}

function openGrid(h: ReturnType<typeof setup>, x2 = 18, z2 = 18): void {
  (h.step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
  h.controller.simulateSelect({ x1: 10, z1: 10, x2, z2 });
}

function stripArg(h: ReturnType<typeof setup>): StripArg {
  return h.strip.show.mock.calls.at(-1)![0] as StripArg;
}

function depthField(h: ReturnType<typeof setup>): StripField {
  return stripArg(h).fields.find(f => f.key === 'depth')!;
}

/** The drill_plan grid command the confirm handler dispatches. */
function confirmedCommand(h: ReturnType<typeof setup>): string {
  h.controller.simulateConfirm();
  const calls = h.gameConsole.mock.calls.map(c => c[0] as string);
  return calls.find(c => c.startsWith('drill_plan grid')) ?? '';
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('DrillStep permit-following default grid depth (#2101)', () => {
  it('a grade-0 site opens the grid tool with a 5 m depth', () => {
    const h = setup(makeState(0));
    openGrid(h);

    expect(depthField(h).value).toBe(5);
  });

  it('a grade-0 site dispatches depth:5 when the stepper is untouched', () => {
    const h = setup(makeState(0));
    openGrid(h);

    expect(confirmedCommand(h)).toMatch(/depth:5(\s|$)/);
  });

  it('a site with no permit keeps the 8 m depth', () => {
    const h = setup(makeState(undefined));
    openGrid(h);

    expect(depthField(h).value).toBe(DRILL_GRID_DEFAULT_DEPTH_M);
    expect(depthField(h).value).toBe(8);
    expect(confirmedCommand(h)).toMatch(/depth:8(\s|$)/);
  });

  for (const grade of [1, 2]) {
    it(`a grade-${grade} site, which has no per-grade entry, keeps the 8 m depth`, () => {
      const h = setup(makeState(grade));
      openGrid(h);

      expect(depthField(h).value).toBe(8);
      expect(confirmedCommand(h)).toMatch(/depth:8(\s|$)/);
    });
  }

  it('the grade-0 default holds across repeated updates before the tool is opened', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const step = new DrillStep(container);
    const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
    step.setGameConsole(gameConsole);
    const { kit, controller, strip } = makeMockKit();
    step.setPlacementKit(kit);
    step.update(makeState(0), 'sunny');
    step.update(makeState(0), 'cloudy');

    (step.root.querySelector('[data-action="grid-tool"]') as HTMLButtonElement).click();
    controller.simulateSelect({ x1: 10, z1: 10, x2: 18, z2: 18 });
    const arg = strip.show.mock.calls.at(-1)![0] as StripArg;

    expect(arg.fields.find(f => f.key === 'depth')!.value).toBe(5);
  });
});

describe('DrillStep player depth beats the permit default (#2101)', () => {
  it('stepping the depth up from the grade-0 default is honoured in the strip and the command', () => {
    const h = setup(makeState(0));
    openGrid(h);

    depthField(h).onInc();
    depthField(h).onInc();

    expect(depthField(h).value).toBe(7);
    expect(confirmedCommand(h)).toMatch(/depth:7(\s|$)/);
  });

  it('stepping the depth down from the grade-0 default is honoured', () => {
    const h = setup(makeState(0));
    openGrid(h);

    depthField(h).onDec();

    expect(depthField(h).value).toBe(4);
    expect(confirmedCommand(h)).toMatch(/depth:4(\s|$)/);
  });

  it('a stepped depth survives further updates and re-opening the tool', () => {
    const state = makeState(0);
    const h = setup(state);
    openGrid(h);
    depthField(h).onInc();
    depthField(h).onInc();
    depthField(h).onInc();
    expect(depthField(h).value).toBe(8);

    h.step.update(state, 'sunny');
    h.step.update(state, 'sunny');
    h.controller.cancel();
    openGrid(h);

    expect(depthField(h).value).toBe(8);
    expect(confirmedCommand(h)).toMatch(/depth:8(\s|$)/);
  });

  it('a depth stepped on a no-permit site is kept when a permit grade appears', () => {
    const state = makeState(undefined);
    const h = setup(state);
    openGrid(h);
    depthField(h).onInc();
    expect(depthField(h).value).toBe(9);

    state.grade = createGradeState();
    h.step.update(state, 'sunny');
    h.controller.cancel();
    openGrid(h);

    expect(depthField(h).value).toBe(9);
  });

  it('a depth stepped on a grade-0 site is kept when the update reports the same site again', () => {
    const state = makeState(0);
    const h = setup(state);
    openGrid(h);
    depthField(h).onDec();
    depthField(h).onDec();
    expect(depthField(h).value).toBe(3);

    h.step.update(state, 'cloudy');

    expect(depthField(h).value).toBe(3);
  });
});

describe('DrillStep permit hole-limit warning is unchanged by the depth default (#2101)', () => {
  it('a 4x4 grid on a grade-0 site still warns about the nine-hole limit', () => {
    const h = setup(makeState(0));
    openGrid(h, 22, 22);

    const arg = stripArg(h);
    expect(arg.confirmEnabled).toBe(true);
    expect(JSON.stringify(arg).toLowerCase()).toContain(gridHoleLimitWarning(createGradeState(), 16)!.toLowerCase());
    expect(JSON.stringify(arg)).toContain('(9)');
  });

  it('a 3x3 grid on a grade-0 site shows no permit warning', () => {
    const h = setup(makeState(0));
    openGrid(h, 18, 18);

    expect(stripArg(h).confirmEnabled).toBe(true);
    expect(JSON.stringify(stripArg(h)).toLowerCase()).not.toContain('permit');
  });
});
