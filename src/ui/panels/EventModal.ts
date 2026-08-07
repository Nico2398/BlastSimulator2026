// BlastSimulator2026 — Event Modal (redesign P8)
// Replaces EventDialog.ts. Two phases in one class, same as the panel it
// replaces: CHOOSE (category identity, description, options with
// consequence-hint chips from getOptionEffectHints) and OUTCOME (the
// resolved-event headline plus structured effect chips from
// state.events.lastOutcome, DISMISS). The clock auto-resumes the instant an
// option is chosen (console `event choose`) — CLOCK HELD only shows while a
// decision is still pending.
//
// Kept on `#bs-event-dialog` / `.bs-confirm-overlay` and the
// `.bs-event-choice` / `.bs-event-dismiss` classes: tutorialStages.ts's
// 'event-fire-resolve' stage and uiActionProbe's dedicated 'event' region
// both target these exact selectors.

import { t } from '../../core/i18n/I18n.js';
import { el, chip, type ChipTone } from '../dom.js';
import { iconEl, type IconName } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import type { GameState } from '../../core/state/GameState.js';
import { getEventById, getOptionEffectHints, type EventCategory, type EventDef, type EventOptionEffectHint } from '../../core/events/EventPool.js';
import type { EventEffect } from '../../core/events/EventSystem.js';
import type { CommandResult } from '../../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

const CATEGORY_ICON: Record<EventCategory, IconName> = {
  union: 'union',
  politics: 'podium',
  weather: 'cloud',
  mafia: 'fedora',
  lawsuit: 'gavel',
  traffic: 'vehicle',
  mining: 'pick',
  tutorial: 'training',
};

const CATEGORY_COLOR: Record<EventCategory, string> = {
  union: 'var(--bsx-amber)',
  politics: 'var(--bsx-info)',
  weather: 'var(--bsx-survey)',
  mafia: 'var(--bsx-ore)',
  lawsuit: 'var(--bsx-critical)',
  traffic: 'var(--bsx-text-muted)',
  mining: 'var(--bsx-text-muted)',
  tutorial: 'var(--bsx-positive)',
};

const CATEGORY_LABEL_KEY: Record<EventCategory, string> = {
  union: 'ui.event.category.union',
  politics: 'ui.event.category.politics',
  weather: 'ui.event.category.weather',
  mafia: 'ui.event.category.mafia',
  lawsuit: 'ui.event.category.lawsuit',
  traffic: 'ui.event.category.traffic',
  mining: 'ui.event.category.mining',
  tutorial: 'ui.event.category.tutorial',
};

const SCORE_ABBR_KEY: Record<string, string> = {
  wellBeing: 'shell.topbar.score_well',
  safety: 'shell.topbar.score_safe',
  ecology: 'shell.topbar.score_eco',
  nuisance: 'shell.topbar.score_nuis',
};

/** Display name for a hint/effect's kind+key, shared by the choose-phase hint chips and the outcome-phase effect chips. */
function kindLabel(kind: 'cash' | 'score' | 'other', key: string): string {
  if (kind === 'cash') return t('ui.event.effect_cash');
  if (kind === 'score') return t(SCORE_ABBR_KEY[key] ?? key);
  if (key === 'corruption') return t('ui.finances.category.corruption');
  if (key === 'followUp') return t('ui.event.effect_followup');
  return key;
}

/** Choose-phase hint chip: kind + direction only, no magnitude — the real outcome may be probabilistic. */
function hintChip(hint: EventOptionEffectHint): HTMLElement {
  const sign = hint.direction === 'positive' ? '+' : hint.direction === 'negative' ? '-' : '';
  const label = `${sign}${kindLabel(hint.kind, hint.key)}${hint.risky ? '?' : ''}`;
  const tone: ChipTone = hint.risky
    ? 'warn'
    : hint.direction === 'positive' ? 'positive' : hint.direction === 'negative' ? 'critical' : 'neutral';
  return chip(label, tone);
}

/** Outcome-phase effect chip: the real, resolved magnitude. */
function effectChip(effect: EventEffect): HTMLElement {
  const sign = effect.delta > 0 ? '+' : effect.delta < 0 ? '-' : '';
  const magnitude = effect.kind === 'cash' ? `$${formatMoney(Math.abs(effect.delta))}` : `${Math.abs(effect.delta)}`;
  const label = `${sign}${magnitude} ${kindLabel(effect.kind, effect.key)}`;
  const tone: ChipTone = effect.delta > 0 ? 'positive' : effect.delta < 0 ? 'critical' : 'neutral';
  return chip(label, tone);
}

