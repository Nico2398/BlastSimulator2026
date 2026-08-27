import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { newGameCommand } from '../../../src/console/commands/world.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import {
  blastCommand,
  blastPlanCommand,
  blastPreviewCommand,
  buildRampCommand,
  chargeCommand,
  drillPlanCommand,
  previewCommand,
  sequenceCommand,
  surveyCommand,
  weatherCommand,
} from '../../../src/console/commands/mining.js';
import { resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { tickCommand } from '../../../src/console/commands/events.js';
import * as BlastExecutionModule from '../../../src/core/mining/BlastExecution.js';
import * as SurveyCalcModule from '../../../src/core/mining/SurveyCalc.js';

// #795: mining.ts's own static, non-per-item strings (its local requireGame,
// formatBlastPlanErrors' two headers, every "Usage:" string, the three "==="
// report headers, and six empty-state messages) route through t() — see
// src/core/i18n/I18n.ts. Every test below pins the exact English literal
// (must stay byte-identical against pre-existing tests elsewhere in this
// suite) and additionally proves the output changes under locale 'fr',
// so a hardcoded string that merely matches en.json cannot pass.

function makeMiningContext(): MiningContext {
  const ctx: MiningContext = {
    state: null,
    grid: null,
    landscape: null,
    playableArea: null,
    emitter: new EventEmitter(),
  };
  // Staffed: several assertions below need a hole to actually land in
  // state.drillHoles (not just plannedDrillHoles), which requires a
  // qualified employee + drill_rig vehicle to complete the queued
  // drill_hole action — mirrors mining-commands.test.ts's own
  // makeMiningContext.
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32', staffed: 'true' });
  return ctx;
}

/** Mirrors mining-commands.test.ts's own helper — ticks until every ordered hole lands. */
function driveDrillPlanToCompletion(ctx: MiningContext, maxTicks = 200): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedDrillHoles.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.hunger = 100;
      emp.fatigue = 100;
      emp.breakNeed = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
}

