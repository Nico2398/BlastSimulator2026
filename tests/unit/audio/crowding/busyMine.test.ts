// BlastSimulator2026 — A busy mine sounds alive, not crowded
// The owner's bar, measured against the real game: scripted scenarios (hiring, vehicles, buildings,
// drilling, charging, a blast and the clean-up, weather, events) are played through src/console with the
// real GameAudioDirector and commandCue attached, at 1x and at 8x, and every sound the engine would be asked
// to play is counted. Each threshold below is the measured value of the run it guards with headroom, with the
// measurement in the comment. Nobody can listen here: these numbers say how MANY sounds, not how they sound.
// "Sounds" means what the director and the command cues ask for: clicks, hover, selection and toasts (the
// interface layer) are not simulated by the harness and not counted.

import { beforeAll, describe, expect, it } from 'vitest';
import type { CrowdSim, PlayRecord } from '../../../helpers/audioCrowding.js';
import { isBlastSound, peakIn, summarize } from '../../../helpers/audioCrowdingStats.js';
import { scenarioRun } from './runs.js';
import { expectWorldWithinBudget, worldPlays } from './worldBudget.js';

/** Hiring, vehicles, a building, drilling, charging, three blasts, dispatch; weather and events happen on their own. */
const BUSIEST = 'vibration-budget';
const SCENARIOS = [BUSIEST, 'survey-then-blast-playthrough', 'rock-fragmenter-breaking', 'weather-flood'] as const;

const RUN_TIMEOUT_MS = 90_000;
const SECONDS_PER_MINUTE = 60;

beforeAll(() => {
  for (const name of SCENARIOS) {
    scenarioRun(name, 1);
    scenarioRun(name, 8);
  }
}, RUN_TIMEOUT_MS);

const minutes = (sim: CrowdSim): number => sim.realS / SECONDS_PER_MINUTE;
const countOf = (plays: readonly PlayRecord[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const p of plays) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
  return counts;
};

describe.each(SCENARIOS)('%s at 1x', (name) => {
  const sim = (): CrowdSim => scenarioRun(name, 1);

  it('stays under 25 sounds a minute, blasts and commands included', () => {
    // Measured 14.9 (vibration-budget), 13.4, 16.3, 19.2 (weather-flood: a short game, so its one blast weighs most).
    expect(summarize(sim().recorder.plays, sim().realS).totalPerMinute).toBeLessThan(25);
  });

  it('plays the world (no blast, no player command) at most 15 times a minute', () => {
    // Measured 8.7, 8.5, 10.2, 10.0.
    expect(worldPlays(sim()).length / minutes(sim())).toBeLessThan(15);
  });

  it('never asks for more than 4 world sounds in a second, 12 in ten, 21 in thirty', () => {
    // Measured worst second 3, ten seconds 9, thirty seconds 16 (rock-fragmenter-breaking).
    expectWorldWithinBudget(sim(), { per1s: 4, per10s: 12, per30s: 21 });
  });

  it('keeps the busiest second, a blast, under 16 sounds and 12 voices at once', () => {
    // Measured 12 sounds in a second (weather-flood's blast), 9 voices at most; the engine caps at 32.
    const stats = summarize(sim().recorder.plays, sim().realS);
    expect(stats.maxPerSecond).toBeLessThanOrEqual(16);
    expect(stats.maxVoices).toBeLessThanOrEqual(12);
  });

  it('asks the engine only for sounds it will admit', () => {
    // Measured: every non-blast request was admitted (cooldowns and voice caps never refused a director cue).
    const asked = sim().recorder.plays.filter(p => !isBlastSound(p.id));
    expect(asked.filter(p => p.accepted).length / asked.length).toBeGreaterThanOrEqual(0.98);
  });

  it('lets the director use the interface bus only for alerts, rewards and acknowledgements', () => {
    const allowed = new Set(['notify_info', 'notify_good', 'notify_warn', 'notify_bad', 'notify_alert', 'event_union', 'event_lawsuit', 'event_mafia', 'event_politics', 'level_up', 'unlock', 'order_done', 'coins_small', 'coins_big', 'cash_till']);
    const interfaceCues = sim().recorder.heard.filter(p => p.source === 'director' && p.bus === 'ui');
    for (const p of interfaceCues) expect(allowed.has(p.id), p.id).toBe(true);
  });

  it('never voices one action twice: no sound comes from both the command cue and the director', () => {
    const byCommand = new Map<number, { command: Set<string>; director: Set<string> }>();
    for (const p of sim().recorder.heard) {
      const entry = byCommand.get(p.commandIndex) ?? { command: new Set<string>(), director: new Set<string>() };
      entry[p.source].add(p.id);
      byCommand.set(p.commandIndex, entry);
    }
    for (const [index, entry] of byCommand) {
      const shared = [...entry.command].filter(id => entry.director.has(id));
      expect(shared, `command ${sim().commands[index - 1]}`).toEqual([]);
      // A command is at most one cue of its own, and the world adds at most one more beside it.
      expect(entry.command.size).toBeLessThanOrEqual(1);
      // The first command after a shot is when its aftermath (a rig the blast scrapped, and the alert about it)
      // reaches the speakers: those cues belong to the blast, not to the command that happened to follow it.
      const firesBlast = (cmd: string | undefined): boolean => cmd === 'blast' || /^blast detonate/.test(cmd ?? '');
      if (firesBlast(sim().commands[index - 2])) continue;
      if (entry.command.size > 0) expect([...entry.director].filter(id => !isBlastSound(id)).length).toBeLessThanOrEqual(1);
    }
  });

  it('plays one blast as one timeline: five main layers, at most 22 sounds in all', () => {
    // Measured 7 to 17 blast and debris sounds within 15 s of a shot (the cap on simultaneous debris is 10 + 8).
    const plays = sim().recorder.plays;
    const shots = plays.filter(p => p.id === 'blast_snap');
    expect(shots.length).toBeGreaterThan(0);
    for (const layer of ['blast_sub', 'blast_crack', 'blast_boom', 'blast_tail'] as const) {
      expect(plays.filter(p => p.id === layer && p.accepted).length, layer).toBe(shots.length);
    }
    for (const shot of shots) {
      const timeline = plays.filter(p => p.accepted && isBlastSound(p.id) && p.id !== 'blast_beep' && p.startS >= shot.startS - 0.01 && p.startS < shot.startS + 15);
      expect(timeline.length).toBeLessThanOrEqual(22);
    }
  });
});

