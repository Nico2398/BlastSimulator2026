// @vitest-environment jsdom
// BlastSimulator2026 — A command cue supersedes the generic click of the control that ran it
// Real DOM clicks on buttons whose handlers run real parsed commands through commandCue, with an injected
// scheduler standing in for the macrotask boundary. Asserts on what a recording player was asked to play.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CommandClaim } from '../../../../src/audio/ui/CommandClaim.js';
import { commandCue } from '../../../../src/audio/ui/commandCues.js';
import { installUiSounds, type DeferFn } from '../../../../src/audio/ui/installUiSounds.js';
import { parseCommand } from '../../../../src/console/ConsoleRunner.js';
import { UI_SOUND_CONFIG } from '../../../../src/core/config/audio/ui.js';
import { button } from '../../../../src/ui/dom.js';
import { RecordingPlayer } from './recordingPlayer.js';

/** Stands in for setTimeout(0): tasks wait until run() and can be cancelled. */
class ManualScheduler {
  private tasks: Array<{ run: () => void; live: boolean }> = [];

  readonly defer: DeferFn = task => {
    const entry = { run: task, live: true };
    this.tasks.push(entry);
    return () => { entry.live = false; };
  };

  get waiting(): number { return this.tasks.filter(t => t.live).length; }

  run(): void {
    const batch = this.tasks;
    this.tasks = [];
    for (const t of batch) if (t.live) t.run();
  }
}

let player: RecordingPlayer;
let claim: CommandClaim;
let scheduler: ManualScheduler;
let dispose: () => void;
let root: HTMLElement;

function install(): void {
  dispose = installUiSounds(document, player, { claim, defer: scheduler.defer, now: () => 1000 });
}

function click(target: Element): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** A button whose click handler runs `line` through the command cue, as runGameCommand does. */
function commandButton(variant: Parameters<typeof button>[0], line: string, success = true): HTMLElement {
  const btn = button(variant, 'Go');
  btn.addEventListener('click', () => commandCue(player, parseCommand(line), success, { claim }));
  root.appendChild(btn);
  return btn;
}

function plainButton(variant: Parameters<typeof button>[0] = 'ghost'): HTMLElement {
  const btn = button(variant, 'Open');
  root.appendChild(btn);
  return btn;
}

beforeEach(() => {
  player = new RecordingPlayer();
  claim = new CommandClaim();
  scheduler = new ManualScheduler();
  root = document.createElement('div');
  document.body.appendChild(root);
  install();
});

afterEach(() => {
  dispose();
  root.remove();
});

describe('a command supersedes the click of the button that ran it', () => {
  it('plays only the hire cue for a primary button that hires', () => {
    click(commandButton('primary', 'employee hire role:driller'));
    expect(player.ids).toEqual(['hire']);
    scheduler.run();
    expect(player.ids).toEqual(['hire']);
  });

  it.each([
    ['ghost', 'vehicle haul 2', 'order_queued'],
    ['danger', 'employee fire 3', 'fire'],
    ['primary', 'buy tubing amount:10', 'purchase'],
  ] as const)('a %s button running "%s" plays only %s', (variant, line, id) => {
    click(commandButton(variant, line));
    scheduler.run();
    expect(player.ids).toEqual([id]);
  });

  it('plays only ui_denied when the command is refused, never a click before it', () => {
    click(commandButton('primary', 'employee hire role:driller', false));
    scheduler.run();
    expect(player.ids).toEqual(['ui_denied']);
  });

  it('plays only the denial for a locked button whose handler runs a refused command', () => {
    click(commandButton('locked', 'build site_office', false));
    scheduler.run();
    expect(player.ids).toEqual(['ui_denied']);
  });

  it('plays only one toggle cue when a command-driven toggle button is clicked', () => {
    const btn = commandButton('ghost', 'time pause');
    btn.setAttribute('aria-pressed', 'false');
    click(btn);
    scheduler.run();
    expect(player.ids).toEqual(['ui_toggle_off']);
  });
});

