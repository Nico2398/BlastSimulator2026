// BlastSimulator2026 — Interface cues for UI chokepoints
// Each entry point maps to one catalog sound; notifications coalesce within a synchronous burst.

import { describe, it, expect, beforeEach } from 'vitest';
import { UiCues, type NotificationSeverity, type SelectionKind, type VolumeChannel } from '../../../../src/audio/ui/UiCues.js';
import { UI_SELECTION_PITCH_CENTS } from '../../../../src/core/config/audio/ui.js';
import { RecordingPlayer } from './recordingPlayer.js';

let player: RecordingPlayer;
let cues: UiCues;
let deferred: Array<() => void>;

function runDeferred(): void {
  const tasks = deferred;
  deferred = [];
  for (const task of tasks) task();
}

beforeEach(() => {
  player = new RecordingPlayer();
  deferred = [];
  cues = new UiCues(player, task => { deferred.push(task); });
});

describe('panelShown', () => {
  it('opens and closes', () => {
    cues.panelShown(true);
    cues.panelShown(false);
    expect(player.ids).toEqual(['ui_open', 'ui_close']);
  });
});

describe('notification', () => {
  it.each<[NotificationSeverity, string]>([
    ['info', 'notify_info'],
    ['positive', 'notify_good'],
    ['warn', 'notify_warn'],
    ['critical', 'notify_bad'],
  ])('plays the %s cue after the burst', (severity, id) => {
    cues.notification(severity);
    expect(player.calls).toEqual([]);
    runDeferred();
    expect(player.ids).toEqual([id]);
  });

  it('collapses a burst into the most severe toast, whatever the arrival order', () => {
    for (const severity of ['info', 'critical', 'positive', 'warn', 'critical'] as const) cues.notification(severity);
    expect(deferred.length).toBe(1);
    runDeferred();
    expect(player.ids).toEqual(['notify_bad']);
  });

  it('keeps the first when later ones are milder', () => {
    cues.notification('warn');
    cues.notification('info');
    runDeferred();
    expect(player.ids).toEqual(['notify_warn']);
  });

  it('starts a fresh burst after a flush', () => {
    cues.notification('critical');
    runDeferred();
    cues.notification('info');
    runDeferred();
    expect(player.ids).toEqual(['notify_bad', 'notify_info']);
  });

  it('defaults to a microtask, which runs after the synchronous burst', async () => {
    const real = new UiCues(player);
    real.notification('info');
    real.notification('warn');
    expect(player.calls).toEqual([]);
    await Promise.resolve();
    expect(player.ids).toEqual(['notify_warn']);
  });
});

describe('entitySelected', () => {
  it('gives each kind its own pitch on the same sound', () => {
    const kinds = Object.keys(UI_SELECTION_PITCH_CENTS) as SelectionKind[];
    for (const kind of kinds) cues.entitySelected(kind);
    expect(player.ids).toEqual(kinds.map(() => 'ui_select'));
    expect(player.calls.map(c => c.opts?.pitchCents)).toEqual(kinds.map(k => UI_SELECTION_PITCH_CENTS[k]));
    expect(new Set(player.calls.map(c => c.opts?.pitchCents)).size).toBe(kinds.length);
  });
});

describe('one-liners', () => {
  it('maps refusals, modals and confirmations', () => {
    cues.placementRefused();
    cues.modalShown();
    cues.confirmAccepted();
    expect(player.ids).toEqual(['ui_invalid', 'ui_modal', 'ui_confirm']);
  });
});

describe('volumeAdjusted', () => {
  it('ticks on the bus the slider controls', () => {
    const channels: VolumeChannel[] = ['effects', 'ambient', 'ui', 'master', 'music'];
    for (const channel of channels) cues.volumeAdjusted(channel);
    expect(player.ids).toEqual(Array(5).fill('ui_slider'));
    expect(player.calls.map(c => c.opts)).toEqual([
      { bus: 'effects' }, { bus: 'ambient' }, undefined, undefined, undefined,
    ]);
  });
});

describe('fault tolerance', () => {
  it('never throws when the player does', () => {
    player.throwOnPlay = true;
    cues.panelShown(true);
    cues.entitySelected('vehicle');
    cues.volumeAdjusted('ui');
    cues.notification('warn');
    expect(() => runDeferred()).not.toThrow();
  });
});