describe.each(SCENARIOS)('%s at 8x compared with 1x', (name) => {
  const slow = (): CrowdSim => scenarioRun(name, 1);
  const fast = (): CrowdSim => scenarioRun(name, 8);

  it('plays no more sounds in all: the same game in a seventh of the time is not eight times the noise', () => {
    // Measured 8x/1x totals 0.69 (vibration-budget), 0.58, 0.71, 0.75.
    expect(fast().recorder.heard.length).toBeLessThanOrEqual(slow().recorder.heard.length);
  });

  it('plays world sounds at most 4 times as often per real minute', () => {
    // The game runs 6 to 8 times faster in real time; measured world rate ratios 3.0 (vibration-budget), 2.2, 2.7, 2.4.
    const rate = (sim: CrowdSim): number => worldPlays(sim).length / minutes(sim);
    expect(rate(fast()) / rate(slow())).toBeLessThanOrEqual(4);
  });

  it('keeps the world within 1.5 times the 1x peak (plus 2) in any 30 seconds', () => {
    // Measured 30 s peaks 8x vs 1x: 17 vs 13, 15 vs 14, 17 vs 17, 13 vs 14. Before the real-time spacing of
    // collapses, drills and charges a 3400-tick game reached 59 vs 28 (see the audit in the commit message).
    expect(peakIn(worldPlays(fast()), 30)).toBeLessThanOrEqual(Math.ceil(1.5 * peakIn(worldPlays(slow()), 30)) + 2);
  });

  it('plays no kind of sound more than 3 times more often than at 1x', () => {
    // Measured worst difference in one kind of sound: +1 (worker_collapse, event_politics, event_union).
    const slowCounts = countOf(worldPlays(slow()));
    for (const [id, count] of countOf(worldPlays(fast()))) {
      expect(count, id).toBeLessThanOrEqual((slowCounts.get(id) ?? 0) + 3);
    }
  });

  it('asks for the same blast timeline', () => {
    const blasts = (sim: CrowdSim): number => sim.recorder.plays.filter(p => p.id === 'blast_snap').length;
    expect(blasts(fast())).toBe(blasts(slow()));
  });
});
