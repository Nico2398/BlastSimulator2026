// BlastSimulator2026 — HUD chips for active event modifiers (#1414)

import type { ActiveModifier } from '../../core/events/ActiveModifiers.js';
import { modifierSummary } from '../../core/events/ModifierText.js';
import { chip, el } from '../dom.js';
import { shellLayoutRegistry, type Rect, type Viewport } from './LayoutRegistry.js';
import { TOPBAR_HEIGHT_PX, SPACING_3_PX } from '../tokens.js';

/** Width and height of the chip strip, matching its inline style below. */
const STRIP_WIDTH_PX = 520;
const STRIP_HEIGHT_PX = 26;

/** Centered strip just under the top bar; one row, extra chips clip rather than wrap into other regions. */
function stripBounds(viewport: Viewport): Rect {
  return { x: Math.max(0, (viewport.width - STRIP_WIDTH_PX) / 2), y: TOPBAR_HEIGHT_PX + SPACING_3_PX, width: STRIP_WIDTH_PX, height: STRIP_HEIGHT_PX };
}

/** Renders one chip per live modifier into the container; returns an updater taking the current modifiers and tick. */
export function createModifierChips(
  container: HTMLElement,
): (modifiers: readonly ActiveModifier[], tick: number) => void {
  let lastSignature = '';
  return (modifiers, tick) => {
    const labels = modifiers.map(m => modifierSummary(m, tick));
    const signature = labels.join('|');
    if (signature === lastSignature) return;
    lastSignature = signature;
    container.replaceChildren(...labels.map(label => {
      const c = chip(label, 'warn');
      c.classList.add('bs-modifier-chip');
      return c;
    }));
  };
}

/** The live HUD strip: a fixed container under the top bar, registered with the shell layout registry. */
export function mountModifierChips(parent: HTMLElement): {
  update: (modifiers: readonly ActiveModifier[], tick: number) => void;
  dispose: () => void;
} {
  const strip = el('div', { className: 'bsx-root', attrs: { id: 'bs-modifier-chips' } });
  strip.style.cssText = [
    'position:fixed', 'left:50%', 'transform:translateX(-50%)', 'top:calc(var(--bsx-topbar-height) + var(--bsx-sp-3))',
    'z-index:var(--bsx-z-toast)', `width:${STRIP_WIDTH_PX}px`, `height:${STRIP_HEIGHT_PX}px`, 'overflow:hidden',
    'display:flex', 'gap:6px', 'align-items:center', 'justify-content:center', 'pointer-events:none',
  ].join(';');
  parent.appendChild(strip);
  shellLayoutRegistry.register({ id: 'modifier-chips', layer: 'overlay', bounds: stripBounds });
  return {
    update: createModifierChips(strip),
    dispose: () => { strip.remove(); shellLayoutRegistry.unregister('modifier-chips'); },
  };
}
