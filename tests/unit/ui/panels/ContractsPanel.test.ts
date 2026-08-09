// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ContractsPanel } from '../../../../src/ui/panels/ContractsPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { Contract } from '../../../../src/core/economy/Contract.js';

function makeState(): GameState {
  return createGame({ seed: 1, mineType: 'desert' });
}

function makePanel(): { panel: ContractsPanel; container: HTMLElement; gameConsole: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const panel = new ContractsPanel(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  panel.setGameConsole(gameConsole);
  return { panel, container, gameConsole };
}

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: 1, type: 'ore_sale', materialId: 'dirtite', description: 'Deliver dirtite ore',
    quantityKg: 100, deliveredKg: 0, pricePerKg: 3, deadlineTicks: 50, acceptedAtTick: 0,
    penaltyAmount: 90, earlyBonus: 45, completed: false, expired: false,
    ...overrides,
  };
}

describe('ContractsPanel', () => {
  it('is hidden until show() is called', () => {
    const { panel } = makePanel();
    expect(panel.visible).toBe(false);
  });

  it('show() + update() renders the storage strip from real logistics state', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.logistics.storedMassKg = 12400;
    state.logistics.storageCapacityKg = 20000;

    panel.show();
    panel.update(state);

    expect(panel.root.textContent).toContain('12,400');
    expect(panel.root.textContent).toContain('20,000');
  });

  it('shows empty states for active, offered, and closed when nothing exists', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());

    const text = panel.root.textContent ?? '';
    expect(text).toContain('No active contracts');
    expect(text).toContain('No contracts available');
  });

  it('renders an active card with a deliver amount capped at what is actually in storage', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.collectedOre['dirtite'] = 40;
    state.contracts.active.push(makeContract({ id: 5, quantityKg: 100, deliveredKg: 0 }));

    panel.show();
    panel.update(state);

    const amount = panel.root.querySelector<HTMLInputElement>('.bs-contract-amount');
    expect(amount).not.toBeNull();
    expect(amount!.value).toBe('40'); // min(remaining=100, stored=40)
  });

  it('MAX shortcut resets the deliver amount after the player edits it', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.collectedOre['dirtite'] = 40;
    state.contracts.active.push(makeContract({ id: 5, quantityKg: 100, deliveredKg: 0 }));
    panel.show();
    panel.update(state);

    const amount = panel.root.querySelector<HTMLInputElement>('.bs-contract-amount')!;
    amount.value = '3';
    (panel.root.querySelector('[data-action="deliver-max"]') as HTMLButtonElement).click();

    expect(amount.value).toBe('40');
  });

  it('Deliver dispatches contract deliver with the current amount field value', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    state.collectedOre['dirtite'] = 40;
    state.contracts.active.push(makeContract({ id: 5, quantityKg: 100, deliveredKg: 0 }));
    panel.show();
    panel.update(state);

    (panel.root.querySelector('.bs-contract-deliver') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('contract deliver 5 amount:40');
  });

  it('Deliver is disabled when nothing of the material is in storage', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.active.push(makeContract({ id: 5, quantityKg: 100, deliveredKg: 0 }));
    panel.show();
    panel.update(state);

    expect((panel.root.querySelector('.bs-contract-deliver') as HTMLButtonElement).disabled).toBe(true);
  });

  it('Accept dispatches contract accept for the right offered card', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    state.contracts.available.push(makeContract({ id: 7 }));
    panel.show();
    panel.update(state);

    (panel.root.querySelector('.bs-contract-accept') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('contract accept id:7');
  });

  it('Negotiate and Decline dispatch their commands', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    state.contracts.available.push(makeContract({ id: 9 }));
    panel.show();
    panel.update(state);

    (panel.root.querySelector('[data-action="negotiate"]') as HTMLButtonElement).click();
    (panel.root.querySelector('[data-action="decline"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('contract negotiate id:9');
    expect(gameConsole).toHaveBeenCalledWith('contract decline id:9');
  });

  it('shows the negotiate result inline only on the matching offered card', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.available.push(makeContract({ id: 3 }), makeContract({ id: 4 }));
    state.contracts.lastNegotiation = { contractId: 3, success: true, changes: [{ field: 'price', improved: true, pct: 12 }] };
    panel.show();
    panel.update(state);

    expect(panel.root.textContent).toContain('12%');
  });

  it('renders a completed history row with a positive payout', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.completedHistory.push(makeContract({ id: 11, quantityKg: 50, deliveredKg: 50, pricePerKg: 4, completed: true, expired: false }));
    panel.show();
    panel.update(state);

    expect(panel.root.textContent).toContain('+$200');
  });

  it('renders an expired history row with the penalty amount', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.completedHistory.push(makeContract({ id: 12, penaltyAmount: 75, completed: false, expired: true }));
    panel.show();
    panel.update(state);

    expect(panel.root.textContent).toContain('-$75');
  });

  it('storage strip link navigates to Operations', () => {
    const { panel } = makePanel();
    const onNavigate = vi.fn();
    panel.setNavigateHandler(onNavigate);
    panel.show();
    panel.update(makeState());

    (panel.root.querySelector('[data-action="goto-ops"]') as HTMLButtonElement).click();

    expect(onNavigate).toHaveBeenCalledWith('ops');
  });

  it('refreshLocale() does not throw', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    expect(() => panel.refreshLocale()).not.toThrow();
  });

  it('dispose() removes the panel from the DOM', () => {
    const { panel, container } = makePanel();
    panel.dispose();
    expect(container.contains(panel.root)).toBe(false);
  });

  // ── #513: cards must carry data-contract-id so per-card action selectors scope correctly ──

  it('offered card carries data-contract-id matching its contract', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.contracts.available.push(makeContract({ id: 7 }));
    panel.show();
    panel.update(state);

    expect(panel.root.querySelector('[data-contract-id="7"]')).not.toBeNull();
  });

  it('active card carries data-contract-id matching its contract', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.collectedOre['dirtite'] = 40;
    state.contracts.active.push(makeContract({ id: 5, quantityKg: 100, deliveredKg: 0 }));
    panel.show();
    panel.update(state);

    expect(panel.root.querySelector('[data-contract-id="5"]')).not.toBeNull();
  });

  it('Accept on a specific offered card dispatches contract accept for that card only, with two offers present', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    state.contracts.available.push(makeContract({ id: 3 }), makeContract({ id: 9 }));
    panel.show();
    panel.update(state);

    (panel.root.querySelector('[data-contract-id="9"] .bs-contract-accept') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('contract accept id:9');
    expect(gameConsole).not.toHaveBeenCalledWith('contract accept id:3');
  });

  it('Accept on the other offered card dispatches contract accept for that id, with two offers present', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    state.contracts.available.push(makeContract({ id: 3 }), makeContract({ id: 9 }));
    panel.show();
    panel.update(state);

    (panel.root.querySelector('[data-contract-id="3"] .bs-contract-accept') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('contract accept id:3');
    expect(gameConsole).not.toHaveBeenCalledWith('contract accept id:9');
  });

  it('Deliver on a specific active card dispatches contract deliver for that card only, with two active contracts present', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    state.collectedOre['dirtite'] = 100;
    state.contracts.active.push(
      makeContract({ id: 5, quantityKg: 100, deliveredKg: 0 }),
      makeContract({ id: 8, quantityKg: 60, deliveredKg: 0 }),
    );
    panel.show();
    panel.update(state);

    (panel.root.querySelector('[data-contract-id="8"] .bs-contract-deliver') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith('contract deliver 8 amount:60');
    expect(gameConsole).not.toHaveBeenCalledWith(expect.stringMatching(/^contract deliver 5 /));
  });
});
