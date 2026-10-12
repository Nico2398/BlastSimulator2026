// BlastSimulator2026 — Console command to sound
// Table coverage is checked against the REAL command registry, so a newly registered verb forces a
// decision (map it or list it as silent). Behaviour is checked on hand-built commands and on commands
// run through the real runner.

import { describe, it, expect, beforeEach } from 'vitest';
import { commandCue, type CommandCueContext, type ParsedCommandLike } from '../../../../src/audio/ui/commandCues.js';
import { COMMAND_CUES, SILENT_COMMANDS } from '../../../../src/audio/ui/commandCueTable.js';
import { SOUND_CATALOG } from '../../../../src/audio/SoundCatalog.js';
import { UI_COMMAND_CONFIG } from '../../../../src/core/config/audio/ui.js';
import { createRunner } from '../../../../src/console/createRunner.js';
import { parseCommand } from '../../../../src/console/ConsoleRunner.js';
import { getAllBuildingTypes } from '../../../../src/core/entities/Building.js';
import { RecordingPlayer } from '../../../helpers/audioPlayerFakes.js';

let player: RecordingPlayer;

beforeEach(() => {
  player = new RecordingPlayer();
});

function cue(line: string, success = true, ctx?: CommandCueContext): void {
  commandCue(player, parseCommand(line), success, ctx);
}

/** Verbs the runner dispatches: its handler map, which includes hidden aliases. */
function registeredVerbs(): string[] {
  const handlers = (createRunner().runner as unknown as { handlers: unknown }).handlers;
  expect(handlers).toBeInstanceOf(Map);
  return [...(handlers as Map<string, unknown>).keys()];
}

describe('registry coverage', () => {
  it('has a decision for every registered console verb', () => {
    const undecided = registeredVerbs().filter(v => !(v in COMMAND_CUES) && !(v in SILENT_COMMANDS));
    expect(undecided, `new console verbs need a sound decision in commandCueTable.ts: ${undecided.join(', ')}`).toEqual([]);
  });

  it('never lists a verb as both mapped and silent', () => {
    expect(Object.keys(COMMAND_CUES).filter(v => v in SILENT_COMMANDS)).toEqual([]);
  });

  it('names only registered verbs (plus the runner-handled help)', () => {
    const known = new Set([...registeredVerbs(), 'help']);
    const stale = [...Object.keys(COMMAND_CUES), ...Object.keys(SILENT_COMMANDS)].filter(v => !known.has(v));
    expect(stale).toEqual([]);
  });

  it('gives every silent verb a reason', () => {
    for (const [verb, reason] of Object.entries(SILENT_COMMANDS)) expect(reason.length, verb).toBeGreaterThan(10);
  });

  it('only names catalog sounds', () => {
    const ids = new Set<string>();
    for (const verb of Object.values(COMMAND_CUES)) {
      for (const rule of [verb.otherwise, ...Object.values(verb.subs ?? {})]) {
        if (rule?.cue !== undefined) ids.add(rule.cue);
        if (rule?.then !== undefined) ids.add(rule.then.cue);
      }
    }
    expect(ids.size).toBeGreaterThan(10);
    for (const id of ids) expect(SOUND_CATALOG, id).toHaveProperty(id);
  });
});

