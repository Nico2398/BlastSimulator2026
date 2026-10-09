// #1411 — runTick wires smuggling-exposed and mafia-exposed consequences and exposure decay.
import { describe, it, expect, beforeEach } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { runTick } from '../../../src/core/engine/TickPipeline.js';
import { clearEvents } from '../../../src/core/events/EventPool.js';
import { addIncome } from '../../../src/core/economy/Finance.js';
import { setSmugglingVolume } from '../../../src/core/events/MafiaActions.js';
import { bookTaxAuditIncome } from '../../../src/core/events/TaxAudit.js';
import {
  BANKRUPTCY_THRESHOLD,
  INVESTIGATION_FOLLOWUP_EVENT_ID,
  EXPOSURE_CLEAN_GRACE_TICKS,
  EXPOSURE_DECAY_PER_TICK,
} from '../../../src/core/config/balance.js';

const MAX_TICKS = 400;

function tick(state: GameState, emitter: EventEmitter): void {
  runTick(state, null, new Random(state.seed + state.tickCount), emitter, { checkInvariants: false });
}

function tickUntil(state: GameState, emitter: EventEmitter, done: () => boolean): void {
  for (let i = 0; i < MAX_TICKS && !done(); i++) tick(state, emitter);
  if (!done()) throw new Error(`condition not met within ${MAX_TICKS} ticks`);
}

/** Books heavy 50 % smuggling onto the open books each tick until the tax office audits. */
function tickUntilAudit(state: GameState, emitter: EventEmitter): void {
  for (let i = 0; i < 40_000 && state.taxAudit.auditsCount === 0; i++) {
    bookTaxAuditIncome(state.taxAudit, state.tickCount, 40_000, 40_000);
    tick(state, emitter);
  }
  if (state.taxAudit.auditsCount === 0) throw new Error('no tax audit within 40000 ticks');
}

describe('runTick mafia consequences (#1411)', () => {
  beforeEach(() => clearEvents());

  it('smuggling no longer raises exposure per tick (#1409)', () => {
    const state = createGame({ seed: 42 });
    state.tickCount = 200;
    addIncome(state.finances, 7_200, 'sales', 'Ore sale', 200);
    setSmugglingVolume(state.mafia, 1);
    const emitter = new EventEmitter();
    for (let i = 0; i < 100; i++) tick(state, emitter);
    expect(state.mafia.exposureRisk).toBe(0);
    expect(state.arrest.arrested).toBe(false);
  });

  it('a tax-audit conviction adds no exposure (#1409)', () => {
    const state = createGame({ seed: 42 });
    state.cash = 20_000;
    const emitter = new EventEmitter();
    tickUntilAudit(state, emitter);
    expect(state.taxAudit.convictions).toBeGreaterThan(0);
    expect(state.mafia.exposureRisk).toBe(0);
    expect(state.arrest.arrested).toBe(false);
  });

  it('a regularisation larger than cash is partly deferred, never bankrupting by itself (#1409)', () => {
    const state = createGame({ seed: 42 });
    state.cash = 20_000;
    const emitter = new EventEmitter();
    tickUntilAudit(state, emitter);
    // 40 000 smuggled per tick over hundreds of ticks => owed is orders of magnitude above cash.
    expect(state.taxAudit.debt).toBeGreaterThan(0);
    expect(state.cash).toBeGreaterThanOrEqual(BANKRUPTCY_THRESHOLD - 1);
    expect(state.levelEndReason).not.toBe('bankruptcy');
    expect(state.bankruptcy.bankrupt).toBe(false);
  });

  it('mafia exposed: investigation queued once-per-botch and event emitted', () => {
    const state = createGame({ seed: 7 });
    state.mafia.exposureRisk = 0.9;
    const emitter = new EventEmitter();
    let exposed = 0;
    emitter.on('mafia:exposed', () => { exposed++; });

    tickUntil(state, emitter, () => exposed > 0);

    expect(state.events.followUpQueue).toContain(INVESTIGATION_FOLLOWUP_EVENT_ID);
  });

  it('decays exposure after the clean grace period', () => {
    const state = createGame({ seed: 3 });
    state.mafia.exposureRisk = 0.2; // below the 0.3 exposure-check gate
    state.mafia.lastActivityTick = 0;
    state.tickCount = EXPOSURE_CLEAN_GRACE_TICKS + 1;
    tick(state, new EventEmitter());
    expect(state.mafia.exposureRisk).toBeCloseTo(0.2 - EXPOSURE_DECAY_PER_TICK, 10);
  });
});