/** Mirrors mining-commands.test.ts's own helper — ticks until every ordered charge lands. */
function driveChargePlanToCompletion(ctx: MiningContext, maxTicks = 200): void {
  for (let i = 0; i < maxTicks && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.hunger = 100;
      emp.fatigue = 100;
      emp.breakNeed = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
}

beforeEach(() => resetHoleIds());
afterEach(() => setLocale('en'));

// ── requireGame (mining.ts's own local guard) ────────────────────────────

describe('mining.ts requireGame guard', () => {
  const NO_GAME_LOADED_EN = 'No game loaded. Use new_game first.';

  it('returns the exact English literal when no game is loaded', () => {
    const ctx: MiningContext = {
      state: null,
      grid: null,
      landscape: null,
      playableArea: null,
      emitter: new EventEmitter(),
    };
    const result = chargeCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(NO_GAME_LOADED_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx: MiningContext = {
      state: null,
      grid: null,
      landscape: null,
      playableArea: null,
      emitter: new EventEmitter(),
    };
    setLocale('fr');

    const result = chargeCommand(ctx, [], {});

    expect(result.success).toBe(false);
    expect(result.output).not.toBe(NO_GAME_LOADED_EN);
  });
});

// ── formatBlastPlanErrors headers ────────────────────────────────────────

describe('formatBlastPlanErrors — "Invalid plan" header (blastCommand)', () => {
  function makeUnchargedPlan(ctx: MiningContext): void {
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
  }

  it('starts the output with "Invalid plan:" in English', () => {
    const ctx = makeMiningContext();
    makeUnchargedPlan(ctx);

    const result = blastCommand(ctx, [], {});

    expect(result.success).toBe(false);
    expect(result.output.startsWith('Invalid plan:')).toBe(true);
  });

  it('the header line differs from the English literal under locale fr', () => {
    const ctx = makeMiningContext();
    makeUnchargedPlan(ctx);
    setLocale('fr');

    const result = blastCommand(ctx, [], {});

    expect(result.success).toBe(false);
    const headerLine = result.output.split('\n')[0];
    expect(headerLine).not.toBe('Invalid plan:');
  });
});

describe('formatBlastPlanErrors — "Validation issues" header (blastPlanCommand validate)', () => {
  function makeUnchargedPlan(ctx: MiningContext): void {
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
  }

  it('starts the output with "Validation issues:" in English', () => {
    const ctx = makeMiningContext();
    makeUnchargedPlan(ctx);

    const result = blastPlanCommand(ctx, ['validate'], {});

    expect(result.success).toBe(false);
    expect(result.output.startsWith('Validation issues:')).toBe(true);
  });

  it('the header line differs from the English literal under locale fr', () => {
    const ctx = makeMiningContext();
    makeUnchargedPlan(ctx);
    setLocale('fr');

    const result = blastPlanCommand(ctx, ['validate'], {});

    expect(result.success).toBe(false);
    const headerLine = result.output.split('\n')[0];
    expect(headerLine).not.toBe('Validation issues:');
  });
});

// ── "Usage:" strings ─────────────────────────────────────────────────────

describe('mining.ts usage strings — English literal + fr divergence', () => {
  const cases: Array<{
    name: string;
    englishLiteral: string;
    run: (ctx: MiningContext) => { success: boolean; output: string };
  }> = [
    {
      name: 'drill_plan usage',
      englishLiteral: 'Usage: drill_plan grid|add|remove|clear|show [options]',
      run: (ctx) => drillPlanCommand(ctx, ['bogus'], {}),
    },
    {
      name: 'sequence usage',
      englishLiteral: 'Usage: sequence auto|set|show [options]',
      run: (ctx) => sequenceCommand(ctx, ['bogus'], {}),
    },
    {
      name: 'blast_plan usage',
      englishLiteral: 'Usage: blast_plan save|load|list|validate name:plan1',
      run: (ctx) => blastPlanCommand(ctx, ['bogus'], {}),
    },
    {
      name: 'preview usage',
      englishLiteral: 'Usage: preview energy|fragments|projections|vibrations',
      run: (ctx) => previewCommand(ctx, ['bogus'], {}),
    },
    {
      name: 'build_ramp cancel usage',
      englishLiteral: 'Usage: build_ramp cancel id:<ramp-id>',
      run: (ctx) => buildRampCommand(ctx, ['cancel'], {}),
    },
    {
      name: 'survey usage (no subcommand)',
      englishLiteral: 'Usage: survey <seismic|core_sample|aerial> x:<X> z:<Z>',
      run: (ctx) => surveyCommand(ctx, [], {}),
    },
    {
      name: 'charge missing explosive',
      englishLiteral: 'Missing explosive. Usage: charge hole:1 explosive:boomite amount:5kg stemming:2m',
      run: (ctx) => chargeCommand(ctx, [], {}),
    },
    {
      name: 'survey unknown method',
      englishLiteral: 'Unknown method "foobar". Usage: survey <seismic|core_sample|aerial> x:<X> z:<Z>',
      run: (ctx) => surveyCommand(ctx, ['foobar'], { x: '10', z: '10' }),
    },
  ];

  for (const { name, englishLiteral, run } of cases) {
    it(`${name} — matches the exact English literal by default`, () => {
      const ctx = makeMiningContext();
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).toBe(englishLiteral);
    });

    it(`${name} — differs from the English literal under locale fr`, () => {
      const ctx = makeMiningContext();
      setLocale('fr');
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).not.toBe(englishLiteral);
    });
  }

  // weather set usage interpolates the valid-states list — tested separately
  // since it can't share the fixed-literal table above.
  const WEATHER_SET_USAGE_EN =
    'Usage: weather set <state>. Valid: sunny, cloudy, light_rain, heavy_rain, storm, heat_wave, cold_snap';

  it('weather set usage — matches the exact English literal by default', () => {
    const ctx = makeMiningContext();
    const result = weatherCommand(ctx, ['set'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(WEATHER_SET_USAGE_EN);
  });

  it('weather set usage — differs from the English literal under locale fr', () => {
    const ctx = makeMiningContext();
    setLocale('fr');
    const result = weatherCommand(ctx, ['set'], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(WEATHER_SET_USAGE_EN);
  });
});

// ── "===" report headers ─────────────────────────────────────────────────

describe('mining.ts "===" report headers — English literal + fr divergence', () => {
  function makeFullPlan(ctx: MiningContext): void {
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });
  }

  it('blastCommand — output starts with "=== BLAST REPORT ===" in English', () => {
    const ctx = makeMiningContext();
    makeFullPlan(ctx);

    const result = blastCommand(ctx, [], {});

    expect(result.success).toBe(true);
    expect(result.output.startsWith('=== BLAST REPORT ===')).toBe(true);
  });

  it('blastCommand — header differs from the English literal under locale fr', () => {
    const ctx = makeMiningContext();
    makeFullPlan(ctx);
    setLocale('fr');

    const result = blastCommand(ctx, [], {});

    expect(result.success).toBe(true);
    const headerLine = result.output.split('\n')[0];
    expect(headerLine).not.toBe('=== BLAST REPORT ===');
  });

  it('blastPreviewCommand — output starts with "=== BLAST PREVIEW ===" in English', () => {
    const ctx = makeMiningContext();
    makeFullPlan(ctx);

    const result = blastPreviewCommand(ctx, [], {});

    expect(result.success).toBe(true);
    expect(result.output.startsWith('=== BLAST PREVIEW ===')).toBe(true);
  });

  it('blastPreviewCommand — header differs from the English literal under locale fr', () => {
    const ctx = makeMiningContext();
    makeFullPlan(ctx);
    setLocale('fr');

    const result = blastPreviewCommand(ctx, [], {});

    expect(result.success).toBe(true);
    const headerLine = result.output.split('\n')[0];
    expect(headerLine).not.toBe('=== BLAST PREVIEW ===');
  });

  it('surveyCommand ore_report — output starts with "=== ORE REPORT ===" in English', () => {
    const ctx = makeMiningContext();
    ctx.state!.lastOreReport = {
      oreYields: { dirtite: 100 },
      totalYieldKg: 100,
      estimatedYieldKg: 100,
      yieldRatio: 1,
      hasTreranium: false,
      absurdiumFraction: 0,
    };

    const result = surveyCommand(ctx, ['ore_report'], {});

    expect(result.success).toBe(true);
    expect(result.output.startsWith('=== ORE REPORT ===')).toBe(true);
  });

  it('surveyCommand ore_report — header differs from the English literal under locale fr', () => {
    const ctx = makeMiningContext();
    ctx.state!.lastOreReport = {
      oreYields: { dirtite: 100 },
      totalYieldKg: 100,
      estimatedYieldKg: 100,
      yieldRatio: 1,
      hasTreranium: false,
      absurdiumFraction: 0,
    };
    setLocale('fr');

    const result = surveyCommand(ctx, ['ore_report'], {});

    expect(result.success).toBe(true);
    const headerLine = result.output.split('\n')[0];
    expect(headerLine).not.toBe('=== ORE REPORT ===');
  });
});

// ── empty-state messages ─────────────────────────────────────────────────

describe('mining.ts empty-state messages — English literal + fr divergence', () => {
  const cases: Array<{
    name: string;
    englishLiteral: string;
    run: (ctx: MiningContext) => { success: boolean; output: string };
  }> = [
    {
      name: 'drill_plan show — no holes',
      englishLiteral: 'No drill holes. Use drill_plan grid or drill_plan add.',
      run: (ctx) => drillPlanCommand(ctx, ['show'], {}),
    },
    {
      name: 'charge show — no charges',
      englishLiteral: 'No charges set.',
      run: (ctx) => chargeCommand(ctx, ['show'], {}),
    },
    {
      name: 'sequence show — no delays',
      englishLiteral: 'No sequence set.',
      run: (ctx) => sequenceCommand(ctx, ['show'], {}),
    },
    {
      name: 'blast_plan list — no saved plans',
      englishLiteral: 'No saved plans.',
      run: (ctx) => blastPlanCommand(ctx, ['list'], {}),
    },
    {
      name: 'survey show — no pending surveys',
      englishLiteral: 'No pending surveys.',
      run: (ctx) => surveyCommand(ctx, ['show'], {}),
    },
    {
      name: 'blastPreviewCommand — no drill plan',
      englishLiteral: 'No drill plan. Create one with drill_plan grid or drill_plan add.',
      run: (ctx) => blastPreviewCommand(ctx, [], {}),
    },
    {
      name: 'survey ore_report — no report available',
      englishLiteral: 'No blast ore report available yet. Run a blast first.',
      run: (ctx) => surveyCommand(ctx, ['ore_report'], {}),
    },
  ];

  for (const { name, englishLiteral, run } of cases) {
    it(`${name} — matches the exact English literal by default`, () => {
      const ctx = makeMiningContext();
      const result = run(ctx);
      expect(result.output).toBe(englishLiteral);
    });

    it(`${name} — differs from the English literal under locale fr`, () => {
      const ctx = makeMiningContext();
      setLocale('fr');
      const result = run(ctx);
      expect(result.output).not.toBe(englishLiteral);
    });
  }
});

// ── #797: mining.ts's remaining hardcoded per-outcome strings ──────────────
// (drill_plan grid's invalid-grid rejection, build_ramp's invalid-length
// rejection, survey's invalid-coordinates/no-surveyor rejections) route
// through t() the same way #795's strings above already do. Each case below
// pins the exact English literal and proves the output changes under
// locale 'fr'.

describe('mining.ts #797 remaining rejection strings — English literal + fr divergence', () => {
  const cases: Array<{
    name: string;
    englishLiteral: string;
    run: (ctx: MiningContext) => { success: boolean; output: string };
  }> = [
    {
      name: 'drill_plan grid — invalid rows/cols',
      englishLiteral: 'Invalid drill grid: rows and cols must be positive whole numbers.',
      run: (ctx) => drillPlanCommand(ctx, ['grid'], { rows: '0', cols: '3', spacing: '3', depth: '8' }),
    },
    {
      name: 'build_ramp — invalid length',
      englishLiteral: 'Invalid ramp length: length must be a finite positive number.',
      run: (ctx) => buildRampCommand(ctx, [], { origin: '5,5', direction: 'south', length: '0' }),
    },
    {
      name: 'survey — invalid coordinates',
      englishLiteral: 'Invalid coordinates: x and z must be integers.',
      run: (ctx) => surveyCommand(ctx, ['seismic'], { x: 'abc', z: '10' }),
    },
    {
      name: 'survey — no available surveyor',
      // makeMiningContext() staffs the site via STARTING_SITE_STAFFED_COMPOSITION
      // (balance.ts), which carries no 'geology' qualification — so a plain
      // staffed context always hits the no_surveyor branch here.
      englishLiteral: 'No available surveyor. Hire an employee with geology qualification.',
      run: (ctx) => surveyCommand(ctx, ['seismic'], { x: '10', z: '10' }),
    },
  ];

  for (const { name, englishLiteral, run } of cases) {
    it(`${name} — matches the exact English literal by default`, () => {
      const ctx = makeMiningContext();
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).toBe(englishLiteral);
    });

    it(`${name} — differs from the English literal under locale fr`, () => {
      const ctx = makeMiningContext();
      setLocale('fr');
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).not.toBe(englishLiteral);
    });
  }
});

