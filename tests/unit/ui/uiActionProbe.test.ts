// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { probeUiActions } from '../../../src/ui/uiActionProbe.js';
import { SelectionBar } from '../../../src/ui/shell/SelectionBar.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';

describe('probeUiActions — selection bar region (redesign P2)', () => {
  it('reports no selection-region controls while the bar is hidden', () => {
    document.body.innerHTML = '';
    const container = document.createElement('div');
    document.body.appendChild(container);
    new SelectionBar(container);

    const actions = probeUiActions();
    expect(actions.some(a => a.region === 'selection')).toBe(false);
  });

  it('enumerates the action buttons, unblocked by disabled/hidden/pointer-events, once an entity is selected', () => {
    // jsdom has no layout engine — getBoundingClientRect() is always zero, so
    // probeUiActions() reports every control 'zero-size' regardless of the
    // real DOM here. That check only means something in a real browser (the
    // visual channel); this test covers the layout-independent
    // half: the controls are discovered at all, and none is disabled/hidden.
    document.body.innerHTML = '';
    const container = document.createElement('div');
    document.body.appendChild(container);
    const bar = new SelectionBar(container);
    const state = createGame({ seed: 1, mineType: 'desert' });
    const { employee } = hireEmployee(state.employees, 'driller', new Random(1));

    bar.show({ kind: 'employee', id: employee.id, point: new THREE.Vector3(), distance: 1 }, state);

    const actions = probeUiActions().filter(a => a.region === 'selection');
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.every(a => a.blockedBy !== 'disabled' && a.blockedBy !== 'hidden' && a.blockedBy !== 'pointer-events-none')).toBe(true);
  });
});