describe('a control with no command behind it keeps its click', () => {
  it('plays the click once, only after the scheduler runs', () => {
    click(plainButton());
    expect(player.calls).toEqual([]);
    scheduler.run();
    expect(player.ids).toEqual(['ui_click']);
    scheduler.run();
    expect(player.ids).toEqual(['ui_click']);
  });

  it('keeps the tone of the control: confirm for primary, a lowered click for danger', () => {
    click(plainButton('primary'));
    click(plainButton('danger'));
    scheduler.run();
    expect(player.calls).toEqual([
      { id: 'ui_confirm', opts: undefined },
      { id: 'ui_click', opts: { pitchCents: UI_SOUND_CONFIG.dangerPitchCents, gainDb: UI_SOUND_CONFIG.dangerGainDb } },
    ]);
  });

  it.each([
    'state', 'employee list', 'build list', 'contract status', 'drill_plan show', 'nonsense',
  ])('keeps the click when the command "%s" is information only and plays nothing', line => {
    click(commandButton('ghost', line));
    scheduler.run();
    expect(player.ids).toEqual(['ui_click']);
  });

  it('keeps the click for a refused command that has no denial cue (an information command)', () => {
    click(commandButton('ghost', 'employee list', false));
    scheduler.run();
    expect(player.ids).toEqual(['ui_click']);
  });

  it('keeps the click for a scripted command, which stays silent', () => {
    const btn = plainButton();
    btn.addEventListener('click', () => commandCue(player, parseCommand('employee hire role:driller'), true, { scripted: true, claim }));
    click(btn);
    scheduler.run();
    expect(player.ids).toEqual(['ui_click']);
  });

  it('keeps the click when the command succeeds but its success sound belongs to the game director', () => {
    click(commandButton('ghost', 'vehicle scrap 2'));
    scheduler.run();
    expect(player.ids).toEqual(['ui_click']);
  });

  it('still denies a refused director-owned command, once', () => {
    click(commandButton('ghost', 'vehicle scrap 2', false));
    scheduler.run();
    expect(player.ids).toEqual(['ui_denied']);
  });
});

describe('rapid clicks', () => {
  it('judges each click on its own when the scheduler runs between them', () => {
    click(commandButton('primary', 'employee hire role:driller'));
    scheduler.run();
    click(plainButton());
    scheduler.run();
    click(commandButton('ghost', 'vehicle haul 2'));
    scheduler.run();
    expect(player.ids).toEqual(['hire', 'ui_click', 'order_queued']);
  });

  it('plays a click that came after a command click in the same task batch', () => {
    click(commandButton('primary', 'employee hire role:driller'));
    click(plainButton());
    expect(scheduler.waiting).toBe(2);
    scheduler.run();
    expect(player.ids).toEqual(['hire', 'ui_click']);
  });

  it('plays both cues of two command clicks, and no click', () => {
    const hire = commandButton('primary', 'employee hire role:driller');
    click(hire);
    click(hire);
    scheduler.run();
    expect(player.ids).toEqual(['hire', 'hire']);
  });
});

describe('what is not deferred', () => {
  it('voices a disabled control at once, hover and sliders too', () => {
    const off = button('primary', 'No funds', { disabled: true });
    root.appendChild(off);
    off.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    expect(player.ids).toEqual(['ui_denied']);

    const hover = plainButton();
    hover.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    const range = document.createElement('input');
    range.type = 'range';
    root.appendChild(range);
    range.dispatchEvent(new Event('input', { bubbles: true }));
    expect(player.ids).toEqual(['ui_denied', 'ui_hover', 'ui_slider']);
    expect(scheduler.waiting).toBe(0);
  });

  it('does not let a command claim suppress hover, sliders or denials of other controls', () => {
    commandCue(player, parseCommand('employee hire role:driller'), true, { claim });
    const hover = plainButton();
    hover.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    expect(player.ids).toEqual(['hire', 'ui_hover']);
  });
});

