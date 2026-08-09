// BlastSimulator2026 — interaction-types.ts direct coverage (issue #515)
//
// playtest.ts and playtest-utils.ts were removed once every scenario step
// carried a structurally-enforced role (issue #515), but this module's
// predecessor (playtest-types.ts, renamed in #516) survives:
// `isAllowedSetupCommand`/`SETUP_COMMAND_ALLOWLIST` are the allowlist
// interaction-executor.ts's `role: 'setup'` branch reuses for scenario steps
// (see scripts/shared/interaction-executor.ts and
// tests/unit/scenario-interaction.test.ts for the reuse). These tests were
// previously carried inside the deleted playtest test suite; moved here so
// the still-load-bearing function keeps direct unit coverage rather than
// only the two cases scenario-interaction exercises indirectly.

import { describe, it, expect } from 'vitest';
import {
  SETUP_COMMAND_ALLOWLIST,
  isAllowedSetupCommand,
} from '../../scripts/shared/interaction-types.js';

describe('isAllowedSetupCommand', () => {
  it('allows world setup and time control', () => {
    expect(isAllowedSetupCommand('new_game seed:42 size:24')).toBe(true);
    expect(isAllowedSetupCommand('campaign start level:tutorial_pit')).toBe(true);
    expect(isAllowedSetupCommand('tutorial_start')).toBe(true);
    expect(isAllowedSetupCommand('tick 5')).toBe(true);
    expect(isAllowedSetupCommand('time speed:2')).toBe(true);
  });

  it('rejects the gameplay commands a harness would be tempted to use', () => {
    for (const cheat of [
      'employee assign_skill 1 skill:geology level:3',
      'employee hire role:surveyor',
      'survey seismic x:12 z:12',
      'build freight_warehouse at:12,8',
      'vehicle buy debris_hauler',
      'contract accept 1',
      'set_policy mode:shift_8h',
      'build_ramp start:10,15 end:10,25',
    ]) {
      expect(isAllowedSetupCommand(cheat), `"${cheat}" must be rejected`).toBe(false);
    }
  });

  it('rejects an empty command', () => {
    expect(isAllowedSetupCommand('')).toBe(false);
    expect(isAllowedSetupCommand('   ')).toBe(false);
  });

  // Issue #515: interaction-executor.ts's `setup`-role branch reuses this
  // same allowlist for scenario steps, and scenario-defs retagging needs
  // save/load/sandbox admitted as world
  // bootstrapping so a scenario can set up a save-game state without being
  // forced to click through it.
  it('allows save/load/sandbox as setup commands (#515)', () => {
    expect(isAllowedSetupCommand('save slot:quicksave')).toBe(true);
    expect(isAllowedSetupCommand('load slot:quicksave')).toBe(true);
    expect(isAllowedSetupCommand('sandbox start biome:alpine_granite difficulty:hard seed:777')).toBe(true);
  });

  it('save/load/sandbox are recorded in SETUP_COMMAND_ALLOWLIST itself (#515)', () => {
    expect(SETUP_COMMAND_ALLOWLIST).toContain('save');
    expect(SETUP_COMMAND_ALLOWLIST).toContain('load');
    expect(SETUP_COMMAND_ALLOWLIST).toContain('sandbox');
  });
});
