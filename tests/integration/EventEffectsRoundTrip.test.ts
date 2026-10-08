import { describe, it, expect } from 'vitest';
import { createRunner, runCommand } from '../../src/console/createRunner.js';
import { serialize, deserialize } from '../../src/core/state/SaveLoad.js';
import { createGame, SAVE_VERSION } from '../../src/core/state/GameState.js';
import { addModifier, workRate } from '../../src/core/events/ActiveModifiers.js';
import { t } from '../../src/core/i18n/I18n.js';
import { mod } from '../helpers/eventEffectWorld.js';

function freshEngine() {
  const engine = createRunner();
  runCommand(engine, 'new_game mine_type:desert seed:42 size:32');
  return engine;
}

describe('event effects: save/load (#1414)', () => {
  it('SAVE_VERSION is at least 35', () => {
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(35);
  });

  it('modifiers and nextModifierId round-trip through serialize/deserialize', () => {
    const state = createGame({ seed: 42 });
    state.events.nextModifierId = 1;
    const id = addModifier(state.events.activeModifiers, mod({ kind: 'work_stoppage', endTick: 77 }), state.events.nextModifierId++);
    const restored = deserialize(serialize(state));
    expect(restored.events.activeModifiers).toEqual(state.events.activeModifiers);
    expect(restored.events.nextModifierId).toBe(id + 1);
  });

  it('a v34 save migrates to the current version with an empty ledger', () => {
    const state = createGame({ seed: 42 });
    const obj = JSON.parse(serialize(state)) as Record<string, any>;
    obj['version'] = 34;
    delete obj['events'].activeModifiers;
    delete obj['events'].nextModifierId;
    const restored = deserialize(JSON.stringify(obj));
    expect(restored.version).toBe(SAVE_VERSION);
    expect(restored.events.activeModifiers).toEqual([]);
    expect(restored.events.nextModifierId).toBe(1);
  });

  it('migration keeps modifiers an already-v35 save carries', () => {
    const state = createGame({ seed: 42 });
    addModifier(state.events.activeModifiers, mod({ kind: 'blast_ban' }), 1);
    state.events.nextModifierId = 2;
    const restored = deserialize(serialize(state));
    expect(restored.events.activeModifiers).toHaveLength(1);
    expect(restored.events.nextModifierId).toBe(2);
  });
});

describe('event effects: console flow (#1414)', () => {
  it('choosing "let them strike" raises a stoppage, stops tasks and survives save/load', () => {
    const engine = freshEngine();
    runCommand(engine, 'event fire union_strike_threat');
    const r = runCommand(engine, 'event choose 1');
    expect(r.success).toBe(true);
    const state = engine.ctx.state!;
    expect(workRate(state.events.activeModifiers, 'driller', state.tickCount)).toBe(0);
    const restored = deserialize(serialize(state));
    expect(workRate(restored.events.activeModifiers, 'driller', state.tickCount)).toBe(0);
  });

  it('console output after choosing never prints a raw effectTag', () => {
    const engine = freshEngine();
    runCommand(engine, 'event fire union_strike_threat');
    const r = runCommand(engine, 'event choose 1');
    expect(r.output).not.toMatch(/full_strike/);
    const lines = r.output.split('\n').map(l => l.replace(/^\s*•\s*/, '').trim());
    expect(lines).not.toContain('full_strike');
  });

  it('expired modifiers are pruned as ticks pass', () => {
    const engine = freshEngine();
    const state = engine.ctx.state!;
    addModifier(state.events.activeModifiers, mod({ kind: 'blast_ban', startTick: 0, endTick: 3 }), state.events.nextModifierId++);
    runCommand(engine, 'time resume');
    runCommand(engine, 'tick 6');
    expect(state.events.activeModifiers.some(m => m.kind === 'blast_ban')).toBe(false);
  });

  it('blast detonate is refused while a blast_ban is active, with its own message', () => {
    const engine = freshEngine();
    const state = engine.ctx.state!;
    const baseline = runCommand(engine, 'blast detonate');
    addModifier(state.events.activeModifiers, mod({ kind: 'blast_ban', startTick: state.tickCount, endTick: state.tickCount + 24 }), state.events.nextModifierId++);
    const banned = runCommand(engine, 'blast detonate');
    expect(banned.success).toBe(false);
    expect(banned.output).not.toBe(baseline.output);
    expect(banned.output).not.toBe(t('mining.blast.no_charged_holes'));
  });

  it('a blast_ban also refuses an immediate blast', () => {
    const engine = freshEngine();
    const state = engine.ctx.state!;
    addModifier(state.events.activeModifiers, mod({ kind: 'blast_ban', startTick: state.tickCount, endTick: state.tickCount + 24 }), state.events.nextModifierId++);
    const r = runCommand(engine, 'blast');
    expect(r.success).toBe(false);
    expect(r.output).not.toBe(t('mining.blast.no_charged_holes'));
  });
});