describe('success cues', () => {
  it.each([
    ['employee hire role:driller', 'hire'],
    ['employee fire 3', 'fire'],
    ['employee raise 3', 'coins_small'],
    ['employee dispatch 3 x:1 z:2', 'order_queued'],
    ['employee train 3', 'order_queued'],
    ['employee assign_skill 3', 'ui_confirm'],
    ['employee cancel 4', 'ui_back'],
    ['vehicle haul 2', 'order_queued'],
    ['vehicle break 2', 'order_queued'],
    ['vehicle reposition 2 x:1 z:2', 'order_queued'],
    ['vehicle driver 2', 'ui_confirm'],
    ['build destroy 4', 'order_queued'],
    ['build upgrade 4', 'purchase'],
    ['build move 4', 'order_queued'],
    ['drill_plan grid x:10 z:10 rows:6 cols:10', 'order_queued'],
    ['drill_plan add 1,2', 'order_queued'],
    ['drill_plan clear', 'ui_back'],
    ['charge hole:* explosive:anfo', 'order_queued'],
    ['survey seismic x:1 z:2', 'order_queued'],
    ['level_ground minX:0 maxX:4 minZ:0 maxZ:4', 'order_queued'],
    ['level_ground cancel 3', 'ui_back'],
    ['build_ramp origin:1,2 direction:south', 'order_queued'],
    ['build_ramp cancel 1', 'ui_back'],
    ['widen_ramp id:1 width:5', 'order_queued'],
    ['research queue type:office tier:2', 'order_queued'],
    ['drain_hole hole:*', 'order_queued'],
    ['install_tubing hole:3', 'order_queued'],
    ['zone clear x1:0 z1:0 x2:4 z2:4', 'order_queued'],
    ['buy tubing amount:10', 'purchase'],
    ['buy_software', 'purchase'],
    ['contract accept 2', 'ui_confirm'],
    ['contract decline 2', 'ui_back'],
    ['contract hold 2', 'ui_toggle_off'],
    ['contract release 2', 'ui_toggle_on'],
    ['set_policy mode:shift_8h', 'ui_tab'],
    ['event choose 0', 'ui_confirm'],
    ['corrupt target:judge cost:50000', 'coins_big'],
    ['mafia frame', 'ui_confirm'],
    ['time pause', 'ui_toggle_off'],
    ['time resume', 'ui_toggle_on'],
    ['time speed 4', 'ui_tab'],
    ['time speed:8', 'ui_tab'],
    ['save', 'ui_confirm'],
    ['load slot:a', 'ui_confirm'],
    ['blast_plan save a', 'ui_confirm'],
  ])('%s plays %s once', (line, id) => {
    cue(line);
    expect(player.ids).toEqual([id]);
  });

  it('follows a vehicle upgrade with the engine start, delayed (the director only sees new vehicles)', () => {
    cue('vehicle upgrade 2');
    expect(player.calls).toEqual([
      { id: 'purchase', opts: undefined },
      { id: 'vehicle_start', opts: { delayS: UI_COMMAND_CONFIG.vehicleStartDelayS } },
    ]);
  });

  it('leaves the sounds the game director owns to it: a bought vehicle starts, a scrap thuds, a delivery pays', () => {
    cue('vehicle buy debris_hauler tier:1');
    cue('vehicle scrap 2');
    cue('contract deliver 2');
    expect(player.calls).toEqual([{ id: 'purchase', opts: undefined }]);
  });

  it.each(['vehicle scrap 2', 'contract deliver 2'])('still denies a refused "%s"', line => {
    cue(line, false);
    expect(player.ids).toEqual(['ui_denied']);
  });

  it.each(['build site_office', 'build site_office at:20,-4.5'])(
    'confirms a placement "%s" as interface feedback, never at a world point',
    line => {
      cue(line);
      expect(player.calls).toEqual([{ id: 'build_placed', opts: undefined }]);
    },
  );

  it('is one cue for a whole drill grid, however many holes', () => {
    cue('drill_plan grid x:0 z:0 rows:60 cols:1');
    expect(player.calls.length).toBe(1);
  });
});