describe('failure and lifecycle', () => {
  it('plays nothing and throws nothing when the scheduler never runs', () => {
    expect(() => {
      click(plainButton());
      click(commandButton('primary', 'employee hire role:driller', false));
    }).not.toThrow();
    expect(player.ids).toEqual(['ui_denied']);
    expect(scheduler.waiting).toBe(2);
  });

  it('cancels pending cues on dispose', () => {
    click(plainButton());
    click(plainButton('primary'));
    expect(scheduler.waiting).toBe(2);
    dispose();
    expect(scheduler.waiting).toBe(0);
    scheduler.run();
    expect(player.calls).toEqual([]);
  });

  it('cancels the pending cues of the first install when a second one replaces it', () => {
    click(plainButton());
    const first = dispose;
    install();
    scheduler.run();
    expect(player.calls).toEqual([]);
    click(plainButton());
    scheduler.run();
    expect(player.ids).toEqual(['ui_click']);
    first();
  });

  it('survives an audio fault in the deferred play', () => {
    click(plainButton());
    player.throwOnPlay = true;
    expect(() => scheduler.run()).not.toThrow();
  });

  it('does not share claim state between two documents', () => {
    const otherDoc = document.implementation.createHTMLDocument('other');
    const otherPlayer = new RecordingPlayer();
    const otherClaim = new CommandClaim();
    const otherScheduler = new ManualScheduler();
    const stop = installUiSounds(otherDoc, otherPlayer, { claim: otherClaim, defer: otherScheduler.defer });
    const otherBtn = button('ghost', 'Other');
    otherDoc.body.appendChild(otherBtn);

    click(plainButton());
    otherBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    claim.mark();
    otherScheduler.run();
    scheduler.run();

    expect(otherPlayer.ids).toEqual(['ui_click']);
    expect(player.calls).toEqual([]);
    expect(otherClaim.marks).toBe(0);
    stop();
  });

  it('stays immediate and unscheduled when no claim is supplied', () => {
    dispose();
    dispose = installUiSounds(document, player, { defer: scheduler.defer });
    click(plainButton());
    expect(player.ids).toEqual(['ui_click']);
    expect(scheduler.waiting).toBe(0);
  });

  it('defers with a real macrotask by default', async () => {
    dispose();
    dispose = installUiSounds(document, player, { claim });
    click(plainButton());
    expect(player.calls).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, UI_SOUND_CONFIG.claimDeferMs + 5));
    expect(player.ids).toEqual(['ui_click']);
  });

  it('cancels the default timer on dispose', async () => {
    dispose();
    dispose = installUiSounds(document, player, { claim });
    click(plainButton());
    dispose();
    await new Promise(resolve => setTimeout(resolve, UI_SOUND_CONFIG.claimDeferMs + 5));
    expect(player.calls).toEqual([]);
  });
});

describe('CommandClaim', () => {
  it('counts marks from zero', () => {
    const c = new CommandClaim();
    expect(c.marks).toBe(0);
    c.mark();
    c.mark();
    expect(c.marks).toBe(2);
  });
});

describe('commandCue marks the claim exactly when it plays something', () => {
  const marksAfter = (line: string, success: boolean, scripted = false): number => {
    const c = new CommandClaim();
    commandCue(new RecordingPlayer(), parseCommand(line), success, { claim: c, scripted });
    return c.marks;
  };

  it.each([
    ['employee hire role:driller', true],
    ['vehicle upgrade 2', true],
    ['build site_office at:1,2', true],
    ['employee hire role:driller', false],
    ['vehicle scrap 2', false],
    ['time speed 4', true],
  ])('marks once for "%s" (success %s)', (line, success) => {
    expect(marksAfter(line, success)).toBe(1);
  });

  it.each([
    ['tick', true], ['employee list', true], ['employee list', false], ['nonsense', false],
    ['vehicle scrap 2', true], ['contract deliver 2', true],
  ])('does not mark for "%s" (success %s)', (line, success) => {
    expect(marksAfter(line, success)).toBe(0);
  });

  it('does not mark for a scripted command', () => {
    expect(marksAfter('employee hire role:driller', true, true)).toBe(0);
    expect(marksAfter('employee hire role:driller', false, true)).toBe(0);
  });

  it('works without a context or a claim', () => {
    const p = new RecordingPlayer();
    expect(() => commandCue(p, parseCommand('employee hire role:driller'), true)).not.toThrow();
    expect(() => commandCue(p, parseCommand('employee hire role:driller'), false, {})).not.toThrow();
    expect(p.ids).toEqual(['hire', 'ui_denied']);
  });
});
