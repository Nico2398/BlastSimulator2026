// BlastSimulator2026 — Interface sounds by delegation
// One set of capture-phase listeners on the document gives every button, dropdown and slider its
// sound, so no panel declares one. Tone comes from the element (see uiTone.ts).
//
// Tutorial-inert controls. Install order does not matter: installActivationGuard starts lazily with the tutorial,
// long after this runs, so silence for a railed control comes from the `isInert` option (the caller passes the same
// test the guard uses). A click the guard swallows is also defaultPrevented, checked here only as a backstop.
//
// Disabled controls. A native disabled button never receives `click` in a browser, so a refusal is
// voiced from `pointerdown` (Pointer Events are not suppressed on disabled controls in Chromium; engines
// that do suppress them simply stay silent). jsdom delivers a dispatched `click` to a disabled button,
// which is also treated as a refusal. Keyboard Enter/Space activation yields a `click` event, so it needs
// no handling of its own.
//
// Command claim. A control that runs a game command is voiced by that command's own cue (commandCue), so when a
// CommandClaim is supplied the cue of an enabled control's click waits one macrotask, until the target's handlers
// have run, and is dropped if a command cue was played meanwhile. Hover, sliders, dropdowns and the denial of a
// disabled control have no command behind them and keep playing at once. A handler that runs its command later than
// the click's own task (a promise, a frame) is not seen, and its control is then voiced twice.
//
// Hover after a key. Closing a panel with Escape puts another control under a pointer that did not move, and the
// browser reports it as a pointerover. Any keydown silences hover ticks until the pointer moves or
// UI_SOUND_CONFIG.hoverKeyboardQuietMs has passed.

import type { AudioPlayer } from '../AudioPlayer.js';
import type { CommandClaim } from './CommandClaim.js';
import { UI_SOUND_CONFIG } from '../../core/config/audio/ui.js';
import { createFaultReporter, safePlay } from './safePlay.js';
import {
  DENIED_TONE, SFX_NONE, isDisabledControl, readOverride, resolveClickTone, sliderTone, type UiTone,
} from './uiTone.js';

export interface UiSoundOptions {
  /** Millisecond clock for the rate limits. Default `performance.now`. */
  readonly now?: () => number;
  /** True when a target must stay silent (a tutorial-inert control). */
  readonly isInert?: (target: EventTarget | null) => boolean;
  /** When given, a click cue yields to the command cue played by the same click (see the header). */
  readonly claim?: CommandClaim;
  /** Runs `task` after the current event dispatch and returns a canceller. Default: `setTimeout`. */
  readonly defer?: DeferFn;
}

/** Schedule a task for later; the returned function cancels it if it has not run yet. */
export type DeferFn = (task: () => void) => () => void;

const deferToMacrotask: DeferFn = task => {
  const timer = setTimeout(task, UI_SOUND_CONFIG.claimDeferMs);
  return () => clearTimeout(timer);
};

const reportListenerFault = createFaultReporter('installUiSounds');

const CONTROL_SELECTOR = 'button, [role="button"], select';
const SLIDER_SELECTOR = 'input[type="range"]';

/** One installation per document: installing again replaces the previous one instead of stacking beside it. */
const installed = new WeakMap<Document, () => void>();

function closestMatch(target: EventTarget | null, selector: string): Element | null {
  const node = target as Partial<Element> | null;
  return typeof node?.closest === 'function' ? node.closest(selector) : null;
}

/**
 * Install click, hover, disabled-press, slider and dropdown sounds on `doc`. Returns a disposer.
 * Every handler is fenced so an audio fault can never break the click that triggered it.
 */