export class EventModal {
  private readonly overlay: HTMLElement;
  private readonly stripe: HTMLElement;
  private readonly iconChipEl: HTMLElement;
  private readonly categoryLabelEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly clockChip: HTMLElement;
  private readonly descEl: HTMLElement;
  private readonly chooseLabel: HTMLElement;
  private readonly optionsEl: HTMLElement;
  private readonly outcomeHeadlineEl: HTMLElement;
  private readonly outcomeEffectsEl: HTMLElement;
  private readonly outcomeNotesEl: HTMLElement;
  private readonly dismissBtn: HTMLButtonElement;

  private gameConsole?: GameConsoleFn;
  private lastEventId: string | null = null;
  /** True while displaying the outcome of a resolved event, distinct from state.events.pendingEvent being null. */
  private showingOutcome = false;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.overlay = el('div', { className: 'bs-confirm-overlay' });
    this.overlay.id = 'bs-event-dialog';
    this.overlay.style.display = 'none';

    const box = el('div');
    box.style.cssText = 'width:520px;max-width:92vw;max-height:86vh;display:flex;flex-direction:column;border-radius:9px;background:var(--bsx-panel);border:1px solid var(--bsx-hairline-strong);box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden';

    this.stripe = el('div');
    this.stripe.style.cssText = 'height:6px;flex:0 0 auto';

    const header = el('div');
    header.style.cssText = 'padding:18px 20px 4px;display:flex;align-items:center;gap:11px';

    this.iconChipEl = el('div');
    this.iconChipEl.style.cssText = 'width:32px;height:32px;border-radius:6px;display:flex;align-items:center;justify-content:center;flex:0 0 auto';

    const titleCol = el('div');
    titleCol.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0';
    this.categoryLabelEl = el('span', { className: 'bs-event-category', attrs: { style: 'font:700 10px/1 var(--bsx-font-ui);letter-spacing:.14em' } });
    this.titleEl = el('span', { className: 'bs-event-title', attrs: { style: 'font:800 15px/1.25 var(--bsx-font-ui);color:var(--bsx-text-primary)' } });
    titleCol.append(this.categoryLabelEl, this.titleEl);

    this.clockChip = chip('', 'warn');
    this.clockChip.style.flex = '0 0 auto';
    this.locale.bindText(this.clockChip, 'ui.event.clock_held');

    header.append(this.iconChipEl, titleCol, this.clockChip);

    const body = el('div');
    body.style.cssText = 'padding:8px 20px 20px;display:flex;flex-direction:column;gap:12px;overflow-y:auto';

