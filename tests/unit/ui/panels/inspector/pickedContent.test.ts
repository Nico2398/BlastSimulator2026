// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { pickedContent } from '../../../../../src/ui/panels/inspector/pickedContent.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import { addHole, holeNumericId } from '../../../../../src/core/mining/DrillPlan.js';
import type { InspectorLinks } from '../../../../../src/ui/panels/inspector/InspectorContent.js';

const links = { select: () => {} } as unknown as InspectorLinks;

function makeState() {
  return createGame({ seed: 1, mineType: 'desert' });
}

function stateWithRamp(width: 3 | 5 | 7) {
  const state = makeState();
  const def = { originX: 10, originZ: 5, direction: 'south' as const, length: 12, targetDepth: 6, width };
  state.builtRamps.push({ id: 1, def, width, footprint: { minX: 10 - Math.floor(width / 2), maxX: 10 + Math.floor(width / 2), minZ: 5, maxZ: 16 } });
  state.nextBuiltRampId = 2;
  return state;
}

function mount(sections: HTMLElement[]): HTMLElement {
  const root = document.createElement('div');
  root.append(...sections);
  return root;
}

describe('pickedContent', () => {
  it('hole view exposes id, depth section, no actions, and sync rewrites depth in place', () => {
    const state = makeState();
    const hole = addHole({ nextHoleId: 1 }, state.drillHoles, 10, 10, 8, 0.15);
    const view = pickedContent.view({ kind: 'hole', id: holeNumericId(hole.id) }, state, links)!;
    expect(view.title).toBe(hole.id);
    expect(view.actions).toEqual([]);
    const root = mount(view.sections);
    const live = root.querySelector<HTMLElement>('[data-live="depth"]')!;
    expect(live.textContent).toContain('8');
    live.textContent = 'stale';
    view.sync(root);
    expect(live.textContent).toContain('8');
  });

  it('hole view is null for an unknown hole', () => {
    expect(pickedContent.view({ kind: 'hole', id: 9999 }, makeState(), links)).toBeNull();
  });

  it('ramp view offers widen below max width and syncs the description', () => {
    const view = pickedContent.view({ kind: 'ramp', id: 1 }, stateWithRamp(3), links)!;
    expect(view.actions.map(a => a.action)).toEqual(['widen']);
    expect(view.signature).toBe('1:3');
    const root = mount(view.sections);
    const live = root.querySelector<HTMLElement>('[data-live="description"]')!;
    live.textContent = 'stale';
    view.sync(root);
    expect(live.textContent).toBe(view.status);
  });

  it('ramp view offers no widen at max width and is null for an unknown ramp', () => {
    expect(pickedContent.view({ kind: 'ramp', id: 1 }, stateWithRamp(7), links)!.actions).toEqual([]);
    expect(pickedContent.view({ kind: 'ramp', id: 99 }, makeState(), links)).toBeNull();
  });

  it('fragment view has fixed signature, no sections or actions, and a no-op sync', () => {
    const view = pickedContent.view({ kind: 'fragment', id: 42 }, makeState(), links)!;
    expect(view.signature).toBe('fragment');
    expect(view.sections).toEqual([]);
    expect(view.actions).toEqual([]);
    expect(() => view.sync(document.createElement('div'))).not.toThrow();
  });

  it('non-picked kinds yield null', () => {
    expect(pickedContent.view({ kind: 'building', id: 1 }, makeState(), links)).toBeNull();
  });
});
