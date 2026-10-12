// @vitest-environment jsdom
// BlastSimulator2026 — A panel or modal supersedes the click that opened it
// UiCues marks the shared CommandClaim for every response that is the direct consequence of an activation, so the
// delegated click (deferred by one macrotask) stays out of it. Toasts are not a click's consequence and do not mark.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CommandClaim } from '../../../../src/audio/ui/CommandClaim.js';
import { installUiSounds, type DeferFn } from '../../../../src/audio/ui/installUiSounds.js';
import { UiCues } from '../../../../src/audio/ui/UiCues.js';
import { button } from '../../../../src/ui/dom.js';
import { RecordingPlayer } from '../../../helpers/audioPlayerFakes.js';

let player: RecordingPlayer;
let claim: CommandClaim;
let cues: UiCues;
let clickTasks: Array<{ run: () => void; live: boolean }>;
let microtasks: Array<() => void>;
let dispose: () => void;
let root: HTMLElement;

const defer: DeferFn = task => {
  const entry = { run: task, live: true };
  clickTasks.push(entry);
  return () => { entry.live = false; };
};

/** The macrotask boundary: delegated clicks are judged here. */
function runClickTasks(): void {
  const batch = clickTasks;
  clickTasks = [];
  for (const t of batch) if (t.live) t.run();
}

function runMicrotasks(): void {
  const batch = microtasks;
  microtasks = [];
  for (const task of batch) task();
}

/** A button whose click handler runs `respond`, as a rail button opening a panel does. */
function clickButton(respond: () => void): void {
  const btn = button('ghost', 'Go');
  btn.addEventListener('click', respond);
  root.appendChild(btn);
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  player = new RecordingPlayer();
  claim = new CommandClaim();
  clickTasks = [];
  microtasks = [];
  cues = new UiCues(player, { claim, defer: task => { microtasks.push(task); } });
  root = document.createElement('div');
  document.body.appendChild(root);
  dispose = installUiSounds(document, player, { claim, defer, now: () => 1000 });
});

afterEach(() => {
  dispose();
  root.remove();
});

describe('responses that are the consequence of an activation mark the claim', () => {
  it.each([
    ['a panel opening', () => cues.panelShown(true), 'ui_open'],
    ['a panel closing', () => cues.panelShown(false), 'ui_close'],
    ['a modal appearing', () => cues.modalShown(), 'ui_modal'],
  ] as const)('%s: the click that caused it stays silent', (_label, respond, id) => {
    clickButton(respond);
    expect(claim.marks).toBe(1);
    runClickTasks();
    expect(player.ids).toEqual([id]);
  });

  it('plays the generic click when nothing responded to the activation', () => {
    clickButton(() => undefined);
    runClickTasks();
    expect(player.ids).toEqual(['ui_click']);
  });

  it('judges each activation on its own: a panel click, then a plain one', () => {
    clickButton(() => cues.panelShown(true));
    runClickTasks();
    clickButton(() => undefined);
    runClickTasks();
    expect(player.ids).toEqual(['ui_open', 'ui_click']);
  });
});

describe('a toast is not a click consequence', () => {
  it('does not mark the claim, so the click still plays beside the toast', () => {
    clickButton(() => cues.notification('warn'));
    expect(claim.marks).toBe(0);
    runClickTasks();
    runMicrotasks();
    expect(player.ids).toEqual(['ui_click', 'notify_warn']);
  });

  it('leaves the claim alone for selection, refusal and slider cues too', () => {
    cues.entitySelected('employee');
    cues.placementRefused();
    cues.volumeAdjusted('ui');
    expect(claim.marks).toBe(0);
  });
});

describe('without a claim', () => {
  it('plays the same cues and fails on nothing', () => {
    const bare = new UiCues(player, { defer: task => { microtasks.push(task); } });
    bare.panelShown(true);
    bare.panelShown(false);
    bare.modalShown();
    expect(player.ids).toEqual(['ui_open', 'ui_close', 'ui_modal']);
    expect(claim.marks).toBe(0);
  });
});
