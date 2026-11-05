// @vitest-environment jsdom
// Issue #2138 — every building inspector states, in one plain sentence, what the building is for.
import { describe, it, expect, afterEach } from 'vitest';
import { buildingContent } from '../../../src/ui/panels/inspector/buildingContent.js';
import * as buildingContentModule from '../../../src/ui/panels/inspector/buildingContent.js';
import { buildingCardLine } from '../../../src/ui/catalogCardText.js';
import type { InspectorLinks, InspectorView } from '../../../src/ui/panels/inspector/InspectorContent.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState, PendingAction } from '../../../src/core/state/GameState.js';
import {
  getAllBuildingTypes, getBuildingDef, type Building, type BuildingTier, type BuildingType,
} from '../../../src/core/entities/Building.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };

const EN = enLocale as Record<string, string>;
const FR = frLocale as Record<string, string>;
const links = { select: () => {} } as unknown as InspectorLinks;
const TYPES = getAllBuildingTypes();
const TIERS: BuildingTier[] = [1, 2, 3];
const ID = 3;

afterEach(() => setLocale('en'));

function baseState(): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = 9_999_999;
  s.tickCount = 100;
  return s;
}

function placed(type: BuildingType, tier: BuildingTier): GameState {
  const s = baseState();
  const b: Building = { id: ID, type, tier, x: 17, z: 23, hp: getBuildingDef(type, tier).maxHp, active: true, occupantIds: [] };
  s.buildings.buildings = [b];
  return s;
}

function planned(type: BuildingType, tier: BuildingTier): GameState {
  const s = baseState();
  s.buildings.buildings = [];
  s.plannedBuildings.push({ id: 90, buildingId: ID, type, tier, x: 17, z: 23, actionId: 60, cost: 1000 });
  s.pendingActions.push({
    id: 60, type: 'place_building', requiredSkill: null, requiredVehicleRole: null, targetX: 17, targetZ: 23, targetY: 0,
    payload: {}, targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0,
  } satisfies PendingAction);
  return s;
}

function closed(type: BuildingType): GameState {
  const s = placed(type, 1);
  s.events.activeModifiers.push({
    id: 801, kind: 'out_of_service', sourceEventId: 'evt_flood', role: null, targetId: ID,
    targetKind: 'building', category: null, magnitude: 1, startTick: 50, endTick: 400,
  });
  return s;
}

function demolitionOrdered(type: BuildingType): GameState {
  const s = placed(type, 1);
  s.pendingActions.push({
    id: 50, type: 'demolish_building', requiredSkill: null, requiredVehicleRole: 'building_destroyer',
    targetX: 5, targetZ: 5, targetY: 0, payload: { buildingId: ID }, targetEmployeeId: null,
    status: 'queued', holderId: null, queuedAtTick: 0,
  } satisfies PendingAction);
  return s;
}

function viewOf(s: GameState): InspectorView {
  return buildingContent.view({ kind: 'building', id: ID }, s, links)!;
}

function sectionsText(view: InspectorView): string {
  const root = document.createElement('div');
  root.append(...view.sections);
  return root.textContent ?? '';
}

describe('buildingRoleText', () => {
  for (const type of TYPES) {
    it(`${type}: returns the translated building.${type}.role text`, () => {
      expect(buildingContentModule.buildingRoleText(type)).toBe(t(`building.${type}.role`));
      expect(buildingContentModule.buildingRoleText(type)).toBe(EN[`building.${type}.role`]);
    });
  }

  it('follows the active locale', () => {
    setLocale('fr');
    for (const type of TYPES) {
      expect(buildingContentModule.buildingRoleText(type)).toBe(FR[`building.${type}.role`]);
    }
  });
});

describe('building role locale entries (C2)', () => {
  for (const type of TYPES) {
    const key = `building.${type}.role`;
    for (const [name, locale] of [['en', EN], ['fr', FR]] as const) {
      describe(`${key} in ${name}`, () => {
        it('exists and is non-empty', () => {
          expect(typeof locale[key]).toBe('string');
          expect(locale[key]!.trim().length).toBeGreaterThan(0);
        });

        it('differs from the desc joke', () => {
          expect(locale[key]).not.toBe(locale[`building.${type}.desc`]);
        });

        it('is a single sentence with one terminal period', () => {
          const text = locale[key]!.trim();
          expect(text.endsWith('.')).toBe(true);
          expect(text.match(/[.!?…]+(?=\s|$)/g)).toHaveLength(1);
          expect(text).not.toMatch(/[\n;]/);
        });

        it('has no unresolved placeholder', () => {
          expect(locale[key]).not.toMatch(/\{\w+\}/);
        });
      });
    }
  }

  it('en and fr texts differ for every type', () => {
    for (const type of TYPES) {
      expect(FR[`building.${type}.role`]).not.toBe(EN[`building.${type}.role`]);
    }
  });
});

