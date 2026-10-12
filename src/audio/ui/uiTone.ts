// BlastSimulator2026 — Which sound a control makes
// Pure DOM-to-cue mapping. The interface carries its own semantics (button variant classes, aria-pressed,
// data-* hooks), so the tone is read from the element instead of every panel declaring one.

import type { PlayOptions } from '../AudioPlayer.js';
import type { OneShotId } from '../SoundCatalog.js';
import { UI_SOUND_CONFIG } from '../../core/config/audio/ui.js';

/** A cue and its per-play adjustments. */
export interface UiTone {
  readonly id: OneShotId;
  readonly opts?: PlayOptions;
}

/** Explicit per-control override: `data-sfx="none"` mutes it, `data-sfx="<cue id>"` swaps its tone. */
const SFX_ATTRIBUTE = 'data-sfx';
export const SFX_NONE = 'none';

/** The cues a `data-sfx` attribute may name. Anything else is ignored and the tone is inferred. */
const OVERRIDABLE_CUES: readonly OneShotId[] = [
  'ui_click', 'ui_confirm', 'ui_back', 'ui_tab', 'ui_open', 'ui_close', 'ui_select',
  'ui_toggle_on', 'ui_toggle_off', 'ui_denied', 'purchase',
];

/**
 * Controls whose own sound comes from elsewhere, so the generic click stays out of the way:
 * panel buttons (UIManager's open/close cue), and the pause/speed controls (their `time` command cue).
 */
const SELF_VOICED_SELECTOR =
  '[data-panel], [data-panel-close], [data-speed], [data-action="pause-toggle"]';

/** A refused control: locked, disabled or otherwise unavailable. */
export const DENIED_TONE: UiTone = { id: 'ui_denied' };
const DANGER_CLASSES = ['bsx-btn-danger', 'bsx-btn-danger-solid'] as const;

/** The explicit override on `control` or an ancestor: `'none'`, a tone, or null when absent or unrecognised. */
export function readOverride(control: Element): typeof SFX_NONE | UiTone | null {
  const carrier = control.closest(`[${SFX_ATTRIBUTE}]`);
  const value = carrier?.getAttribute(SFX_ATTRIBUTE) ?? null;
  if (value === null) return null;
  if (value === SFX_NONE) return SFX_NONE;
  const id = OVERRIDABLE_CUES.find(cue => cue === value);
  return id === undefined ? null : { id };
}

/** True for natively disabled controls (including those inside a disabled fieldset) and aria-disabled ones. */
export function isDisabledControl(control: Element): boolean {
  return control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true';
}

/** The sound of an enabled control being activated, or null when it stays silent. */
export function resolveClickTone(control: Element): UiTone | null {
  const override = readOverride(control);
  if (override === SFX_NONE) return null;
  if (override !== null) return override;
  if (control.matches(SELF_VOICED_SELECTOR)) return null;
  if (control.classList.contains('bsx-btn-locked')) return DENIED_TONE;
  // Capture runs before the handler flips the state, so the cue follows the state it is about to become.
  const pressed = control.getAttribute('aria-pressed');
  if (pressed !== null) return { id: pressed === 'true' ? 'ui_toggle_off' : 'ui_toggle_on' };
  if (control.hasAttribute('data-lang')) return { id: 'ui_tab' };
  if (DANGER_CLASSES.some(cls => control.classList.contains(cls))) {
    return {
      id: 'ui_click',
      opts: { pitchCents: UI_SOUND_CONFIG.dangerPitchCents, gainDb: UI_SOUND_CONFIG.dangerGainDb },
    };
  }
  if (control.classList.contains('bsx-btn-primary')) return { id: 'ui_confirm' };
  return { id: 'ui_click' };
}

/** The tone of a range input moving: pitch climbs across its travel so a drag has a direction. */
export function sliderTone(input: HTMLInputElement): UiTone {
  const min = input.min === '' ? 0 : Number(input.min);
  const max = input.max === '' ? 100 : Number(input.max);
  const span = max - min;
  const fraction = span > 0 && Number.isFinite(span) ? (Number(input.value) - min) / span : 0.5;
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0.5;
  return { id: 'ui_slider', opts: { pitchCents: (clamped - 0.5) * UI_SOUND_CONFIG.sliderPitchSpanCents } };
}
