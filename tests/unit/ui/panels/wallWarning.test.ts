// BlastSimulator2026 — wall warning memo and text (#1943)
import { describe, it, expect } from 'vitest';
import { WallWarningMemo } from '../../../../src/ui/panels/wallWarningMemo.js';
import { wallWarningText } from '../../../../src/ui/panels/wallWarningText.js';
import { predictWallFaces } from '../../../../src/core/mining/WallStability.js';
import { assembleBlastPlan } from '../../../../src/core/mining/BlastPlan.js';
import { buildWallGrid, standardShot } from '../../../helpers/wallWarningFixture.js';
import { setLocale } from '../../../../src/core/i18n/I18n.js';

describe('WallWarningMemo', () => {
  it('returns [] on a non-progression site (no grade state)', () => {
    const shot = standardShot('krackle', 8, false);
    expect(new WallWarningMemo().get(shot.state, shot.plan, buildWallGrid({ plateauTop: 25 }))).toEqual([]);
  });

  it('returns [] without a grid', () => {
    const shot = standardShot();
    expect(new WallWarningMemo().get(shot.state, shot.plan, null)).toEqual([]);
  });

  it('returns the predicted faces on a progression site', () => {
    const shot = standardShot();
    const grid = buildWallGrid({ plateauTop: 25 });
    const faces = new WallWarningMemo().get(shot.state, shot.plan, grid);
    expect(faces.length).toBeGreaterThan(0);
    expect(JSON.stringify(faces)).toBe(JSON.stringify(predictWallFaces(shot.plan, buildWallGrid({ plateauTop: 25 }))));
  });

  it('returns [] when nothing is predicted', () => {
    const shot = standardShot();
    expect(new WallWarningMemo().get(shot.state, shot.plan, buildWallGrid({ plateauTop: 21 }))).toEqual([]);
  });

  it('caches: the same plan and terrain revision give the identical array', () => {
    const shot = standardShot();
    const grid = buildWallGrid({ plateauTop: 25 });
    const memo = new WallWarningMemo();
    const a = memo.get(shot.state, shot.plan, grid);
    expect(a.length).toBeGreaterThan(0);
    expect(memo.get(shot.state, shot.plan, grid)).toBe(a);
    expect(memo.get(shot.state, assembleBlastPlan(shot.state.drillHoles, shot.state.chargesByHole), grid)).toBe(a);
  });

  it('recomputes when the terrain changes (editRevision)', () => {
    const shot = standardShot();
    const grid = buildWallGrid({ plateauTop: 25 });
    const memo = new WallWarningMemo();
    const a = memo.get(shot.state, shot.plan, grid);
    // Lower the plateau next to the crater: the wall is no longer tall.
    for (let z = 0; z < 40; z++) for (let x = 0; x <= 13; x++) for (let y = 22; y <= 25; y++) grid.clearVoxel(x, y, z);
    const b = memo.get(shot.state, shot.plan, grid);
    expect(b).not.toBe(a);
    expect(b).toEqual([]);
  });

  it('recomputes when a charge changes', () => {
    const shot = standardShot();
    const grid = buildWallGrid({ plateauTop: 25 });
    const memo = new WallWarningMemo();
    const a = memo.get(shot.state, shot.plan, grid);
    delete shot.state.chargesByHole[shot.holeIds[4]!];
    const b = memo.get(shot.state, assembleBlastPlan(shot.state.drillHoles, shot.state.chargesByHole), grid);
    expect(b).not.toBe(a);
  });

  it('recomputes when the holes change', () => {
    const shot = standardShot();
    const grid = buildWallGrid({ plateauTop: 25 });
    const memo = new WallWarningMemo();
    memo.get(shot.state, shot.plan, grid);
    shot.state.drillHoles.length = 0;
    expect(memo.get(shot.state, assembleBlastPlan(shot.state.drillHoles, shot.state.chargesByHole), grid)).toEqual([]);
  });
});

describe('wallWarningText', () => {
  it('names the face height, the rock and the safe height', () => {
    setLocale('en');
    const [p] = predictWallFaces(standardShot().plan, buildWallGrid({ plateauTop: 25 })).filter(q => q.face.crest.x === 13 && q.face.crest.z === 20);
    const text = wallWarningText(p!);
    expect(text).toContain('13');
    expect(text).toContain('Cruite');
    expect(text).toContain('12');
    expect(text).not.toContain('{');
  });

  it('reports the rock of the weakest wall voxel, not a fixed name', () => {
    setLocale('en');
    const [p] = predictWallFaces(standardShot().plan, buildWallGrid({ plateauTop: 25, rock: 'molite' })).filter(q => q.face.crest.x === 13 && q.face.crest.z === 20);
    const text = wallWarningText(p!);
    expect(text).toContain('Molite');
    expect(text).toContain('15');
  });
});
