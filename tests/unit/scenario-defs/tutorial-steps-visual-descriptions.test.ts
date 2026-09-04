import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { ScenarioStepDef } from '../../../scripts/shared/scenario-types.js';
import { loadScenarioDef, SCENARIO_DIR } from '../../../scripts/shared/scenario-utils.js';

const SCENARIO_NAME = 'tutorial-steps-visual';
const SCENARIO_PATH = path.resolve(SCENARIO_DIR, `${SCENARIO_NAME}.json`);

function readRawFile(): string {
    return fs.readFileSync(SCENARIO_PATH, 'utf-8');
}

function findStep(
    steps: ScenarioStepDef[],
    predicate: (s: ScenarioStepDef) => boolean,
    label: string
): ScenarioStepDef {
    const step = steps.find(predicate);
    if (!step) {
        throw new Error(
            `findStep: no step found matching "${label}" — ` +
                'the scenario file structure changed; update the lookup, do not assume a positional index.'
        );
    }
    return step;
}

describe('tutorial-steps-visual.json descriptions', () => {
    it('is valid JSON', () => {
        const raw = readRawFile();
        expect(() => JSON.parse(raw)).not.toThrow();
    });

    it('contains no stale 4x4/16-hole grid references anywhere in the file', () => {
        const raw = readRawFile();
        expect(raw).not.toMatch(/16 holes/i);
        expect(raw).not.toMatch(/16-hole/i);
        expect(raw).not.toMatch(/4x4/i);
        expect(raw).not.toMatch(/x:20-29/);
        expect(raw).not.toMatch(/z:20-29/);
    });

    it('step 23 (drill_plan grid) description describes the real 3x3/9-hole grid', () => {
        const { steps } = loadScenarioDef(SCENARIO_NAME);
        const step = findStep(
            steps,
            (s) => s.command.startsWith('drill_plan grid rows:3 cols:3'),
            'drill_plan grid rows:3 cols:3'
        );

        expect(step.description).toMatch(/3x3/);
        expect(step.description).toMatch(/9-hole|9 hole/i);
        expect(step.description).toContain('22,20');
        expect(step.description).toContain('30,28');
    });

    it('step 24 (drill wait, waitUntil-chunked by #689-followup) description describes 9 holes, not 16', () => {
        const { steps } = loadScenarioDef(SCENARIO_NAME);
        const drillPlanIndex = steps.findIndex((s) =>
            s.command.startsWith('drill_plan grid rows:3 cols:3')
        );
        if (drillPlanIndex === -1) {
            throw new Error(
                'step 24 (drill wait) lookup: could not locate the drill_plan-grid step to anchor from — ' +
                    'the scenario file structure changed; update the lookup, do not assume a positional index.'
            );
        }

        // #689-followup: the fixed `tick 50` x8 chunks this test used to
        // anchor on (themselves a #681 split of an even earlier single
        // `tick 400` block) were replaced with `waitUntil`-on-holeCount
        // chunks — a fixed tick budget ran ~184 ticks past when drilling
        // actually finishes, and that overrun alone was enough to crash
        // wellBeing into a real worker_revolt (see the chunks' own
        // description in tutorial-steps-visual.json). Collect the run of
        // `wait_until field:holeCount` steps immediately after
        // drill_plan-grid; the 9-hole-grid description (no stale
        // 16-hole/4x4 references) now lives on the last one of that run.
        const waitChunk: ScenarioStepDef[] = [];
        for (
            let i = drillPlanIndex + 1;
            i < steps.length && steps[i]!.command.startsWith('wait_until field:holeCount');
            i++
        ) {
            waitChunk.push(steps[i]!);
        }
        if (waitChunk.length === 0) {
            throw new Error(
                'step 24 (drill wait) lookup: no `wait_until field:holeCount` steps found immediately after drill_plan-grid — ' +
                    'the scenario file structure changed; update the lookup, do not assume a positional index.'
            );
        }
        const step = waitChunk[waitChunk.length - 1]!;

        expect(step.description).toMatch(/9 hole/i);
        expect(step.description).not.toMatch(/16 hole/i);
        expect(step.description).not.toMatch(/4x4/i);
    });

    it('step 26 (charge wait) description reasons about waiting for all 9 holes to charge', () => {
        const { steps } = loadScenarioDef(SCENARIO_NAME);
        // #689-followup: the fixed `tick 225` step this test used to anchor
        // on was replaced with a `waitUntil` on chargedCount itself — see
        // that step's own description in tutorial-steps-visual.json.
        const step = findStep(
            steps,
            (s) => s.command.startsWith('wait_until field:chargedCount'),
            'wait_until field:chargedCount'
        );

        expect(step.description).toMatch(/all 9 holes/i);
    });

    it('step 29 (blast) description re-derives deathCount:0 against the real footprint, assertion itself untouched', () => {
        const { steps } = loadScenarioDef(SCENARIO_NAME);
        const step = findStep(steps, (s) => s.command === 'blast', 'blast');

        const mentionsRealFootprint =
            step.description?.includes('20-26') ||
            step.description?.includes('x:20-26') ||
            step.description?.includes('z:20-26');
        expect(mentionsRealFootprint).toBe(true);

        expect(step.description).not.toContain('x:20-29');
        expect(step.description).not.toContain('z:20-29');
        expect(step.description).not.toContain('4x4');

        // #707 (converged): forceShiftRestIfNeededByPolicy's (ForceShiftRest.ts)
        // idle-employee proactive-rest fix changed BOTH employees' fates
        // here, not just the surveyor's (Walt Dusty) -- Kurt Pickaxe (the
        // driller) also gets routed away from the grid once idle. A
        // tick-by-tick command-mode probe from the chargedCount:9 landing
        // point found deathCount:2 for the first 5 ticks after that point,
        // deathCount:1 for exactly 1 more tick, and deathCount:0 -- both
        // employees clear of the blast footprint -- from 6 ticks onward,
        // continuously through at least 900 ticks past that point. No
        // nonzero deathCount is a safe target any more: the earlier
        // #689-followup value (1) was only ever true for a single-tick
        // window in command mode's own timeline, and interaction mode's own
        // per-step polling overhead has no reason to land its blast tick in
        // that same single tick. A new `tick 50` step (between the
        // chargedCount wait and `event choose 0`) spends 50 idle ticks --
        // comfortably inside the wide 6-900 safe window, and identical in
        // both modes since a plain `tick N` with no waitUntil target
        // advances both trajectories by the same fixed amount -- so this
        // step's own deathCount converges to 0 in both. See
        // tutorial-steps-visual.json's own step comments (the new `tick 50`
        // step and this blast step) for the full account, verified in both
        // command mode and a real interaction-mode run.
        expect(step.expect?.equals?.deathCount).toBe(0);
    });
});
