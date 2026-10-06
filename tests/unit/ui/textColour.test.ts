// @vitest-environment jsdom
// #1418 — no UI text may render in the browser's default black. `.bsx-root`
// used to set font only, and <button> children default to buttontext, so
// roster names, tier buttons, the clock etc. were black on a dark panel.
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { TOKENS_CSS, injectTokens } from '../../../src/ui/tokens.js';
import { injectStyles } from '../../../src/ui/styles.js';
import { FleetPanel } from '../../../src/ui/panels/FleetPanel.js';
import { CrewPanel } from '../../../src/ui/panels/CrewPanel.js';
import { OperationsPanel } from '../../../src/ui/panels/OperationsPanel.js';
import { ContractsPanel } from '../../../src/ui/panels/ContractsPanel.js';
import { ShadyPanel } from '../../../src/ui/panels/ShadyPanel.js';
import { SurveyPanel } from '../../../src/ui/panels/SurveyPanel.js';
import { FireStep } from '../../../src/ui/panels/blastSteps/Fire.js';
import { TopBar } from '../../../src/ui/shell/TopBar.js';
import { NotificationCenter } from '../../../src/ui/notify/NotificationCenter.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { addHole } from '../../../src/core/mining/DrillPlan.js';
import { Random } from '../../../src/core/math/Random.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import type { Contract } from '../../../src/core/economy/Contract.js';
import {
  readStyleFacts, documentCss, resolveLeafColour, textLeaves, defaultColourLeaves, type StyleFacts,
} from './helpers/resolveLeafColour.js';

let facts: StyleFacts;

beforeAll(() => {
  injectTokens();
  injectStyles();
  facts = readStyleFacts(documentCss());
});

afterEach(() => {
  setLocale('en');
  document.body.replaceChildren();
});

function expectNoDefaultColour(root: Element): void {
  expect(textLeaves(root).length).toBeGreaterThan(0);
  expect(defaultColourLeaves(root, facts)).toEqual([]);
}

function populated(): GameState {
  const s = createGame({ seed: 1, mineType: 'desert' });
  s.cash = 60000;
  const rng = new Random(1);
  for (const role of ['driller', 'blaster', 'driver', 'surveyor', 'manager'] as const) {
    hireEmployee(s.employees, role, rng, 21, 21);
  }
  purchaseVehicle(s.vehicles, 'debris_hauler', 5, 5);
  purchaseVehicle(s.vehicles, 'rock_digger', 6, 6);
  return s;
}

function contract(id: number, overrides: Partial<Contract> = {}): Contract {
  return {
    id, type: 'ore_sale', materialId: 'dirtite', description: 'Deliver dirtite ore',
    quantityKg: 100, deliveredKg: 0, pricePerKg: 3, deadlineTicks: 50, acceptedAtTick: 0,
    penaltyAmount: 90, earlyBonus: 45, completed: false, expired: false, ...overrides,
  };
}

describe('stylesheet (#1418)', () => {
  it('gives .bsx-root a text colour, not only a font', () => {
    expect(facts.rootColour).toBe(true);
    expect(TOKENS_CSS).toMatch(/\.bsx-root\s*\{[^}]*(?<![-\w])color\s*:\s*var\(--bsx-text-primary\)/);
  });

  it('makes form controls under .bsx-root inherit colour instead of buttontext', () => {
    expect(facts.controlInherit).toBe(true);
  });

  it('is injected into the document head', () => {
    expect(document.head.textContent).toContain('.bsx-root');
  });
});

describe('resolver controls', () => {
  it('a leaf under a plain div without bsx-root resolves to default', () => {
    const div = document.createElement('div');
    div.innerHTML = '<div><span>Plain</span></div>';
    document.body.appendChild(div);
    expect(resolveLeafColour(div.querySelector('span')!, facts).kind).toBe('default');
  });

  it('a leaf with an inline colour resolves inline even outside bsx-root', () => {
    const div = document.createElement('div');
    div.innerHTML = '<span style="color:var(--bsx-text-primary)">x</span>';
    expect(resolveLeafColour(div.firstElementChild!, facts).kind).toBe('inline');
  });

  it('a button without colour blocks inheritance when the inherit rule is absent', () => {
    const bare = readStyleFacts('.bsx-root { color: var(--bsx-text-primary); }');
    const root = document.createElement('div');
    root.className = 'bsx-root';
    root.innerHTML = '<button><span>Hi</span></button>';
    expect(resolveLeafColour(root.querySelector('span')!, bare).kind).toBe('default');
    const full = readStyleFacts('.bsx-root { color: var(--bsx-text-primary); } :where(.bsx-root) :where(button) { color: inherit; }');
    expect(resolveLeafColour(root.querySelector('span')!, full).kind).toBe('root-rule');
  });

  it('a bsx-root without a colour rule resolves default', () => {
    const none = readStyleFacts('.bsx-root, .bsx-root * { font-family: sans-serif; }');
    const root = document.createElement('div');
    root.className = 'bsx-root';
    root.innerHTML = '<span>x</span>';
    expect(resolveLeafColour(root.firstElementChild!, none).kind).toBe('default');
  });
});

