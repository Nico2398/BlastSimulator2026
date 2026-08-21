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

    it('step 24 (tick 400) description describes 9 holes, not 16', () => {
        const { steps } = loadScenarioDef(SCENARIO_NAME);
        const drillPlanIndex = steps.findIndex((s) =>
            s.command.startsWith('drill_plan grid rows:3 cols:3')
        );
        if (drillPlanIndex === -1) {
            throw new Error(
                'step 24 (tick 400) lookup: could not locate the drill_plan-grid step to anchor from — ' +
                    'the scenario file structure changed; update the lookup, do not assume a positional index.'
            );
        }
        const step = steps[drillPlanIndex + 1];
        if (!step || step.command !== 'tick 400') {
            throw new Error(
                `step 24 (tick 400) lookup: step immediately after drill_plan-grid has command ` +
                    `"${step?.command}", expected "tick 400" — the scenario file structure changed; ` +
                    'update the lookup, do not assume a positional index.'
            );
        }

        expect(step.description).toMatch(/9 hole/i);
        expect(step.description).not.toMatch(/16 hole/i);
        expect(step.description).not.toMatch(/4x4/i);
    });

    it('step 26 (tick 225) description reasons about 9 holes charging first', () => {
        const { steps } = loadScenarioDef(SCENARIO_NAME);
        const step = findStep(steps, (s) => s.command === 'tick 225', 'tick 225');

        expect(step.description).toMatch(/FIRST of 9 holes/i);
        expect(step.description).toMatch(/all 9 holes/i);
    });

    it('step 29 (blast) description re-derives deathCount:2 against the real footprint, assertion itself untouched', () => {
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

        expect(step.expect?.equals?.deathCount).toBe(2);
    });
});
