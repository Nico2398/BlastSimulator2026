// BlastSimulator2026 — Rows of sounds on the lab page
// One row per catalog entry: a one-shot has a Play button (and, when positional, a
// distance and a left/right slider); a bed has an on/off toggle and a level slider.

import type { AudioPlayer } from '../../AudioPlayer.js';
import { LAB_PANEL_CONFIG } from '../../../core/config/audio/lab.js';
import { describeSound, sourcePosition, type LoopEntry, type OneShotEntry } from '../catalogView.js';
import { button, h, slider } from './dom.js';

const DISTANCE = LAB_PANEL_CONFIG.distance;
const LOOP = LAB_PANEL_CONFIG.loopLevel;

function rowShell(id: string, description: string, ...controls: Array<HTMLElement | null>): { row: HTMLElement; result: HTMLElement } {
  const result = h('span', { class: 'result', 'data-role': 'result' });
  const row = h('div', { class: 'row', 'data-sound': id },
    h('div', { class: 'name' }, h('strong', {}, id), h('small', {}, description)),
    h('div', { class: 'controls' }, ...controls, result));
  return { row, result };
}

export function oneShotRow(entry: OneShotEntry, player: AudioPlayer): HTMLElement {
  let distanceM: number = DISTANCE.defaultM;
  let side = 0;
  const spatial = entry.def.spatial === true;
  const distance = spatial
    ? slider({ label: 'distance', min: DISTANCE.minM, max: DISTANCE.maxM, step: DISTANCE.stepM, value: distanceM, format: v => `${v} m`, onInput: (v) => { distanceM = v; }, attrs: { 'data-role': 'distance' } })
    : null;
  const leftRight = spatial
    ? slider({ label: 'left / right', min: -1, max: 1, step: 0.05, value: side, format: v => (v === 0 ? 'centre' : `${v < 0 ? 'L' : 'R'} ${Math.abs(v).toFixed(2)}`), onInput: (v) => { side = v; }, attrs: { 'data-role': 'side' } })
    : null;
  const { row, result } = rowShell(entry.id, describeSound(entry.def), distance?.element ?? null, leftRight?.element ?? null);
  const play = button('Play', () => {
    const handle = player.play(entry.id, spatial ? { at: sourcePosition(distanceM, side) } : undefined);
    result.textContent = handle ? 'played' : 'dropped (cooldown, voice cap or not loaded)';
    result.classList.toggle('dropped', handle === null);
  }, { 'data-action': 'play' });
  row.querySelector('.controls')?.prepend(play);
  return row;
}

export interface LoopRow {
  readonly element: HTMLElement;
  /** Switch the bed off and show it so. */
  reset(): void;
}

export function loopRow(entry: LoopEntry, player: AudioPlayer): LoopRow {
  let level: number = LOOP.default;
  let on = false;
  const apply = (): void => { player.loop(entry.id).setLevel(on ? level : 0, LOOP.rampS); };
  const toggle = button('Off', () => {
    on = !on;
    show();
    apply();
  }, { 'data-action': 'toggle' });
  const show = (): void => {
    toggle.textContent = on ? 'On' : 'Off';
    toggle.setAttribute('aria-pressed', String(on));
  };
  const levelSlider = slider({
    label: 'level', min: 0, max: 1, step: 0.05, value: level, format: v => v.toFixed(2),
    onInput: (v) => { level = v; if (on) apply(); }, attrs: { 'data-role': 'level' },
  });
  const { row } = rowShell(entry.id, `${describeSound(entry.def)} · loop`, toggle, levelSlider.element);
  show();
  return {
    element: row,
    reset: () => {
      on = false;
      show();
    },
  };
}
