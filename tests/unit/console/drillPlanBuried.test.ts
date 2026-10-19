// BlastSimulator2026 — drill_plan show marks holes buried under rubble (#1937)

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';

function frag(id: number, x: number, z: number): FragmentData {
  return {
    id, position: { x, y: 0, z }, volume: 0.3, mass: 1000, rockId: 'cruite', oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false,
    halfExtents: { x: 0.3, y: 0.3, z: 0.3 }, shapeSeed: id, origin: { x, y: 0, z },
  };
}

function setup(progression: boolean) {
  const { runner, ctx } = createRunner();
  expect(runner.run('new_game seed:42 size:32 staffed:true').success).toBe(true);
  if (progression) ctx.state!.grade = createGradeState();
  expect(runner.run('drill_plan add x:14 z:14 depth:6').success).toBe(true);
  expect(runner.run('drill_plan add x:20 z:20 depth:6').success).toBe(true);
  return { runner, state: ctx.state! };
}

const lineOf = (out: string, id: string) => out.split('\n').find(l => l.trim().startsWith(`${id}:`))!;

describe('drill_plan show buried marker (#1937)', () => {
  it('marks only the hole under rubble on a progression site', () => {
    const { runner, state } = setup(true);
    const [a, b] = state.plannedDrillHoles;
    addBlastFragments(state.logistics, [frag(1, a!.x, a!.z)]);
    const out = runner.run('drill_plan show').output;
    expect(lineOf(out, a!.id)).toMatch(/buried/i);
    expect(lineOf(out, b!.id)).not.toMatch(/buried/i);
  });

  it('drops the marker once the rubble is hauled', () => {
    const { runner, state } = setup(true);
    addBlastFragments(state.logistics, [frag(1, state.plannedDrillHoles[0]!.x, state.plannedDrillHoles[0]!.z)]);
    state.logistics.fragments.splice(0, 1);
    expect(runner.run('drill_plan show').output).not.toMatch(/buried/i);
  });

  it('never marks a hole on a non-progression site', () => {
    const { runner, state } = setup(false);
    addBlastFragments(state.logistics, [frag(1, state.plannedDrillHoles[0]!.x, state.plannedDrillHoles[0]!.z)]);
    expect(runner.run('drill_plan show').output).not.toMatch(/buried/i);
  });
});
