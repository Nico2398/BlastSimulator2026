// BlastSimulator2026 — VehiclePanel unit tests (issue #411)
// Covers: localized tier-specific vehicle names (t(def.nameKey), not raw role
// ids) and the per-tier buy button selector (Tier 1/2/3, each individually
// affordability-gated). Mirrors the jsdom harness used by EmployeePanel.test.ts.

// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { VehiclePanel } from '../../../src/ui/VehiclePanel.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { purchaseVehicle, getVehicleDefByTier, getAllVehicleRoles } from '../../../src/core/entities/Vehicle.js';
import { t } from '../../../src/core/i18n/I18n.js';
import type { CommandResult } from '../../../src/console/ConsoleRunner.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeState(cash = 200_000): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = cash;
  return s;
}

function setupPanel(): { container: HTMLDivElement; panel: VehiclePanel } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const panel = new VehiclePanel(container);
  return { container, panel };
}

// ── Buy section — per-tier buttons ──────────────────────────────────────────

describe('VehiclePanel — tier buy buttons (#411)', () => {
  it('renders 3 tier buttons (1, 2, 3) for every vehicle role', () => {
    const { container, panel } = setupPanel();
    panel.update(makeState());

    for (const role of getAllVehicleRoles()) {
      const buttons = container.querySelectorAll(`[data-vtype="${role}"][data-tier]`);
      expect(buttons.length, `role ${role} should have 3 tier buttons`).toBe(3);
      const tiers = Array.from(buttons)
        .map(b => (b as HTMLElement).dataset['tier'])
        .sort();
      expect(tiers).toEqual(['1', '2', '3']);
    }
  });

  it("tier-2 button label includes the localized tier-2 name (t(def.nameKey))", () => {
    const { container, panel } = setupPanel();
    panel.update(makeState());

    const btn2 = container.querySelector('[data-vtype="debris_hauler"][data-tier="2"]') as HTMLElement | null;
    expect(btn2).not.toBeNull();
    expect(btn2!.textContent).toContain(t('vehicle.debris_hauler.tier2'));
  });

  it('tier-3 button label includes that tier\'s cost, not the tier-1 cost', () => {
    const { container, panel } = setupPanel();
    panel.update(makeState());

    const tier1Cost = getVehicleDefByTier('debris_hauler', 1).purchaseCost;
    const tier3Cost = getVehicleDefByTier('debris_hauler', 3).purchaseCost;
    expect(tier3Cost).not.toBe(tier1Cost);

    const btn3 = container.querySelector('[data-vtype="debris_hauler"][data-tier="3"]') as HTMLElement;
    expect(btn3.textContent).toContain(String(tier3Cost));
  });

  it('clicking a tier button dispatches "vehicle buy <role> tier:<n>"', () => {
    const { container, panel } = setupPanel();
    panel.update(makeState());

    const commands: string[] = [];
    panel.setGameConsole((cmd: string): CommandResult => {
      commands.push(cmd);
      return { success: true, output: '' };
    });

    const btn = container.querySelector('[data-vtype="drill_rig"][data-tier="2"]') as HTMLButtonElement;
    btn.click();

    expect(commands).toContain('vehicle buy drill_rig tier:2');
  });

  it('clicking the tier-1 button dispatches tier:1 explicitly', () => {
    const { container, panel } = setupPanel();
    panel.update(makeState());

    const commands: string[] = [];
    panel.setGameConsole((cmd: string): CommandResult => {
      commands.push(cmd);
      return { success: true, output: '' };
    });

    const btn = container.querySelector('[data-vtype="rock_digger"][data-tier="1"]') as HTMLButtonElement;
    btn.click();

    expect(commands).toContain('vehicle buy rock_digger tier:1');
  });

  it('disables only the tier buttons whose cost exceeds current cash', () => {
    const { container, panel } = setupPanel();
    const tier1Cost = getVehicleDefByTier('debris_hauler', 1).purchaseCost;
    const tier2Cost = getVehicleDefByTier('debris_hauler', 2).purchaseCost;
    expect(tier2Cost).toBeGreaterThan(tier1Cost); // sanity: tiers strictly cost more

    panel.update(makeState(tier1Cost)); // exactly enough for tier 1, not tier 2/3

    const btn1 = container.querySelector('[data-vtype="debris_hauler"][data-tier="1"]') as HTMLButtonElement;
    const btn2 = container.querySelector('[data-vtype="debris_hauler"][data-tier="2"]') as HTMLButtonElement;
    const btn3 = container.querySelector('[data-vtype="debris_hauler"][data-tier="3"]') as HTMLButtonElement;

    expect(btn1.disabled).toBe(false);
    expect(btn2.disabled).toBe(true);
    expect(btn3.disabled).toBe(true);
  });

  it('re-enables a tier button once a later update() reflects enough cash', () => {
    const { container, panel } = setupPanel();
    const tier2Cost = getVehicleDefByTier('debris_hauler', 2).purchaseCost;

    panel.update(makeState(0));
    let btn2 = container.querySelector('[data-vtype="debris_hauler"][data-tier="2"]') as HTMLButtonElement;
    expect(btn2.disabled).toBe(true);

    panel.update(makeState(tier2Cost));
    btn2 = container.querySelector('[data-vtype="debris_hauler"][data-tier="2"]') as HTMLButtonElement;
    expect(btn2.disabled).toBe(false);
  });
});

// ── Owned vehicle rows — localized display name ─────────────────────────────

describe('VehiclePanel — owned vehicle rows show localized tier name (#411)', () => {
  it("shows t(getVehicleDefByTier(v.type, v.tier).nameKey) for a tier-2 vehicle", () => {
    const { container, panel } = setupPanel();
    const state = makeState();
    purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5, 2);

    panel.update(state);

    const row = container.querySelector('.bs-vehicle-row') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain(t('vehicle.debris_hauler.tier2'));
  });

  it("shows t(getVehicleDefByTier(v.type, v.tier).nameKey) for a tier-3 vehicle, not the raw role id", () => {
    const { container, panel } = setupPanel();
    const state = makeState();
    purchaseVehicle(state.vehicles, 'rock_digger', 0, 0, 3);

    panel.update(state);

    const row = container.querySelector('.bs-vehicle-row') as HTMLElement;
    expect(row.textContent).toContain(t('vehicle.rock_digger.tier3'));
  });

  it('reflects each vehicle\'s own tier when multiple vehicles of the same role are owned', () => {
    const { container, panel } = setupPanel();
    const state = makeState();
    purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0, 1);
    purchaseVehicle(state.vehicles, 'debris_hauler', 2, 2, 3);

    panel.update(state);

    const rows = container.querySelectorAll('.bs-vehicle-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain(t('vehicle.debris_hauler.tier1'));
    expect(rows[1]!.textContent).toContain(t('vehicle.debris_hauler.tier3'));
  });
});
