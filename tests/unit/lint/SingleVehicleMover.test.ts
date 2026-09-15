// BlastSimulator2026 — repo-wide: a vehicle has exactly one mover (#1089)
//
// gameplay-vehicle-fleet's design philosophy: "Only an employee moves. A
// vehicle's position changes only because its occupant's movement step wrote
// it." Phase 3b makes src/core/engine/Locomotion.ts that single writer —
// tickVehicle and every other per-tick vehicle-position mutator are deleted
// by the implementer phase. This is one of the three lint tests the issue's
// own migration note promises: "only the locomotion module assigns a
// vehicle's x/z, only the mount module assigns occupantIds/locomotion, and
// nothing outside the locomotion module pathfinds from a vehicle's
// position." (The occupantIds/locomotion one belongs to Mount.ts's own test
// file, not this one.)
//
// At this (red) phase, EntityMovementTick.ts/VehicleOccupancyReroute.ts still
// assign a vehicle's x/z and still pathfind from it — every assertion below
// is expected to fail until the implementer phase deletes those call sites.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const SCANNED_DIR = 'src';
const SOLE_MOVER = 'src/core/engine/Locomotion.ts';

/** Files allowed a vehicle-position write outside Locomotion.ts, each with the reason. */
const ASSIGNMENT_ALLOWLIST: Readonly<Record<string, string>> = {
  // One-time world-gen placement (snapping a freshly spawned vehicle onto
  // navigable ground before any tick has run) — not the per-tick movement
  // class of bug this test exists to catch. See snapAgentsToNavigableGround's
  // own doc comment.
  'src/core/state/GameState.ts': 'one-time spawn-snap onto navigable ground at world-gen, not per-tick movement',
};

/** Identifier prefixes commonly used for a Vehicle-typed local/parameter in this codebase. */
const VEHICLE_VAR = '(?:vehicle|veh|rig|blocker|hauler|truck|digger)';
const ASSIGNMENT = new RegExp(`\\b${VEHICLE_VAR}\\w*\\.[xz]\\s*=(?!=)`, 'i');
const FROM_VEHICLE_POSITION = new RegExp(`fromX:\\s*${VEHICLE_VAR}\\w*\\.x`, 'i');
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** 1-based line numbers in `file` (repo-relative) whose (non-comment) content matches `pattern`. */
function matchingLines(file: string, pattern: RegExp): number[] {
  return readFileSync(join(ROOT, file), 'utf8').split('\n')
    .map((line, i) => (pattern.test(line) && !COMMENT_LINE.test(line) ? i + 1 : 0))
    .filter((n) => n > 0);
}

const FILES = listTsFiles(join(ROOT, SCANNED_DIR)).map((f) => relative(ROOT, f).split(sep).join('/'));

describe('repo-wide — a vehicle has exactly one mover (#1089)', () => {
  it('sanity: Locomotion.ts exists under src/', () => {
    expect(FILES).toContain(SOLE_MOVER);
  });

  it('no file outside Locomotion.ts (and the documented allowlist) assigns a Vehicle\'s x/z', () => {
    const violations = FILES
      .filter((f) => f !== SOLE_MOVER && !(f in ASSIGNMENT_ALLOWLIST))
      .flatMap((f) => matchingLines(f, ASSIGNMENT).map((line) => `${f}:${line}`));

    expect(
      violations,
      violations.length === 0 ? '' :
        `${violations.length} vehicle-position assignment(s) outside ${SOLE_MOVER}:\n`
        + violations.map((v) => `  ${v}`).join('\n')
        + '\n\nA vehicle\'s x/z is written in exactly one place, the locomotion tick, from its'
        + ' occupant\'s position (gameplay-vehicle-fleet, `vehicles` rule). Route this through'
        + ' tickLocomotion/driveVehicleTowardTarget instead of writing the field directly.',
    ).toEqual([]);
  });

  it('every allowlist entry still assigns a vehicle\'s x/z — a stale entry is removed, not kept', () => {
    for (const file of Object.keys(ASSIGNMENT_ALLOWLIST)) {
      expect(FILES, `${file} is allowlisted but no longer exists`).toContain(file);
      expect(matchingLines(file, ASSIGNMENT), `${file} is allowlisted but no longer assigns a vehicle's x/z`).not.toHaveLength(0);
    }
  });

  it('no file outside Locomotion.ts pathfinds (findPath) from a vehicle\'s own position as the origin', () => {
    const violations = FILES
      .filter((f) => f !== SOLE_MOVER)
      .flatMap((f) => matchingLines(f, FROM_VEHICLE_POSITION).map((line) => `${f}:${line}`));

    expect(
      violations,
      violations.length === 0 ? '' :
        `${violations.length} findPath() call(s) starting from a vehicle's own position, outside ${SOLE_MOVER}:\n`
        + violations.map((v) => `  ${v}`).join('\n')
        + '\n\nOnly the locomotion module plans a route from a vehicle\'s current cell — every other'
        + ' vehicle-gated flow should path an employee, then let tickLocomotion drive the vehicle'
        + ' they\'re mounted in.',
    ).toEqual([]);
  });
});
