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
        expect(step.description).toContain('20,20');
        expect(step.description).toContain('26,26');
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

    it('step 29 (blast) description re-derives deathCount:1 against the real footprint, assertion itself untouched', () => {
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

        // #689-followup: the drill/charge waits above are now waitUntil-driven
        // instead of fixed-tick padded, reaching this blast ~350 ticks earlier
        // (tick 363 instead of 715) -- direct trace confirms the surveyor
        // survives (idle near the relocated living_quarters) while the driller
        // still dies at the grid-centre spawn point, so deathCount is 1, not 2.
        expect(step.expect?.equals?.deathCount).toBe(1);
    });
});