    this.descEl = el('p', { className: 'bs-event-text', attrs: { style: 'margin:0;font:400 12px/1.5 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } });

    this.chooseLabel = el('div', { attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.1em;color:var(--bsx-text-micro)' } });
    this.locale.bindText(this.chooseLabel, 'ui.event.choose');

    this.optionsEl = el('div', { className: 'bs-event-choices', attrs: { style: 'display:flex;flex-direction:column;gap:6px' } });

    this.outcomeHeadlineEl = el('div', { attrs: { style: 'font:600 13px/1.5 var(--bsx-font-ui);color:var(--bsx-text-primary)' } });
    this.outcomeHeadlineEl.style.display = 'none';

    this.outcomeEffectsEl = el('div', { attrs: { style: 'display:flex;flex-wrap:wrap;gap:6px' } });

    this.outcomeNotesEl = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:4px' } });

    this.dismissBtn = el('button', { className: 'bsx-btn bsx-btn-primary bs-btn bs-event-dismiss' });
    this.dismissBtn.style.cssText = 'width:100%;margin-top:4px';
    this.locale.bindText(this.dismissBtn, 'ui.event.dismiss');
    this.dismissBtn.style.display = 'none';
    this.dismissBtn.addEventListener('click', () => {
      this.gameConsole?.('event dismiss');
      this.hide();
    });

    body.append(this.descEl, this.chooseLabel, this.optionsEl, this.outcomeHeadlineEl, this.outcomeEffectsEl, this.outcomeNotesEl, this.dismissBtn);
    box.append(this.stripe, header, body);
    this.overlay.appendChild(box);
    container.appendChild(this.overlay);
  }

  get root(): HTMLElement { return this.overlay; }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  /** Re-render locale-dependent text after a language change. */
  refreshLocale(): void {
    this.locale.refresh();
    // Category label, title, options and outcome are only rebuilt when the
    // pending event changes; forget the last id so the next update() re-runs
    // that rebuild in the new locale.
    this.lastEventId = null;
  }

  show(): void { this.overlay.style.display = ''; }
  hide(): void {
    this.overlay.style.display = 'none';
    this.lastEventId = null;
    this.showingOutcome = false;
  }
  get visible(): boolean { return this.overlay.style.display !== 'none'; }
  /** True when the dialog is displaying a resolved event's outcome. */
  get isShowingOutcome(): boolean { return this.showingOutcome; }

  update(state: GameState): void {
    const pending = state.events.pendingEvent;
    const outcome = state.events.lastOutcome;

    // A pending choose-phase event always takes priority. Otherwise, keep
    // showing whatever outcome is already on screen — reached only while
    // showingOutcome is true, so a stale, not-yet-dismissed outcome from an
    // earlier event can never resurface once its own dismiss has fired.
    const eventId = pending ? pending.eventId : (this.showingOutcome ? outcome?.eventId ?? null : null);
    if (eventId === null) { this.hide(); return; }

    const def = getEventById(eventId);
    if (!def) { this.hide(); return; }

    this.show();
    this.clockChip.style.display = pending && state.isPaused ? '' : 'none';

    // Rebuilds on an event change AND on a locale refresh (which resets
    // lastEventId to null) — the latter must re-render whichever phase is
    // currently on screen, not just the choose phase.
    if (eventId === this.lastEventId) return;
    this.lastEventId = eventId;

    this.stripe.style.background = CATEGORY_COLOR[def.category];
    this.iconChipEl.style.background = CATEGORY_COLOR[def.category];
    this.iconChipEl.style.color = 'var(--bsx-panel)';
    this.iconChipEl.replaceChildren(iconEl(CATEGORY_ICON[def.category], 18));
    this.categoryLabelEl.style.color = CATEGORY_COLOR[def.category];
    this.categoryLabelEl.textContent = t(CATEGORY_LABEL_KEY[def.category]);
    this.titleEl.textContent = t(def.titleKey);
    this.descEl.textContent = t(def.descKey);

    if (pending) {
      this.showingOutcome = false;
      this.renderChoosePhase(def, state);
    } else {
      this.enterOutcomePhase(state);
    }
  }

  /** Choose-phase options: label + consequence-hint chips where the def declares them. */
  private renderChoosePhase(def: EventDef, state: GameState): void {
    this.chooseLabel.style.display = '';
    this.optionsEl.style.display = '';
    this.outcomeHeadlineEl.style.display = 'none';
    this.outcomeHeadlineEl.textContent = '';
    this.outcomeEffectsEl.replaceChildren();
    this.outcomeNotesEl.replaceChildren();
    this.dismissBtn.style.display = 'none';

    this.optionsEl.replaceChildren();
    for (let i = 0; i < def.options.length; i++) {
      const option = def.options[i]!;
      const consequence = def.consequences[i];
      const btn = el('button', { className: 'bsx-btn bs-btn bs-event-choice' });
      btn.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:10px;text-align:left;height:auto;min-height:36px;padding:9px 12px;white-space:normal';
      btn.appendChild(el('span', { text: t(option.labelKey), attrs: { style: 'flex:1' } }));
      const hints = getOptionEffectHints(option, consequence);
      if (hints.length > 0) {
        const hintRow = el('div', { attrs: { style: 'display:flex;gap:4px;flex:0 0 auto' } });
        hintRow.append(...hints.map(hintChip));
        btn.appendChild(hintRow);
      }
      const idx = i;
      btn.addEventListener('click', () => {
        // Set the flag before calling gameConsole — resolving clears
        // pendingEvent, which would otherwise read as "nothing to show".
        this.showingOutcome = true;
        this.gameConsole?.(`event choose ${idx}`);
        this.enterOutcomePhase(state);
      });
      this.optionsEl.appendChild(btn);
    }
  }

  /** Switch to outcome display after a choice is made (or re-render it after a locale refresh). */
  private enterOutcomePhase(state: GameState): void {
    const outcome = state.events.lastOutcome;
    if (!outcome) return;

    this.showingOutcome = true;
    this.clockChip.style.display = 'none';
    this.chooseLabel.style.display = 'none';
    this.optionsEl.style.display = 'none';

    this.outcomeHeadlineEl.textContent = t(outcome.resultKey);
    this.outcomeHeadlineEl.style.display = '';

    const chips = outcome.effects.filter(e => !e.textKey);
    const notes = outcome.effects.filter(e => e.textKey);
    this.outcomeEffectsEl.replaceChildren(...chips.map(effectChip));
    this.outcomeNotesEl.replaceChildren(...notes.map(e => el('p', {
      text: t(e.textKey!),
      attrs: { style: 'margin:0;font:400 11px/1.5 var(--bsx-font-ui);color:var(--bsx-text-muted)' },
    })));

    this.dismissBtn.style.display = '';
  }

  dispose(): void { this.overlay.remove(); }
}