describe('building inspector shows the role (C1)', () => {
  for (const type of TYPES) {
    for (const tier of TIERS) {
      it(`${type} tier ${tier} placed: sections contain the role`, () => {
        expect(sectionsText(viewOf(placed(type, tier)))).toContain(t(`building.${type}.role`));
      });
      it(`${type} tier ${tier} planned site: sections contain the role`, () => {
        expect(sectionsText(viewOf(planned(type, tier)))).toContain(t(`building.${type}.role`));
      });
    }
    it(`${type} closed by an event: sections contain the role`, () => {
      expect(sectionsText(viewOf(closed(type)))).toContain(t(`building.${type}.role`));
    });
    it(`${type} with demolition ordered: sections contain the role`, () => {
      expect(sectionsText(viewOf(demolitionOrdered(type)))).toContain(t(`building.${type}.role`));
    });
  }

  it('renders the French role under the French locale', () => {
    setLocale('fr');
    for (const type of TYPES) {
      const text = sectionsText(viewOf(placed(type, 1)));
      expect(text).toContain(FR[`building.${type}.role`]);
      expect(text).not.toContain(EN[`building.${type}.role`]);
    }
  });

  it('shows the role once, not repeated', () => {
    for (const type of TYPES) {
      const role = t(`building.${type}.role`);
      expect(sectionsText(viewOf(placed(type, 1))).split(role).length - 1).toBe(1);
    }
  });

  it('different types show different roles', () => {
    const texts = TYPES.map(type => t(`building.${type}.role`));
    expect(new Set(texts).size).toBe(TYPES.length);
  });

  it('does not show the desc joke in place of the role', () => {
    for (const type of TYPES) {
      expect(sectionsText(viewOf(placed(type, 1)))).not.toContain(t(`building.${type}.desc`));
    }
  });
});

describe('building inspector places the role near the top (C3)', () => {
  const statusLabel = () => t('inspector.status');

  for (const type of TYPES) {
    it(`${type} placed: role is in the first section, ahead of the status and upkeep rows`, () => {
      const view = viewOf(placed(type, 1));
      const first = view.sections[0]!;
      const text = first.textContent ?? '';
      const role = t(`building.${type}.role`);
      expect(text).toContain(role);
      expect(text.indexOf(role)).toBeLessThan(text.indexOf(statusLabel()));
      expect(text.indexOf(role)).toBeLessThan(text.indexOf(t('inspector.upkeep')));
    });

    it(`${type} planned site: role is in the first section, ahead of the status row`, () => {
      const view = viewOf(planned(type, 1));
      const text = view.sections[0]!.textContent ?? '';
      const role = t(`building.${type}.role`);
      expect(text).toContain(role);
      expect(text.indexOf(role)).toBeLessThan(text.indexOf(statusLabel()));
    });
  }

  it('the role sits in the first child after the section header', () => {
    const first = viewOf(placed('management_office', 1)).sections[0]!;
    const role = t('building.management_office.role');
    const index = Array.from(first.children).findIndex(c => (c.textContent ?? '').includes(role));
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThanOrEqual(1);
  });

  it('later sections do not carry the role', () => {
    const view = viewOf(placed('research_center', 1));
    const role = t('building.research_center.role');
    for (const section of view.sections.slice(1)) {
      expect(section.textContent ?? '').not.toContain(role);
    }
  });
});

describe('Build menu card text keeps the desc (C4)', () => {
  for (const type of TYPES) {
    it(`${type}: card line carries desc and not the role`, () => {
      const line = buildingCardLine(getBuildingDef(type, 1));
      expect(line).toContain(t(`building.${type}.desc`));
      expect(line).not.toContain(t(`building.${type}.role`));
    });
  }
});
