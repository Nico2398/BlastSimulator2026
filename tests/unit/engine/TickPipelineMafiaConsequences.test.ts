// #1411 — runTick wires smuggling-exposed and mafia-exposed consequences and exposure decay.
import { describe, it, expect, beforeEach } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { runTick } from '../../../src/core/engine/TickPipeline.js';
import { clearEvents } from '../../../src/core/events/EventPool.js';
import {
  SMUGGLING_EXPOSED_FINE,
  SMUGGLING_EXPOSED_EXPOSURE_JUMP,
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

describe('runTick mafia consequences (#1411)', () => {
  beforeEach(() => clearEvents());

  it('smuggling exposed: fine charged, exposure jumps, smuggling stops, event emitted', () => {
    const state = createGame({ seed: 42 });
    state.mafia.exposureRisk = 0.5;
    state.mafia.smugglingActive = true;
    state.mafia.smugglingIncome = 8000;
    const emitter = new EventEmitter();
    const fines: number[] = [];
    emitter.on('mafia:smuggling_exposed', ({ fine }) => fines.push(fine));

    let before = 0;
    tickUntil(state, emitter, () => {
      if (fines.length === 0) before = state.mafia.exposureRisk;
      return fines.length > 0;
    });

    expect(fines).toEqual([SMUGGLING_EXPOSED_FINE]);
    expect(state.mafia.smugglingActive).toBe(false);
    expect(state.mafia.smugglingIncome).toBe(0);
    expect(state.mafia.exposureRisk).toBeGreaterThanOrEqual(before + SMUGGLING_EXPOSED_EXPOSURE_JUMP - 1e-9);
    const fine = state.finances.transactions.find(
      tx => tx.type === 'expense' && tx.category === 'fines' && tx.description === 'Smuggling exposed',
    );
    expect(fine?.amount).toBe(SMUGGLING_EXPOSED_FINE);
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
