// BlastSimulator2026 — skill docs / fixtures name only real BuildingType values (issue #526)
//
// Phantom `BuildingType` names (`office`, `medical_bay`, `canteen`,
// `storage_depot`, `break_room`, `bunkhouse`) appear in skill doc prose and
// (until #526) in scenario fixtures, but none of them is, or has ever been, a
// real `BuildingType` (src/core/entities/Building.ts). The real catalog has 9
// types: `driving_center`, `blasting_academy`, `management_office`,
// `geology_lab`, `research_center`, `living_quarters`, `explosive_warehouse`,
// `freight_warehouse`, `vehicle_depot`. Runtime code already maps the phantom
// concepts correctly (`NEED_REST_BUILDING_TYPES`, `BUILDING_REPLENISH_RATES`,
// `NEED_REST_COSTS` in src/core/config/balance.ts all route hunger/fatigue/
// breakNeed replenishment through `living_quarters`); this is a doc/prose
// reconciliation, not a runtime fix.
//
// MUST currently fail (red) against:
//  - .claude/skills/gameplay-employee-needs/SKILL.md — still names Canteen /
//    Bunkhouse / Break Room as if they were distinct building types.
//  - .claude/skills/gameplay-game-design/SKILL.md — its Buildings list still
//    names "storage depots", "office", "break rooms", "medical bay".
//  - .claude/skills/dev-testing-strategy/SKILL.md — still says "Bunkhouse" /
//    bare "canteen" in its needs.integration.test.ts scenario table.
//  - scripts/shared/interaction-executor.ts — BOOTSTRAP_COMMAND_ALLOWLIST's
//    comment above the six phantom `build ...` entries still says "worth
//    checking" (a #515-era hedge that #526 turns into a settled mapping).
//
// The implementer phase makes this pass by editing prose in those four files
// — no src/core/ logic changes belong in this issue.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..', '..');

const EMPLOYEE_NEEDS_SKILL = join(ROOT, '.claude/skills/gameplay-employee-needs/SKILL.md');
const GAME_DESIGN_SKILL = join(ROOT, '.claude/skills/gameplay-game-design/SKILL.md');
const TESTING_STRATEGY_SKILL = join(ROOT, '.claude/skills/dev-testing-strategy/SKILL.md');
const INTERACTION_EXECUTOR = join(ROOT, 'scripts/shared/interaction-executor.ts');

describe('skill docs and fixtures name only real BuildingType values (issue #526)', () => {
  describe('.claude/skills/gameplay-employee-needs/SKILL.md', () => {
    const source = readFileSync(EMPLOYEE_NEEDS_SKILL, 'utf8');

    const phantomWords = [
      'Canteen',
      'Bunkhouse',
      'Break Room',
      'canteen',
      'bunkhouse',
      'break_room',
      'medical_bay',
    ];

    it.each(phantomWords)('does not contain the phantom building word %j', (word) => {
      expect(
        source.includes(word),
        `gameplay-employee-needs/SKILL.md still contains "${word}" — the needs system replenishes ` +
          'hunger/fatigue/breakNeed through the real `living_quarters` building (NEED_REST_BUILDING_TYPES, ' +
          'balance.ts), not a distinct Canteen/Bunkhouse/Break Room building type.',
      ).toBe(false);
    });
  });

  describe('.claude/skills/gameplay-game-design/SKILL.md', () => {
    const source = readFileSync(GAME_DESIGN_SKILL, 'utf8');

    const phantomPhrases = ['storage depots', 'office', 'break rooms', 'medical bay'];

    it.each(phantomPhrases)('Buildings list no longer names %j as a building', (phrase) => {
      expect(
        source.includes(phrase),
        `gameplay-game-design/SKILL.md's Buildings list still names "${phrase}" — none of "office", ` +
          '"storage depots", "break rooms", or "medical bay" is a real BuildingType (Building.ts); the real ' +
          'catalog is management_office, freight_warehouse, and living_quarters respectively.',
      ).toBe(false);
    });
  });

  describe('.claude/skills/dev-testing-strategy/SKILL.md', () => {
    const source = readFileSync(TESTING_STRATEGY_SKILL, 'utf8');

    it('does not say "Bunkhouse"', () => {
      expect(
        source.includes('Bunkhouse'),
        'dev-testing-strategy/SKILL.md still says "Bunkhouse" — the real building backing that need is ' +
          '`living_quarters`.',
      ).toBe(false);
    });

    it('does not say bare "canteen"', () => {
      // Word-boundary check so a corrected phrase like "living_quarters (hunger)"
      // can safely appear without tripping this on an unrelated substring.
      expect(
        /\bcanteen\b/i.test(source),
        'dev-testing-strategy/SKILL.md still says "canteen" — the real building backing that need is ' +
          '`living_quarters`.',
      ).toBe(false);
    });
  });

  describe('scripts/shared/interaction-executor.ts', () => {
    const source = readFileSync(INTERACTION_EXECUTOR, 'utf8');

    it('BOOTSTRAP_COMMAND_ALLOWLIST comment no longer hedges with "worth checking"', () => {
      expect(
        source.includes('worth checking'),
        'interaction-executor.ts\'s BOOTSTRAP_COMMAND_ALLOWLIST comment still says "worth checking" — ' +
          'issue #526 settles the office/medical_bay/canteen/storage_depot/break_room/bunkhouse mapping, so ' +
          'the comment should state it as fact, not as an open question.',
      ).toBe(false);
    });
  });
});
