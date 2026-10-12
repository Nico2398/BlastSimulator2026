// BlastSimulator2026 — Interface sounds by delegation
// One set of capture-phase listeners on the document gives every button, dropdown and slider its
// sound, so no panel declares one. Tone comes from the element (see uiTone.ts).
//
// Install order: after installActivationGuard. That guard swallows clicks on tutorial-inert controls with
// stopImmediatePropagation, which only silences listeners registered after it on the same target. A
// swallowed click is also defaultPrevented, which is checked here as a second line of defence.
//
// Disabled controls. A native disabled button never receives `click` in a browser, so a refusal is
// voiced from `pointerdown` (Pointer Events are not suppressed on disabled controls in Chromium; engines
// that do suppress them simply stay silent). jsdom delivers a dispatched `click` to a disabled button,
// which is also treated as a refusal. Keyboard Enter/Space activation yields a `click` event, so it needs
// no handling of its own.

import type { AudioPlayer } from '../AudioPlayer.js';
import { UI_SOUND_CONFIG } from '../../core/config/audio/ui.js';
import { safePlay } from './safePlay.js';
import {
  DENIED_TONE, SFX_NONE, isDisabledControl, readOverride, resolveClickTone, sliderTone, type UiTone,
} from './uiTone.js';

export interface UiSoundOptions {
  /** Millisecond clock for the rate limits. Default `performance.now`. */
  readonly now?: () => number;
  /** True when a target must stay silent (a tutorial-inert control). */
  readonly isInert?: (target: EventTarget | null) => boolean;
}

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

  let lastHovered: Element | null = null;
  let lastHoverAt = -Infinity;
  let lastValueAt = -Infinity;
  let lastDeniedAt = -Infinity;

  const play = (tone: UiTone): void => safePlay(player, tone.id, tone.opts);

  const playGated = (tone: UiTone, lastAt: number, gapMs: number): number => {
    const t = now();
    if (t - lastAt < gapMs) return lastAt;
    play(tone);
    return t;
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
    if (tone !== null) play(tone);
  };

  const onPointerDown = (e: Event): void => {
    const control = closestMatch(e.target, CONTROL_SELECTOR);
    if (control === null || muted(e) || !isDisabledControl(control)) return;
    if (readOverride(control) === SFX_NONE) return;
    lastDeniedAt = playGated(DENIED_TONE, lastDeniedAt, UI_SOUND_CONFIG.deniedMinGapMs);
  };

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
    if (isDisabledControl(control) || readOverride(control) === SFX_NONE) return;
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
    ['input', onInput],
    ['change', onChange],
  ];
  const fenced = handlers.map(([type, handler]) => {
    const listener = (e: Event): void => {
      try {
        handler(e);
      } catch {
        // A sound fault must never break the click that triggered it.
      }
    };
    return [type, listener] as const;
  });

  for (const [type, listener] of fenced) doc.addEventListener(type, listener, true);
  const dispose = (): void => {
    for (const [type, listener] of fenced) doc.removeEventListener(type, listener, true);
    if (installed.get(doc) === dispose) installed.delete(doc);
  };
  installed.set(doc, dispose);
  return dispose;
}
