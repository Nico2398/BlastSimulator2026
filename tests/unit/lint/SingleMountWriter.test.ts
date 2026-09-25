// BlastSimulator2026 — repo-wide: who-is-in-which-vehicle has exactly one writer
//
// gameplay-vehicle-fleet's Invariants section promises three lint tests that
// keep the writers singular. SingleVehicleMover.test.ts holds two of them
// (a vehicle's x/z, and pathfinding from a vehicle's position). This is the
// third: only src/core/engine/Mount.ts assigns `Vehicle.occupantIds` or
// `Employee.locomotion`.
//
// Those two fields are one fact stored on both sides — invariant I1 requires
// them to agree in both directions — so a second writer that updates one side
// and forgets the other is exactly the desync I1 exists to catch at runtime.
// This catches it at review time instead.
//
// Test fixtures are deliberately out of scope (src/ only): they build states,
// including invalid ones, by hand.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(import.meta.dirname, '../../..');
const SCANNED_DIR = 'src';
const SOLE_WRITER = 'src/core/engine/Mount.ts';

/** Reassigning either field, or mutating the occupant array in place. */
const MOUNT_WRITE = /\.(?:occupantIds|locomotion)\s*=(?!=)|\.occupantIds\.(?:push|pop|shift|unshift|splice)\(|\.occupantIds\.length\s*=(?!=)/;
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

/** 1-based line numbers in `file` (repo-relative) whose non-comment content writes a mount field. */
function mountWriteLines(file: string): number[] {
  return readFileSync(join(ROOT, file), 'utf8').split('\n')
    .map((line, i) => (MOUNT_WRITE.test(line) && !COMMENT_LINE.test(line) ? i + 1 : 0))
    .filter((n) => n > 0);
}

const FILES = listTsFiles(join(ROOT, SCANNED_DIR)).map((f) => relative(ROOT, f).split(sep).join('/'));

describe('repo-wide — occupantIds and locomotion have exactly one writer', () => {
  it('the pattern recognises every write shape it claims to', () => {
    for (const line of [
      'vehicle.occupantIds = [];',
      'vehicle.occupantIds.push(employeeId);',
      'v.occupantIds.splice(0, 1);',
      'vehicle.occupantIds.length = 0;',
      "employee.locomotion = { kind: 'on_foot' };",
    ]) {
      expect(MOUNT_WRITE.test(line), line).toBe(true);
    }
    for (const line of [
      'if (vehicle.occupantIds.length === 0) return;',
      "if (employee.locomotion.kind === 'mounted') return;",
      'const driver = vehicle.occupantIds[0];',
      'occupantIds: [],',
    ]) {
      expect(MOUNT_WRITE.test(line), line).toBe(false);
    }
  });

  it('sanity: Mount.ts exists under src/ and is itself a writer', () => {
    expect(FILES).toContain(SOLE_WRITER);
    expect(mountWriteLines(SOLE_WRITER)).not.toHaveLength(0);
  });

  it('no file outside Mount.ts writes occupantIds or locomotion', () => {
    const violations = FILES
      .filter((f) => f !== SOLE_WRITER)
      .flatMap((f) => mountWriteLines(f).map((line) => `${f}:${line}`));

    expect(
      violations,
      violations.length === 0 ? '' :
        `${violations.length} mount-state write(s) outside ${SOLE_WRITER}:\n`
        + violations.map((v) => `  ${v}`).join('\n')
        + '\n\nWho is in which vehicle is one fact stored on both sides, and invariant I1 requires'
        + ' the two to agree (gameplay-vehicle-fleet, `vehicles` rule). Call Mount.board / Mount.alight'
        + ' so both sides change together.',
    ).toEqual([]);
  });
});