describe('mining.ts #797 survey failed (runSurvey mocked past no_surveyor/insufficient_funds) — English literal + fr divergence', () => {
  const SURVEY_FAILED_EN = 'Survey failed.';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches the exact English literal by default', () => {
    const ctx = makeMiningContext();
    vi.spyOn(SurveyCalcModule, 'runSurvey').mockReturnValue({ success: false });

    const result = surveyCommand(ctx, ['seismic'], { x: '10', z: '10' });

    expect(result.success).toBe(false);
    expect(result.output).toBe(SURVEY_FAILED_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeMiningContext();
    vi.spyOn(SurveyCalcModule, 'runSurvey').mockReturnValue({ success: false });
    setLocale('fr');

    const result = surveyCommand(ctx, ['seismic'], { x: '10', z: '10' });

    expect(result.success).toBe(false);
    expect(result.output).not.toBe(SURVEY_FAILED_EN);
  });
});

describe('mining.ts #797 blast execution failed (executeBlast mocked to null) — English literal + fr divergence', () => {
  const BLAST_EXECUTION_FAILED_EN = 'Blast execution failed.';

  function makeChargedPlan(ctx: MiningContext): void {
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches the exact English literal by default', () => {
    const ctx = makeMiningContext();
    makeChargedPlan(ctx);
    vi.spyOn(BlastExecutionModule, 'executeBlast').mockReturnValue(null);

    const result = blastCommand(ctx, [], {});

    expect(result.success).toBe(false);
    expect(result.output).toBe(BLAST_EXECUTION_FAILED_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeMiningContext();
    makeChargedPlan(ctx);
    vi.spyOn(BlastExecutionModule, 'executeBlast').mockReturnValue(null);
    setLocale('fr');

    const result = blastCommand(ctx, [], {});

    expect(result.success).toBe(false);
    expect(result.output).not.toBe(BLAST_EXECUTION_FAILED_EN);
  });
});

describe('mining.ts #797 blast_plan validate success message — English literal + fr divergence', () => {
  const BLAST_PLAN_VALID_EN = 'Plan is valid and ready to blast.';

  function makeFullPlan(ctx: MiningContext): void {
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });
  }

  it('matches the exact English literal by default', () => {
    const ctx = makeMiningContext();
    makeFullPlan(ctx);

    const result = blastPlanCommand(ctx, ['validate'], {});

    expect(result.success).toBe(true);
    expect(result.output).toBe(BLAST_PLAN_VALID_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeMiningContext();
    makeFullPlan(ctx);
    setLocale('fr');

    const result = blastPlanCommand(ctx, ['validate'], {});

    expect(result.success).toBe(true);
    expect(result.output).not.toBe(BLAST_PLAN_VALID_EN);
  });
});
