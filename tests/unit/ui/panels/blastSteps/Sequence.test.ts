// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SequenceStep } from '../../../../../src/ui/panels/blastSteps/Sequence.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole, resetHoleIds } from '../../../../../src/core/mining/DrillPlan.js';

function makeState() {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makeStep(): { step: SequenceStep; container: HTMLElement; gameConsole: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const step = new SequenceStep(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  step.setGameConsole(gameConsole);
  return { step, container, gameConsole };
}

function row(step: SequenceStep, holeId: string): HTMLElement {
  return step.root.querySelector(`[data-hole="${holeId}"]`) as HTMLElement;
}

beforeEach(() => resetHoleIds());

describe('SequenceStep', () => {
  it('shows the empty state when no holes exist', () => {
    const { step } = makeStep();
    step.update(makeState());
    expect(step.root.textContent).toContain('No holes to sequence');
  });

  it('renders one row per hole with its tag and an unset ("—") delay', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    step.update(state);

    expect(row(step, 'H1')).not.toBeNull();
    expect(row(step, 'H1').textContent).toContain('—');
  });

  it('shows the real delay once one is set', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    state.sequenceDelays['H1'] = 50;
    step.update(state);

    expect(row(step, 'H1').textContent).toContain('50 ms');
  });

  it('groups holes into rows by their real z coordinate, not insertion order', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15); // z=10 → Row 1
    addHole(state.drillHoles, 13, 10, 8, 0.15); // z=10 → Row 1
    addHole(state.drillHoles, 10, 13, 8, 0.15); // z=13 → Row 2
    step.update(state);

    expect(row(step, 'H1').textContent).toContain('Row 1');
    expect(row(step, 'H2').textContent).toContain('Row 1');
    expect(row(step, 'H3').textContent).toContain('Row 2');
  });

  it('Auto Sequence dispatches the current delay step', () => {
    const { step, gameConsole } = makeStep();
    step.update(makeState());

    const autoBtn = step.root.querySelector('[data-action="auto-sequence"]') as HTMLButtonElement;
    autoBtn.click();

    expect(gameConsole).toHaveBeenCalledWith('sequence auto delay_step:25ms');
  });

  it('the delay-step stepper changes what Auto Sequence dispatches', () => {
    const { step, gameConsole } = makeStep();
    step.update(makeState());

    const incBtn = step.root.querySelectorAll('.bsx-stepper-btn')[1] as HTMLButtonElement;
    incBtn.click();
    incBtn.click();
    (step.root.querySelector('[data-action="auto-sequence"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('sequence auto delay_step:35ms');
  });

  it('the delay-step stepper floors at 5ms', () => {
    const { step, gameConsole } = makeStep();
    step.update(makeState());

    const decBtn = step.root.querySelectorAll('.bsx-stepper-btn')[0] as HTMLButtonElement;
    for (let i = 0; i < 20; i++) decBtn.click();
    (step.root.querySelector('[data-action="auto-sequence"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('sequence auto delay_step:5ms');
  });

  it('a hole\'s + button dispatches sequence set, stepping up from unset (treated as 0)', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    step.update(state);

    (row(step, 'H1').querySelector('[data-action="delay-inc"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('sequence set hole:H1 delay:25ms');
  });

  it('a hole\'s - button steps down and floors at 0', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    state.sequenceDelays['H1'] = 10;
    step.update(state);

    (row(step, 'H1').querySelector('[data-action="delay-dec"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('sequence set hole:H1 delay:0ms');
  });

  it('per-hole delay buttons only affect their own hole', () => {
    const { step, gameConsole } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    addHole(state.drillHoles, 13, 10, 8, 0.15);
    step.update(state);

    (row(step, 'H2').querySelector('[data-action="delay-inc"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('sequence set hole:H2 delay:25ms');
    expect(gameConsole).not.toHaveBeenCalledWith(expect.stringContaining('hole:H1'));
  });

  it('dispose() removes the step from the DOM', () => {
    const { step, container } = makeStep();
    step.dispose();
    expect(container.contains(step.root)).toBe(false);
  });

  it('refreshLocale() does not throw and keeps rendering', () => {
    const { step } = makeStep();
    const state = makeState();
    addHole(state.drillHoles, 10, 10, 8, 0.15);
    step.update(state);
    expect(() => step.refreshLocale()).not.toThrow();
    step.update(state);
    expect(row(step, 'H1')).not.toBeNull();
  });
});
