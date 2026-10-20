// @vitest-environment jsdom
// BlastSimulator2026 — Preview step wall-slump warning line (#1943)
import { describe, it, expect } from 'vitest';
import { PreviewStep } from '../../../../../src/ui/panels/blastSteps/Preview.js';
import { buildWallGrid, standardShot } from '../../../../helpers/wallWarningFixture.js';
import { setLocale } from '../../../../../src/core/i18n/I18n.js';
import type { VoxelGrid } from '../../../../../src/core/world/VoxelGrid.js';

const SEL = '[data-role="preview-wall-warning"]';

function makeStep(grid: VoxelGrid | null): PreviewStep {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const step = new PreviewStep(container);
  step.setGameConsole(() => ({ success: true, output: '' }));
  step.setGridProvider(() => grid);
  return step;
}

describe('PreviewStep wall warning', () => {
  it('shows the warning line, with height, rock and safe height, when the shot leaves an overheight face', () => {
    setLocale('en');
    const step = makeStep(buildWallGrid({ plateauTop: 25 }));
    step.update(standardShot().state);
    const line = step.root.querySelector(SEL);
    expect(line).not.toBeNull();
    expect(line!.textContent).toContain('13');
    expect(line!.textContent).toContain('Cruite');
    expect(line!.textContent).toContain('12');
  });

  it('also warns for a face between 80% and 100% of the safe height', () => {
    const step = makeStep(buildWallGrid({ plateauTop: 23 }));
    step.update(standardShot().state);
    expect(step.root.querySelector(SEL)).not.toBeNull();
  });

  it('shows no line when the shot leaves only low faces', () => {
    const step = makeStep(buildWallGrid({ plateauTop: 21 }));
    step.update(standardShot().state);
    expect(step.root.querySelector(SEL)).toBeNull();
  });

  it('shows no line on a non-progression site', () => {
    const step = makeStep(buildWallGrid({ plateauTop: 25 }));
    step.update(standardShot('krackle', 8, false).state);
    expect(step.root.querySelector(SEL)).toBeNull();
  });

  it('shows no line without a grid', () => {
    const step = makeStep(null);
    step.update(standardShot().state);
    expect(step.root.querySelector(SEL)).toBeNull();
  });

  it('shows no line with no plan', () => {
    const step = makeStep(buildWallGrid({ plateauTop: 25 }));
    const { state } = standardShot();
    state.drillHoles.length = 0;
    step.update(state);
    expect(step.root.querySelector(SEL)).toBeNull();
  });

  it('the warning does not disable the analysis button (it is not a gate)', () => {
    const warned = makeStep(buildWallGrid({ plateauTop: 25 }));
    const quiet = makeStep(buildWallGrid({ plateauTop: 21 }));
    warned.update(standardShot().state);
    quiet.update(standardShot().state);
    const btn = (s: PreviewStep) => s.root.querySelector('[data-action="run-analysis"]') as HTMLButtonElement;
    expect(btn(warned).disabled).toBe(btn(quiet).disabled);
  });

  it('removes the line when the plan stops predicting a slump', () => {
    const step = makeStep(buildWallGrid({ plateauTop: 25 }));
    const { state } = standardShot();
    step.update(state);
    expect(step.root.querySelector(SEL)).not.toBeNull();
    state.drillHoles.length = 0;
    step.update(state);
    expect(step.root.querySelector(SEL)).toBeNull();
  });
});
