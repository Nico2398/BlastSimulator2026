// BlastSimulator2026 — Playtest definition validation
//
// A playtest exists to prove the game is playable by clicking. That guarantee is
// only worth something if the definitions cannot quietly reach for the console:
// a beat that runs `employee assign_skill` to hand itself a qualification will
// report PASS while no button in the game grants one. These tests are the gate
// that keeps that from happening again.

import { describe, it, expect } from 'vitest';
import type { PlayerAction, PlaytestBeat } from '../../scripts/shared/playtest-types.js';
import {
  SETUP_COMMAND_ALLOWLIST,
  TIME_COMMAND_ALLOWLIST,
  isAllowedSetupCommand,
} from '../../scripts/shared/playtest-types.js';
import { playtestFiles, loadPlaytestFile } from '../../scripts/shared/playtest-utils.js';

const KNOWN_ACTION_TYPES: ReadonlyArray<PlayerAction['do']> = [
  'click', 'clickLabel', 'set', 'pickTile', 'dragTiles', 'clickEntity',
  'zoomOut', 'focusTile', 'awaitUsable', 'awaitTutorialStep', 'letTimePass',
];

/** Actions that carry a selector the driver will look up verbatim. */
const SELECTOR_ACTIONS = new Set(['click', 'set', 'awaitUsable']);

const FILES = playtestFiles();

describe('playtest definitions exist', () => {
  it('at least one playtest is defined', () => {
    expect(FILES.length).toBeGreaterThan(0);
  });

  it('the tutorial playtest is defined — it is the baseline playable path', () => {
    expect(FILES).toContain('tutorial.json');
  });
});

describe.each(FILES)('%s', (file) => {
  const def = loadPlaytestFile(file);

  it('name matches the file name', () => {
    expect(`${def.name}.json`).toBe(file);
  });

  it('description explains what the playtest proves', () => {
    expect(typeof def.description).toBe('string');
    expect(def.description.length).toBeGreaterThan(20);
  });

  it('has beats', () => {
    expect(Array.isArray(def.beats)).toBe(true);
    expect(def.beats.length).toBeGreaterThan(0);
  });

  it('every beat states a goal in plain words', () => {
    def.beats.forEach((beat: PlaytestBeat, i: number) => {
      expect(typeof beat.goal, `beat[${i}] goal`).toBe('string');
      expect(beat.goal.length, `beat[${i}] goal is too short to explain itself`).toBeGreaterThan(5);
    });
  });

  it('every beat does something and asserts something', () => {
    def.beats.forEach((beat: PlaytestBeat, i: number) => {
      const acts = (beat.actions?.length ?? 0) + (beat.setup?.length ?? 0) > 0;
      expect(acts, `beat[${i}] "${beat.goal}" performs no action`).toBe(true);
      expect(
        beat.expect !== undefined,
        `beat[${i}] "${beat.goal}" asserts nothing — a beat with no goal proves nothing`,
      ).toBe(true);
    });
  });

  it('every beat expectation carries at least one checkable field', () => {
    def.beats.forEach((beat: PlaytestBeat, i: number) => {
      const e = beat.expect;
      if (!e) return;
      const checkable = e.tutorialStep !== undefined
        || (e.increased?.length ?? 0) > 0
        || e.equals !== undefined
        || e.usable !== undefined;
      // A `note`-only expectation is deliberate for beats whose step
      // auto-advances; the following beat carries the assertion.
      expect(
        checkable || typeof e.note === 'string',
        `beat[${i}] "${beat.goal}" expects nothing checkable and offers no note explaining why`,
      ).toBe(true);
    });
  });

  it('every action type is one the driver implements', () => {
    def.beats.forEach((beat: PlaytestBeat, i: number) => {
      for (const action of beat.actions ?? []) {
        expect(
          KNOWN_ACTION_TYPES,
          `beat[${i}] action "${action.do}" is not implemented by playtest-driver`,
        ).toContain(action.do);
      }
    });
  });

  it('selector actions name a non-empty selector', () => {
    def.beats.forEach((beat: PlaytestBeat, i: number) => {
      for (const action of beat.actions ?? []) {
        if (!SELECTOR_ACTIONS.has(action.do)) continue;
        const selector = (action as { selector?: string }).selector;
        expect(typeof selector, `beat[${i}] ${action.do} selector`).toBe('string');
        expect(selector!.length, `beat[${i}] ${action.do} selector is empty`).toBeGreaterThan(0);
      }
    });
  });

  it('tile coordinates are non-negative integers', () => {
    def.beats.forEach((beat: PlaytestBeat, i: number) => {
      for (const action of beat.actions ?? []) {
        const coords = action.do === 'pickTile'
          ? [action.x, action.z]
          : action.do === 'dragTiles'
            ? [action.x1, action.z1, action.x2, action.z2]
            : [];
        for (const c of coords) {
          expect(Number.isInteger(c), `beat[${i}] tile coordinate ${c} is not an integer`).toBe(true);
          expect(c, `beat[${i}] tile coordinate is negative`).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  it('letTimePass advances a positive number of ticks', () => {
    def.beats.forEach((beat: PlaytestBeat, i: number) => {
      for (const action of beat.actions ?? []) {
        if (action.do !== 'letTimePass') continue;
        expect(Number.isInteger(action.ticks), `beat[${i}] ticks must be an integer`).toBe(true);
        expect(action.ticks, `beat[${i}] ticks must be > 0`).toBeGreaterThan(0);
      }
    });
  });

  // ── The cheat gate ──────────────────────────────────────────────────────────

  it('no beat runs a gameplay console command', () => {
    const offenders: string[] = [];
    def.beats.forEach((beat: PlaytestBeat, i: number) => {
      for (const command of beat.setup ?? []) {
        if (!isAllowedSetupCommand(command)) {
          offenders.push(`beat[${i}] setup: "${command}"`);
        }
      }
    });
    expect(
      offenders,
      'A playtest may only set up a world and pass time. Everything a player '
      + 'does must be clicked, or the playtest cannot detect an unreachable control.\n'
      + `Allowed: ${[...SETUP_COMMAND_ALLOWLIST, ...TIME_COMMAND_ALLOWLIST].join(', ')}\n`
      + offenders.join('\n'),
    ).toEqual([]);
  });

  it('no action smuggles a console command through a field', () => {
    // Actions have no command field by construction; this catches a definition
    // written against an older or hand-edited schema.
    const offenders: string[] = [];
    def.beats.forEach((beat: PlaytestBeat, i: number) => {
      (beat.actions ?? []).forEach((action: PlayerAction, j: number) => {
        for (const key of ['command', 'commands', 'console', 'eval']) {
          if (key in (action as Record<string, unknown>)) {
            offenders.push(`beat[${i}].actions[${j}] has "${key}"`);
          }
        }
      });
    });
    expect(offenders).toEqual([]);
  });

  it('only the first beat sets up a world', () => {
    def.beats.forEach((beat: PlaytestBeat, i: number) => {
      if (i === 0) return;
      const resets = (beat.setup ?? []).filter(c => {
        const token = c.trim().split(/\s+/)[0] ?? '';
        return token === 'new_game' || token === 'campaign' || token === 'tutorial_start';
      });
      expect(
        resets,
        `beat[${i}] "${beat.goal}" restarts the world mid-run, which discards everything earlier beats proved`,
      ).toEqual([]);
    });
  });
});

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
});
