// BlastSimulator2026 — Minor-event notice dock (#2146)
// A minor event is not a modal: it waits here as a card with a countdown, the clock keeps running, and an
// unanswered one settles itself on the cheapest crew-keeping option when the countdown ends.

import type { GameState } from '../../core/state/GameState.js';
import { getEventById } from '../../core/events/EventPool.js';
import { noticeTicksLeft } from '../../core/events/EventSystem.js';
import { t } from '../../core/i18n/I18n.js';
import { button, chip, el } from '../dom.js';
import type { GameConsoleFn } from '../gameConsole.js';
import { shellLayoutRegistry, type Rect, type Viewport } from './LayoutRegistry.js';

const DOCK_WIDTH_PX = 340;
const DOCK_BOTTOM_PX = 96;
/** Room for a few stacked cards; more clip rather than push into other regions. */
const DOCK_HEIGHT_PX = 320;

function dockBounds(viewport: Viewport): Rect {
  return { x: Math.max(0, viewport.width - DOCK_WIDTH_PX - 16), y: Math.max(0, viewport.height - DOCK_BOTTOM_PX - DOCK_HEIGHT_PX), width: DOCK_WIDTH_PX, height: DOCK_HEIGHT_PX };
}

/** What one card shows, derived from state so the DOM can be skipped when nothing changed. */
export interface NoticeCardModel {
  eventId: string;
  title: string;
  desc: string;
  ticksLeft: number;
  options: string[];
}

/** One card per live notice whose definition still exists. */
export function noticeCards(state: GameState): NoticeCardModel[] {
  const cards: NoticeCardModel[] = [];
  for (const notice of state.events.minorNotices) {
    const def = getEventById(notice.eventId);
    if (!def) continue;
    cards.push({
      eventId: def.id,
      title: t(def.titleKey),
      desc: t(def.descKey),
      ticksLeft: noticeTicksLeft(notice, state.tickCount),
      options: def.options.map(o => t(o.labelKey)),
    });
  }
  return cards;
}

export class EventNotices {
  private readonly root: HTMLElement;
  private gameConsole: GameConsoleFn | null = null;
  private signature = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', { className: 'bsx-root', attrs: { id: 'bs-event-notices', role: 'region', 'aria-label': t('ui.notice.aria') } });
    this.root.style.cssText = [
      'position:fixed', 'right:16px', `bottom:${DOCK_BOTTOM_PX}px`, 'z-index:var(--bsx-z-toast)', `width:${DOCK_WIDTH_PX}px`,
      `max-height:${DOCK_HEIGHT_PX}px`, 'overflow:hidden', 'display:flex', 'flex-direction:column', 'gap:8px',
      'justify-content:flex-end', 'pointer-events:none',
    ].join(';');
    parent.appendChild(this.root);
    shellLayoutRegistry.register({ id: 'event-notices', layer: 'overlay', bounds: dockBounds });
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  update(state: GameState): void {
    const cards = noticeCards(state);
    const signature = JSON.stringify(cards);
    if (signature === this.signature) return;
    this.signature = signature;
    this.root.replaceChildren(...cards.map(c => this.renderCard(c)));
  }

  private renderCard(card: NoticeCardModel): HTMLElement {
    const wrap = el('div', { className: 'bs-notice', attrs: { 'data-event-id': card.eventId } });
    wrap.style.cssText = 'pointer-events:auto;display:flex;flex-direction:column;gap:6px;padding:10px 12px;'
      + 'background:var(--bsx-surface, #1c1f26);border:1px solid var(--bsx-border, #3a3f4b);border-radius:6px;';
    const head = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' } });
    head.append(
      el('strong', { text: card.title, attrs: { style: 'flex:1;font:600 12px/1.3 var(--bsx-font-ui)' } }),
      chip(t('ui.notice.countdown', { ticks: card.ticksLeft }), 'warn'),
    );
    wrap.append(head, el('p', { text: card.desc, attrs: { style: 'margin:0;font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)' } }));
    const row = el('div', { attrs: { style: 'display:flex;flex-wrap:wrap;gap:6px' } });
    card.options.forEach((label, idx) => {
      const btn = button('ghost', label, { onClick: () => this.gameConsole?.(`event choose ${idx} ${card.eventId}`) });
      btn.classList.add('bs-notice-choice');
      row.appendChild(btn);
    });
    wrap.appendChild(row);
    return wrap;
  }

  dispose(): void {
    this.root.remove();
    shellLayoutRegistry.unregister('event-notices');
  }
}
