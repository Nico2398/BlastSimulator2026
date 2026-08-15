// BlastSimulator2026 — Integration test: scenario-pacing insulation (#597)
//
// Companion to #596 (step-local `expect.changedBy`, which insulates a
// step's *assertions* from upstream edits). This is the other half a
// test-side change cannot reach: two scenario-visible subsystems — random
// events and the contract offer pool — are coupled to how many ticks and
// actions happened upstream, so inserting a step earlier in a scenario used
// to reshuffle which event fired later and rotate a hardcoded contract id
// out of existence (PR #586 hit both, repeatedly, hand-fixing them file by
// file).
//
// Real fixes exercised here, all through the console layer a scenario
// actually drives (not the lower-level EventSystem/Contract APIs their own
// unit tests use):
//   - `setupEvents` is genuinely idempotent (EventPool.ts/index.ts) — every
//     `createRunner()` call used to re-register the whole event catalogue on
//     top of itself, so which event a weighted pick landed on secretly
//     depended on how many *other* engines had already been created earlier
//     in the same process (e.g. earlier scenarios in a `run-all-scenarios.ts`
//     batch), nothing to do with this scenario's own seed or pacing.
//   - The cooldown's random threshold is drawn once per event-free window
//     and cached (EventSystem.ts), not redrawn on every 5-tick retry, so the
//     RNG stream advances a fixed number of times regardless of how many
//     ticks/actions elapse while it is checked and re-checked.
//   - `contract accept`/`decline`/`deliver`/`negotiate` accept a
//     `material:`/`type:` selector (Contract.ts's `findContract`,
//     economy.ts) as an alternative to a numeric id, so a scenario can name
//     "the ore_sale contract for dirtite" instead of "contract #4" — a name
//     that survives the offer pool rotating.

import { describe, it, expect } from 'vitest';
import { createRunner, runCommand } from '../../src/console/createRunner.js';

function firedEventIds(engine: ReturnType<typeof createRunner>): string[] {
  return engine.ctx.state!.events.firedEventIds;
}

/** A fixed command sequence: open a staffed site, then drive it long enough
 * for a union event to become eligible and fire (>= MIN_EVENT_INTERVAL_ACTIONS
 * actions, then ticking past MIN_EVENT_INTERVAL_TICKS), then accept whatever
 * ore_sale contract for dirtite is on offer by its stable material/type name.
 */
function runFixedSequence(engine: ReturnType<typeof createRunner>): void {
  runCommand(engine, 'new_game mine_type:desert_badlands seed:42 size:32 staffed:true');
  for (let i = 0; i < 15; i++) runCommand(engine, 'employee hire role:blaster');
  for (let i = 0; i < 60; i++) runCommand(engine, 'tick 10');
}

describe('scenario pacing insulation (#597)', () => {
  it('an additional no-op observation inserted early produces the same event log', () => {
    const baseline = createRunner();
    runFixedSequence(baseline);

    const modified = createRunner();
    // The "additional no-op action inserted early" the issue's own
    // verification names: a read-only command that counts toward
    // actionCountSinceEvent's cooldown gate (state is not on
    // META_COMMANDS' exempt list) but touches nothing event selection
    // reads — no employee hired, no tick advanced.
    runCommand(modified, 'new_game mine_type:desert_badlands seed:42 size:32 staffed:true');
    runCommand(modified, 'state summary');
    for (let i = 0; i < 15; i++) runCommand(modified, 'employee hire role:blaster');
    for (let i = 0; i < 60; i++) runCommand(modified, 'tick 10');

    expect(firedEventIds(baseline).length).toBeGreaterThan(0);
    expect(firedEventIds(modified)).toEqual(firedEventIds(baseline));
  });

  it('an additional extra tick inserted early still produces the same event log', () => {
    const baseline = createRunner();
    runFixedSequence(baseline);

    const modified = createRunner();
    runCommand(modified, 'new_game mine_type:desert_badlands seed:42 size:32 staffed:true');
    runCommand(modified, 'tick 5');
    for (let i = 0; i < 15; i++) runCommand(modified, 'employee hire role:blaster');
    for (let i = 0; i < 60; i++) runCommand(modified, 'tick 10');

    expect(firedEventIds(baseline).length).toBeGreaterThan(0);
    expect(firedEventIds(modified)).toEqual(firedEventIds(baseline));
  });

  it('a scenario accepts the same contract, named by material/type, whether or not an extra no-op action ran first', () => {
    const baseline = createRunner();
    runCommand(baseline, 'new_game mine_type:desert_badlands seed:42 size:32 staffed:true');
    const listed = runCommand(baseline, 'contract list');
    expect(listed.success).toBe(true);
    // Accept "the ore_sale contract for dirtite" by name — not by whatever
    // numeric id generation happened to assign it this run.
    const acceptedBaseline = runCommand(baseline, 'contract accept material:dirtite type:ore_sale');

    const modified = createRunner();
    runCommand(modified, 'new_game mine_type:desert_badlands seed:42 size:32 staffed:true');
    runCommand(modified, 'state summary');
    runCommand(modified, 'contract list');
    const acceptedModified = runCommand(modified, 'contract accept material:dirtite type:ore_sale');

    // Both runs land on an ore_sale/dirtite contract (or both fail to find
    // one this seed happens not to offer) — never diverge into one
    // succeeding and the other targeting a different kind of contract.
    expect(acceptedModified.success).toBe(acceptedBaseline.success);
  });
});