describe('silence', () => {
  it.each([
    'tick', 'tick 20', 'state', 'state summary', 'finances', 'scores', 'needs', 'stats', 'weather advance',
    'employee list', 'employee candidates', 'vehicle list', 'build list', 'build types', 'contract list',
    'contract status', 'research status', 'drill_plan show', 'charge show', 'survey show', 'blast status',
    'blast_plan list', 'blast_plan validate', 'time', 'time status', 'zone status', 'event status',
    'event fire x', 'mafia status', 'new_game seed:1', 'campaign start level:a', 'sandbox start',
    'tutorial_start', 'preview energy', 'inspect 1,2,3', 'help', 'nonsense', '',
  ])('plays nothing for "%s" on success or on failure', line => {
    cue(line, true);
    cue(line, false);
    expect(player.calls).toEqual([]);
  });

  it('does not treat object prototype names as verbs or sub-commands', () => {
    cue('constructor');
    cue('toString', false);
    cue('employee constructor', false);
    expect(player.calls).toEqual([]);
  });

  it('plays nothing for scripted commands, even refused ones', () => {
    cue('employee hire role:driller', true, { scripted: true });
    cue('employee hire role:driller', false, { scripted: true });
    expect(player.calls).toEqual([]);
  });

  it('plays for an explicit non-scripted context', () => {
    cue('save', true, { scripted: false });
    expect(player.ids).toEqual(['ui_confirm']);
  });
});

describe('refusals', () => {
  it.each([
    'employee hire role:driller', 'employee fire 99', 'vehicle buy debris_hauler tier:1', 'build site_office at:1,2',
    'build destroy 7', 'drill_plan grid x:0 z:0', 'charge hole:1', 'survey seismic', 'contract accept 9', 'save',
    'time speed 4', 'research queue type:x', 'blast', 'blast detonate', 'blast cancel', 'level_ground cancel x',
    'event choose 7',
  ])('plays ui_denied once for refused "%s"', line => {
    cue(line, false);
    expect(player.calls).toEqual([{ id: 'ui_denied', opts: undefined }]);
  });

  it('is silent for an accepted blast command, which the blast director voices', () => {
    cue('blast');
    cue('blast detonate');
    expect(player.calls).toEqual([]);
  });

  it('plays nothing extra for a refused vehicle purchase', () => {
    cue('vehicle buy debris_hauler', false);
    expect(player.ids).toEqual(['ui_denied']);
  });
});

describe('fault tolerance', () => {
  it('never throws when the player does', () => {
    player.throwOnPlay = true;
    const parsed: ParsedCommandLike = { command: 'vehicle', args: ['buy'], namedArgs: {} };
    expect(() => commandCue(player, parsed, true)).not.toThrow();
    expect(() => commandCue(player, parsed, false)).not.toThrow();
  });
});

describe('with the real runner', () => {
  it('voices real commands the way the table promises, refusals included', () => {
    const { runner } = createRunner();
    const outcomes: Array<[string, boolean]> = [];
    const run = (line: string): void => {
      const result = runner.run(line);
      outcomes.push([line, result.success]);
      commandCue(player, parseCommand(line), result.success);
    };
    const building = getAllBuildingTypes()[0]!;

    run('new_game mine_type:desert seed:42');
    run(`build ${building} at:30,30`);
    run('time pause');
    run('time speed 4');
    run('time resume');
    run('employee hire role:driller');
    run('employee hire role:astronaut');
    run('employee list');
    run('vehicle buy debris_hauler tier:1');
    run('vehicle buy spaceship');
    run('drill_plan grid x:10 z:10 rows:2 cols:2 spacing:3');
    run('tick');
    run('blast');
    run('nonsense');

    expect(outcomes.filter(([, ok]) => !ok).map(([line]) => line))
      .toEqual(expect.arrayContaining(['employee hire role:astronaut', 'vehicle buy spaceship', 'blast', 'nonsense']));
    const accepted = (line: string): boolean => outcomes.some(([l, ok]) => l === line && ok);
    expect(accepted('employee hire role:driller')).toBe(true);
    expect(accepted('vehicle buy debris_hauler tier:1')).toBe(true);
    expect(accepted('drill_plan grid x:10 z:10 rows:2 cols:2 spacing:3')).toBe(true);
    expect(accepted(`build ${building} at:30,30`)).toBe(true);
    expect(player.calls[0]).toEqual({ id: 'build_placed', opts: undefined });
    expect(player.ids).toEqual([
      'build_placed',
      'ui_toggle_off', 'ui_tab', 'ui_toggle_on',
      'hire', 'ui_denied',
      'purchase', 'ui_denied',
      'order_queued',
      'ui_denied',
    ]);
  });
});