describe.each(['en', 'fr'] as const)('panel text colour (%s)', locale => {
  const mount = <T extends { root: HTMLElement }>(make: (c: HTMLElement) => T): T => {
    setLocale(locale);
    const c = document.createElement('div');
    document.body.appendChild(c);
    const p = make(c);
    expect(p.root.classList.contains('bsx-root')).toBe(true);
    return p;
  };

  it('FleetPanel: roster and dealership tiers, affordable and not', () => {
    const rich = populated();
    rich.cash = 1_000_000;
    const panel = mount(c => new FleetPanel(c));
    panel.show();
    panel.update(rich);
    expectNoDefaultColour(panel.root);
    const poor = populated();
    poor.cash = 0;
    panel.update(poor);
    const tiers = panel.root.querySelectorAll<HTMLButtonElement>('.bs-fleet-tier-btn');
    expect([...tiers].some(b => b.disabled)).toBe(true);
    expectNoDefaultColour(panel.root);
  });

  it('FleetPanel tier button text is explicitly coloured', () => {
    const panel = mount(c => new FleetPanel(c));
    panel.show();
    panel.update(populated());
    const btn = panel.root.querySelector<HTMLElement>('.bs-fleet-tier-btn')!;
    expect(btn.getAttribute('style')).toMatch(/(?<![-\w])color\s*:\s*var\(--bsx-text-primary\)/);
  });

  it('CrewPanel: roster, hiring rows and expanded card', () => {
    const panel = mount(c => new CrewPanel(c));
    panel.show();
    const state = populated();
    panel.update(state);
    expectNoDefaultColour(panel.root);
    const id = state.employees.employees[0]!.id;
    panel.root.querySelector<HTMLButtonElement>(`[data-employee-id="${id}"] button`)!.click();
    expect(panel.root.querySelector('.bs-crew-detail')).not.toBeNull();
    expectNoDefaultColour(panel.root);
  });

  it('CrewPanel detail toggle is explicitly coloured', () => {
    const panel = mount(c => new CrewPanel(c));
    panel.show();
    panel.update(populated());
    const toggle = panel.root.querySelector<HTMLElement>('.bs-detail-toggle')!;
    expect(toggle.getAttribute('style')).toMatch(/(?<![-\w])color\s*:\s*var\(--bsx-text-primary\)/);
  });

  it('OperationsPanel', () => {
    const panel = mount(c => new OperationsPanel(c));
    panel.show();
    const s = populated();
    s.collectedOre['dirtite'] = 40;
    s.accidents = [{ tick: 0, type: 'injury', entityId: 1, fragmentId: 1, kineticEnergy: 200 }] as GameState['accidents'];
    panel.update(s);
    expectNoDefaultColour(panel.root);
  });

  it('ContractsPanel: active, available', () => {
    const panel = mount(c => new ContractsPanel(c));
    panel.show();
    const s = populated();
    s.collectedOre['dirtite'] = 40;
    s.contracts.active.push(contract(5));
    s.contracts.available.push(contract(7));
    panel.update(s);
    expectNoDefaultColour(panel.root);
  });

  it('ShadyPanel: locked teaser and unlocked services', () => {
    const panel = mount(c => new ShadyPanel(c));
    const s = populated();
    panel.update(s);
    panel.show();
    expectNoDefaultColour(panel.root);
    s.corruption.level = 3;
    s.corruption.mafiaUnlocked = true;
    s.corruption.attempts = [{ tick: 1, target: 'judge', cost: 50000, success: true }];
    panel.update(s);
    expectNoDefaultColour(panel.root);
  });

  it('SurveyPanel with a result', () => {
    const panel = mount(c => new SurveyPanel(c));
    panel.show();
    const s = populated();
    s.surveyResults = [{
      id: 1, method: 'seismic', centerX: 20, centerZ: 20, completedTick: 0,
      surveyorId: 1, estimates: { '20,20': { sparkium: 0.6 } }, confidence: 0.85,
    }];
    panel.update(s);
    expectNoDefaultColour(panel.root);
  });

  it('blast workshop Fire step danger-zone list', () => {
    setLocale(locale);
    const host = document.createElement('div');
    host.className = 'bsx-root'; // the workshop panel root the step is mounted in
    document.body.appendChild(host);
    const step = new FireStep(host);
    const s = populated();
    addHole({ nextHoleId: 1 }, s.drillHoles, 20, 20, 8, 0.15);
    s.vehicles.vehicles[0]!.x = 21; s.vehicles.vehicles[0]!.z = 21;
    step.update(s, 'sunny');
    expect(step.root.querySelector('[data-action="sound-horn"]')).not.toBeNull();
    expectNoDefaultColour(step.root);
  });

  it('TopBar: clock, day, balance, weather button and open popover', () => {
    setLocale(locale);
    const c = document.createElement('div');
    document.body.appendChild(c);
    const bar = new TopBar(c);
    const s = populated();
    s.tickCount = 50;
    bar.update(s, new NotificationCenter());
    c.querySelector<HTMLButtonElement>('.bs-weather')!.click();
    bar.update(s, new NotificationCenter());
    const root = c.querySelector<HTMLElement>('#bs-hud-top')!;
    expect(root.textContent).toContain(':00');
    expectNoDefaultColour(root);
    bar.dispose();
  });
});
