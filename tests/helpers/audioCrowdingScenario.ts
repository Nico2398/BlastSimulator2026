// BlastSimulator2026 — Playing a scenario definition through the crowding harness
// A scenario is a script of console commands. Played here as a person would: commands one after the other
// with a short pause, `tick N` and `wait_until` as real time passing at the chosen game speed (the harness
// ticks once per real second), a pending event answered after a reaction time. Which commands run, in which
// order, comes from the definition; how long things take comes from the game.

import { serializeGameState } from '../../src/console-api.js';
import { findWaitUntilAction } from '../../scripts/shared/command-runner.js';
import { loadScenarioDef, resolveRepeatCount, SCENARIO_DIR } from '../../scripts/shared/scenario-utils.js';
import type { ScenarioStepDef } from '../../scripts/shared/scenario-types.js';
import { resetCampaignProfile } from '../../src/persistence/CampaignProfile.js';
import { CrowdSim, type CrowdSimOptions } from './audioCrowding.js';

/** Commands that are tooling (a JSON dump), not something a player does. */
const TOOLING_VERBS = new Set(['state']);

interface ScenarioPlayOptions extends CrowdSimOptions {
  /** Stop once this many real seconds of play have passed (keeps tests fast); the rest of the script is skipped. */
  readonly maxRealS?: number;
}

function ticksOf(command: string): number | null {
  const [verb, count] = command.trim().split(/\s+/);
  return verb === 'tick' ? Math.max(1, parseInt(count ?? '1', 10) || 1) : null;
}

/** Steps the browser run performs only when the control is on screen (`clickIfPresent`), or whose outcome may vary. */
function isOptional(step: ScenarioStepDef): boolean {
  return step.commandOutcome === 'either' || (step.interaction ?? []).some(action => action.type === 'clickIfPresent');
}

function isAnsweringNothing(sim: CrowdSim, command: string): boolean {
  const [verb, sub] = command.trim().split(/\s+/);
  return verb === 'event' && sub === 'choose' && !sim.state?.events.pendingEvent;
}

/** One step of the script; false when the real-time budget is spent. */
function playStep(sim: CrowdSim, step: ScenarioStepDef, maxRealS: number): boolean {
  if (step.interactionOnly) return true;
  if (sim.realS >= maxRealS) return false;
  const waitUntil = findWaitUntilAction(step);
  if (waitUntil) {
    sim.waitUntil(() => {
      const dump = serializeGameState(sim.engine.ctx) as Record<string, unknown> | null;
      return dump !== null && dump[waitUntil.field] === waitUntil.equals;
    }, waitUntil.maxTicks);
    return true;
  }
  for (let i = 0; i < resolveRepeatCount(step); i++) {
    const ticks = ticksOf(step.command);
    const verb = step.command.trim().split(/\s+/)[0] ?? '';
    if (ticks !== null) {
      sim.waitTicks(ticks);
    } else if (verb === 'time' && step.command.includes('speed')) {
      sim.chooseSpeed();
    } else if (isAnsweringNothing(sim, step.command)) {
      // A player cannot click an event dialog that is not on screen.
    } else if (TOOLING_VERBS.has(verb)) {
      sim.command(step.command, 0);
    } else {
      const startsGame = verb === 'new_game' || verb === 'campaign' || verb === 'sandbox';
      sim.command(step.command, undefined, isOptional(step));
      if (startsGame) sim.chooseSpeed();
    }
  }
  return true;
}

/** Play a scenario definition from its first step. Returns the sim, ready to be measured. */
export function playScenario(name: string, options: ScenarioPlayOptions): CrowdSim {
  const sim = new CrowdSim(options);
  // The campaign profile outlives one game; start each play from a clean one like the scenario runners do.
  resetCampaignProfile(sim.engine.ctx.campaignProfile);
  const maxRealS = options.maxRealS ?? Infinity;
  for (const step of loadScenarioDef(name, SCENARIO_DIR).steps) {
    // Once the level is over there is an end screen, not a mine to click on.
    if (sim.state?.levelEnded) break;
    if (!playStep(sim, step, maxRealS)) break;
  }
  return sim;
}

/** A started campaign level that nobody touches: the game runs at 1x for `seconds` real seconds. */
export function playIdle(seconds: number, options: CrowdSimOptions & { readonly levelId?: string }): CrowdSim {
  const sim = new CrowdSim({ ...options, afk: options.afk ?? true });
  resetCampaignProfile(sim.engine.ctx.campaignProfile);
  sim.command(`campaign start level:${options.levelId ?? 'dusty_hollow'}`);
  sim.chooseSpeed();
  sim.command('time resume');
  sim.seconds(seconds);
  return sim;
}
