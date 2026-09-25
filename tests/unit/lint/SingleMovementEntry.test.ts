// BlastSimulator2026 — repo-wide: itinerary/destinationX/destinationZ have
// exactly one write surface (#1178, single-mover unification)
//
// gameplay-vehicle-fleet's Invariants section (and the `vehicles` rule) name
// moveTo as the only entry point that starts movement. Before #1178, three
// call sites still wrote `Employee.destinationX/destinationZ` directly
// instead of routing through moveTo — RestActionHelpers.ts's beginRestTravel,
// Zone.ts's clearZone (foot-evacuee branch), and EmployeeDispatchSteps.ts's
// promoteActionToActive fallback. #1178 deletes all three writers: moveTo
// grows an `allowUnreachable` flag so a target unreachable right now still
// installs a retrying itinerary instead of refusing, and destinationX/
// destinationZ become a READ-ONLY MIRROR of the itinerary's current leg,
// written only by Locomotion.ts and MoveTo.ts's syncItineraryMirrors.
//
// This is the third lint test the issue's migration note promises, mirroring
// SingleVehicleMover.test.ts (a vehicle's x/z) and SingleMountWriter.test.ts
// (occupantIds/locomotion): only Locomotion.ts and MoveTo.ts may assign
// `.itinerary`, `.destinationX`, or `.destinationZ`.
//
// At this (red) phase, RestActionHelpers.ts, Zone.ts, and
// EmployeeDispatchSteps.ts still write destinationX/destinationZ directly —
// the "no other writer in src/" test below is expected to fail until the
// implementer phase routes all three through moveTo.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const SCANNED_DIR = 'src';

/** The only two modules allowed to write itinerary/destinationX/destinationZ. */
const SOLE_WRITERS: readonly string[] = [
  'src/core/engine/Locomotion.ts',
  'src/core/engine/MoveTo.ts',
];

/** Files allowed a write outside the sole writers, each with the reason. */
const ALLOWLIST: Readonly<Record<string, string>> = {
  // alight() (Mount.ts) is the one place an employee ever stops being
  // mounted — it nulls itinerary (and, per #1178, destinationX/destinationZ
  // too) as its own side effect, so a stale mirror from before the alight is
  // never misread as "still walking" by isMidEvacuationWalk (Evacuation.ts)
  // or isIdleForReposition (VehicleDriverAssignment.ts). See alight()'s own
  // #1089/#1178 doc comments.
  'src/core/engine/Mount.ts': 'alight() nulls the stale itinerary/destination mirror when ending a mount, so a dismounted employee is never misread as still walking',
  // clearHolderWalkFields nulls `itinerary` (and, pre-#1178, destinationX/Z
  // directly) when releasing a claimed action back to the pool — an
  // interruption/cancellation must never leave a moveTo-installed itinerary
  // still attached once the employee is idle-but-claimable again
  // (WorldInvariants.ts's I9 check). destinationX/Z clear via the mirror sync
  // (syncItineraryMirrors) once itinerary itself is null, not a separate
  // direct write.
  'src/core/engine/TaskCancellation.ts': 'clearHolderWalkFields nulls itinerary when releasing a claimed action back to the pool — destinationX/Z clear via the mirror sync',
};

/** Assignment to `.itinerary`, `.destinationX`, or `.destinationZ` — never a comparison (`===`/`!==`) or a plain read. */
const WRITE = /\.(itinerary|destinationX|destinationZ)\s*=(?!=)/;
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

/** 1-based line numbers in `file` (repo-relative) whose non-comment content writes one of the three fields. */
function writeLines(file: string): number[] {
  return readFileSync(join(ROOT, file), 'utf8').split('\n')
    .map((line, i) => (WRITE.test(line) && !COMMENT_LINE.test(line) ? i + 1 : 0))
    .filter((n) => n > 0);
}

/** Builds the same violation-report message the real assertion emits — exercised directly, against synthetic input, so its shape is proven independent of the codebase's current (red-phase) state. */
function buildViolationMessage(violations: string[]): string {
  if (violations.length === 0) return '';
  return `${violations.length} itinerary/destination write(s) outside ${SOLE_WRITERS.join(', ')}:\n`
    + violations.map((v) => `  ${v}`).join('\n')
    + '\n\nemployee.destinationX/destinationZ are a read-only mirror of the itinerary\'s current leg'
    + ' (gameplay-vehicle-fleet, `vehicles` rule). Use moveTo/syncItineraryMirrors instead of writing'
    + ' these fields directly.';
}

const FILES = listTsFiles(join(ROOT, SCANNED_DIR)).map((f) => relative(ROOT, f).split(sep).join('/'));

describe('repo-wide — itinerary/destinationX/destinationZ have exactly one write surface (#1178)', () => {
  it('the pattern recognises every write shape it claims to', () => {
    for (const line of [
      'employee.itinerary = null;',
      'emp.destinationX = 12;',
      'emp.destinationZ = z;',
      "employee.itinerary = itinerary;",
    ]) {
      expect(WRITE.test(line), line).toBe(true);
    }
    for (const line of [
      'if (employee.itinerary === null) return;',
      'if (emp.destinationX !== null) return;',
      'const d = employee.destinationX;',
      'destinationX: null,',
      'expect(employee.destinationX).toBeNull();',
    ]) {
      expect(WRITE.test(line), line).toBe(false);
    }
  });

  it('sanity: both sole writers exist under src/ and are themselves writers', () => {
    for (const file of SOLE_WRITERS) {
      expect(FILES).toContain(file);
      expect(writeLines(file), `${file} is a declared sole writer but writes none of the three fields`).not.toHaveLength(0);
    }
  });

  it('every allowlist entry still genuinely contains a matching write — a stale entry is removed, not kept', () => {
    for (const file of Object.keys(ALLOWLIST)) {
      expect(FILES, `${file} is allowlisted but no longer exists`).toContain(file);
      expect(writeLines(file), `${file} is allowlisted but no longer writes itinerary/destinationX/destinationZ`).not.toHaveLength(0);
    }
  });

  it('the violation message names the file, the line, and says to use moveTo/syncItineraryMirrors instead', () => {
    const message = buildViolationMessage(['src/core/entities/Zone.ts:205', 'src/core/entities/Zone.ts:206']);

    expect(message).toContain('src/core/entities/Zone.ts:205');
    expect(message).toContain('src/core/entities/Zone.ts:206');
    expect(message).toContain('moveTo');
    expect(message).toContain('syncItineraryMirrors');
  });

  it('the violation message is empty when there is nothing to report (boundary)', () => {
    expect(buildViolationMessage([])).toBe('');
  });

  it('no file outside Locomotion.ts/MoveTo.ts (and the documented allowlist) writes itinerary/destinationX/destinationZ', () => {
    const violations = FILES
      .filter((f) => !SOLE_WRITERS.includes(f) && !(f in ALLOWLIST))
      .flatMap((f) => writeLines(f).map((line) => `${f}:${line}`));

    expect(violations, buildViolationMessage(violations)).toEqual([]);
  });
});