export function installUiSounds(doc: Document, player: AudioPlayer, options: UiSoundOptions = {}): () => void {
  installed.get(doc)?.();
  const now = options.now ?? (() => performance.now());
  const isInert = options.isInert ?? (() => false);
  const { claim } = options;
  const defer = options.defer ?? deferToMacrotask;
  const pending = new Set<{ cancel: () => void }>();

  let lastHovered: Element | null = null;
  let lastHoverAt = -Infinity;
  let lastValueAt = -Infinity;
  let lastDeniedAt = -Infinity;
  let lastKeyAt = -Infinity;
  let pointerMovedSinceKey = true;

  const play = (tone: UiTone): void => safePlay(player, tone.id, tone.opts);

  const playGated = (tone: UiTone, lastAt: number, gapMs: number): number => {
    const t = now();
    if (t - lastAt < gapMs) return lastAt;
    play(tone);
    return t;
  };

  /** Play `tone` once the target's handlers have run, unless a command cue was played meanwhile. */
  const playUnlessClaimed = (tone: UiTone): void => {
    if (claim === undefined) {
      play(tone);
      return;
    }
    const marksAtClick = claim.marks;
    const job: { cancel: () => void } = { cancel: () => {} };
    pending.add(job);
    job.cancel = defer(() => {
      pending.delete(job);
      if (claim.marks === marksAtClick) play(tone); // play() is already fenced by safePlay
    });
  };

  /** Everything that must keep a target silent, before any tone is considered. */
  const muted = (e: Event): boolean => e.defaultPrevented || isInert(e.target);

  const onClick = (e: Event): void => {
    const control = closestMatch(e.target, CONTROL_SELECTOR);
    if (control === null || muted(e)) return;
    if (isDisabledControl(control)) {
      if (readOverride(control) !== SFX_NONE) lastDeniedAt = playGated(DENIED_TONE, lastDeniedAt, UI_SOUND_CONFIG.deniedMinGapMs);
      return;
    }
    const tone = resolveClickTone(control);
    if (tone !== null) playUnlessClaimed(tone);
  };

  const onPointerDown = (e: Event): void => {
    const control = closestMatch(e.target, CONTROL_SELECTOR);
    if (control === null || muted(e) || !isDisabledControl(control)) return;
    if (readOverride(control) === SFX_NONE) return;
    lastDeniedAt = playGated(DENIED_TONE, lastDeniedAt, UI_SOUND_CONFIG.deniedMinGapMs);
  };

  const onKeyDown = (): void => {
    lastKeyAt = now();
    pointerMovedSinceKey = false;
  };

  const onPointerMove = (): void => {
    pointerMovedSinceKey = true;
  };

  /** A key was pressed lately and the pointer has not moved since: the control under it is not a new hover. */
  const hoverQuietAfterKey = (): boolean =>
    !pointerMovedSinceKey && now() - lastKeyAt < UI_SOUND_CONFIG.hoverKeyboardQuietMs;

  const onPointerOver = (e: Event): void => {
    const control = closestMatch(e.target, CONTROL_SELECTOR);
    if (control === null) {
      lastHovered = null;
      return;
    }
    if (control === lastHovered) return;
    // A panel re-render swaps the buttons under a resting pointer; that is not the player hovering.
    const replacedUnderPointer = lastHovered !== null && !lastHovered.isConnected;
    lastHovered = control;
    if (replacedUnderPointer) return;
    if ((e as MouseEvent).buttons !== 0 || muted(e)) return;
    if (isDisabledControl(control) || readOverride(control) === SFX_NONE || hoverQuietAfterKey()) return;
    lastHoverAt = playGated({ id: 'ui_hover' }, lastHoverAt, UI_SOUND_CONFIG.hoverMinGapMs);
  };

  const onInput = (e: Event): void => {
    const slider = closestMatch(e.target, SLIDER_SELECTOR) as HTMLInputElement | null;
    if (slider === null || muted(e) || readOverride(slider) === SFX_NONE) return;
    lastValueAt = playGated(sliderTone(slider), lastValueAt, UI_SOUND_CONFIG.valueMinGapMs);
  };

  const onChange = (e: Event): void => {
    const select = closestMatch(e.target, 'select');
    if (select === null || muted(e) || readOverride(select) === SFX_NONE) return;
    lastValueAt = playGated({ id: 'ui_tab' }, lastValueAt, UI_SOUND_CONFIG.valueMinGapMs);
  };

  const handlers: ReadonlyArray<readonly [string, (e: Event) => void]> = [
    ['click', onClick],
    ['pointerdown', onPointerDown],
    ['pointerover', onPointerOver],
    ['pointermove', onPointerMove],
    ['keydown', onKeyDown],
    ['input', onInput],
    ['change', onChange],
  ];
  const fenced = handlers.map(([type, handler]) => {
    const listener = (e: Event): void => {
      try {
        handler(e);
      } catch (error) {
        // A sound fault must never break the click that triggered it, but it is logged once.
        reportListenerFault(error);
      }
    };
    return [type, listener] as const;
  });

  for (const [type, listener] of fenced) doc.addEventListener(type, listener, true);
  const dispose = (): void => {
    for (const job of pending) job.cancel();
    pending.clear();
    for (const [type, listener] of fenced) doc.removeEventListener(type, listener, true);
    if (installed.get(doc) === dispose) installed.delete(doc);
  };
  installed.set(doc, dispose);
  return dispose;
}
