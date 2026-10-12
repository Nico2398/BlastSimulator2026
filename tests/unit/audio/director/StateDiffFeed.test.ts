import { describe, it, expect } from 'vitest';
import { StateDiffFeed } from '../../../../src/audio/director/StateDiffFeed.js';
import { DIFF_CONFIG } from '../../../../src/core/config/audio/game.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import { addBuilding, advanceTicks, makeHarness, makeState } from './helpers.js';

const none = (): string | undefined => undefined;

function fixture() {
  const h = makeHarness();
  const feed = new StateDiffFeed(h.env, none);
  const state = makeState();
  return { h, feed, state };
}

describe('StateDiffFeed', () => {
  it('only baselines on the first look, however much the world already holds', () => {
    const { h, feed, state } = fixture();
    addBuilding(state, 'living_quarters', 1, 1);
    state.finances.transactions.push({ tick: 0, amount: 90000, type: 'income', category: 'contracts', description: '' });
    state.events.pendingEvent = { eventId: 'x', firedAtTick: 0 };
    expect(feed.observe(state, false).cues).toEqual([]);
    expect(h.player.plays).toHaveLength(0);
    expect(feed.lastTick).toBe(0);
  });

  it('plays the cues of later looks and reports the diff', () => {
    const { h, feed, state } = fixture();
    feed.observe(state, false);
    addBuilding(state, 'living_quarters', 1, 1);
    advanceTicks(state, 1);
    const diff = feed.observe(state, false);
    expect(diff.cues).toHaveLength(1);
    expect(h.player.ids).toEqual(['building_built']);
    expect(feed.lastTick).toBe(1);
  });

  it('keeps the baseline moving while silent, so nothing plays late', () => {
    const { h, feed, state } = fixture();
    feed.observe(state, false);
    addBuilding(state, 'living_quarters', 1, 1);
    const silent = feed.observe(state, true);
    expect(silent.cues).toHaveLength(1);
    expect(h.player.plays).toHaveLength(0);
    feed.observe(state, false);
    expect(h.player.plays).toHaveLength(0);
  });

  it('steps the ambience aside for a pending event', () => {
    const { h, feed, state } = fixture();
    feed.observe(state, false);
    state.events.pendingEvent = { eventId: 'x', firedAtTick: 1 };
    feed.observe(state, false);
    expect(h.player.ids).toEqual(['notify_alert']);
    expect(h.player.ducks).toEqual([{ bus: 'ambient', ...DIFF_CONFIG.eventAlert.duck }]);
  });

  it('does not duck while silent', () => {
    const { h, feed, state } = fixture();
    feed.observe(state, false);
    state.events.pendingEvent = { eventId: 'x', firedAtTick: 1 };
    feed.observe(state, true);
    expect(h.player.ducks).toEqual([]);
  });

  it('forgets: the look after is a baseline again', () => {
    const { h, feed, state } = fixture();
    feed.observe(state, false);
    feed.forget();
    expect(feed.lastTick).toBeNull();
    addBuilding(state, 'living_quarters', 1, 1);
    feed.observe(state, false);
    expect(h.player.plays).toHaveLength(0);
  });

  describe('charge mass of a blast', () => {
    function charged(state: GameState, kg: number): void {
      state.drillHoles.push({ id: `H${state.drillHoles.length}`, x: 0, z: 0, depth: 1, diameter: 0.1 });
      state.chargesByHole[`H${state.drillHoles.length - 1}`] = { explosiveId: 'anfo', amountKg: kg, stemmingM: 1 };
    }

    it('remembers the charge from before the blast cleared it, once', () => {
      const { feed, state } = fixture();
      feed.observe(state, false);
      charged(state, 12);
      charged(state, 8);
      feed.observe(state, false);
      state.drillHoles.length = 0;
      state.chargesByHole = {};
      state.lastBlastReport = {} as unknown as GameState['lastBlastReport'];
      expect(feed.observe(state, false).blastLanded).toBe(true);
      expect(feed.takeBlastChargeKg()).toBe(20);
      expect(feed.takeBlastChargeKg()).toBe(0);
    });

    it('lets go of a charge that was unloaded without a blast', () => {
      const { feed, state } = fixture();
      feed.observe(state, false);
      charged(state, 12);
      feed.observe(state, false);
      state.chargesByHole = {};
      feed.observe(state, false);
      expect(feed.takeBlastChargeKg()).toBe(0);
    });

    it('starts from the charge already loaded when it begins to watch', () => {
      const { feed, state } = fixture();
      charged(state, 5);
      feed.observe(state, false);
      expect(feed.takeBlastChargeKg()).toBe(5);
    });
  });
});
