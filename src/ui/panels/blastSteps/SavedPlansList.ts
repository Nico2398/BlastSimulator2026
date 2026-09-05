// BlastSimulator2026 — Blast Workshop / Drill step: saved blast plans.
//
// Gap G6: `blast_plan save [name:<n>]` / `blast_plan load [name:<n>]` are real
// gameplay commands — they snapshot and restore the holes, charges and delays
// a player just built — and had no button anywhere in the UI. A plan could be
// saved from the console and never from the game, which the project treats as
// a bug, not a missing convenience.
//
// Shaped like the Charge step's per-hole rows (ChargeHoleList): the owner
// passes callbacks in and keeps the dispatch itself, one row per saved plan
// keyed by `data-plan`, each with its own commit button at
// `[data-plan="<name>"] [data-action="load-plan"]`. Its own module rather than
// more of Drill.ts, which was already past the 300-line convention.
//
// The name field is a plain input, not a modal: SAVE has to be clickable with
// zero typing (an empty field saves under the console's own default name), so
// a scenario can click it directly.

import { t } from '../../../core/i18n/I18n.js';
import { el, emptyState, scrollBoundedSection } from '../../dom.js';
import { iconEl } from '../../icons.js';
import { LocaleTextRegistry } from '../../localeText.js';
import type { SavedBlastPlan } from '../../../core/state/GameState.js';

/** Name `blast_plan save|load` falls back to when `name:` is omitted (console/commands/mining.ts). */
export const DEFAULT_PLAN_NAME = 'default';

/**
 * A typed name reduced to a token the console's `name:<value>` argument can
 * actually carry — the command line is split on whitespace and each field on
 * its first `:`, so an unsanitised "my plan" would save under "my" and lose
 * the rest silently. An empty field yields the command's own default, which is
 * what makes SAVE work with no typing at all.
 */
export function sanitizePlanName(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '');
  return cleaned === '' ? DEFAULT_PLAN_NAME : cleaned;
}

/**
 * Saved-plan state flattened for an owner's render signature. Saving a plan
 * changes neither the hole list nor any other field the Drill step's signature
 * holds, so without this the list a save just landed in would never repaint.
 */
export function savedPlansSignature(plans: Record<string, SavedBlastPlan>): string {
  return Object.entries(plans)
    .map(([name, plan]) => `${name}:${plan.drillHoles.length}:${Object.keys(plan.chargesByHole).length}`)
    .join('|');
}

export class SavedPlansList {
  private readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly onSave: (name: string) => void;
  private readonly onLoad: (name: string) => void;
  private readonly locale = new LocaleTextRegistry();

  constructor(onSave: (name: string) => void, onLoad: (name: string) => void) {
    this.onSave = onSave;
    this.onLoad = onLoad;

    this.el = el('div');
    this.el.style.cssText = 'display:flex;flex-direction:column;gap:8px';

    const header = el('div', { className: 'bsx-section' });
    header.append(
      this.locale.bindText(el('span', { className: 'bsx-section-label' }), 'ui.blast_workshop.drill.saved_section'),
      el('span', { className: 'bsx-section-rule' }),
    );

    this.nameInput = el('input', {
      className: 'bs-input',
      attrs: { type: 'text', maxlength: '24', 'data-field': 'plan-name' },
    }) as HTMLInputElement;
    this.nameInput.style.cssText = 'flex:1;height:28px;font:400 11px/1 var(--bsx-font-mono)';
    this.applyPlaceholder();

    const saveBtn = el('button', { className: 'bsx-btn' });
    saveBtn.style.cssText = 'height:28px;flex:0 0 auto';
    saveBtn.dataset['action'] = 'save-plan';
    saveBtn.append(iconEl('save', 12), this.locale.bindText(el('span'), 'ui.blast_workshop.drill.save_plan'));
    saveBtn.addEventListener('click', () => this.onSave(sanitizePlanName(this.nameInput.value)));

    const saveRow = el('div', { children: [this.nameInput, saveBtn] });
    saveRow.style.cssText = 'display:flex;gap:7px;align-items:center';

    // Bounded + independently scrollable, same reasoning as the Sequence step's
    // hole rows: a long-running site accumulates saved plans, and they must not
    // push the hole list past the panel's fold.
    this.listEl = scrollBoundedSection([], 120, { gap: 3 });

    this.el.append(header, saveRow, this.listEl);
  }

  get root(): HTMLElement { return this.el; }

  render(plans: Record<string, SavedBlastPlan>): void {
    const names = Object.keys(plans);
    if (names.length === 0) {
      this.listEl.replaceChildren(emptyState(t('ui.blast_workshop.drill.no_saved_plans')));
      return;
    }
    this.listEl.replaceChildren(...names.map(name => this.makeRow(name, plans[name]!)));
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.applyPlaceholder();
  }

  /** The placeholder is an attribute, which LocaleTextRegistry does not bind — re-applied by hand on a language switch. */
  private applyPlaceholder(): void {
    this.nameInput.placeholder = t('ui.blast_workshop.drill.plan_name');
  }

  private makeRow(name: string, plan: SavedBlastPlan): HTMLElement {
    const row = el('div');
    row.style.cssText = 'display:flex;align-items:center;gap:9px;height:30px;padding:0 10px;border:1px solid var(--bsx-hairline);border-radius:4px;background:var(--bsx-card)';
    row.dataset['plan'] = name;

    const tag = el('span', { text: name, attrs: { style: 'font:600 11px/1 var(--bsx-font-mono);color:var(--bsx-ore);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px' } });
    const summary = el('span', {
      text: t('ui.blast_workshop.drill.saved_plan_summary', {
        holes: plan.drillHoles.length,
        charges: Object.keys(plan.chargesByHole).length,
      }),
      attrs: { style: 'font:400 10px/1 var(--bsx-font-mono);color:var(--bsx-text-micro)' },
    });

    const loadBtn = el('button', { text: t('ui.blast_workshop.drill.load_plan') });
    loadBtn.style.cssText = [
      'margin-left:auto', 'height:22px', 'padding:0 9px', 'border:1px solid var(--bsx-hairline)',
      'border-radius:4px', 'background:transparent', 'color:var(--bsx-text-secondary)',
      'font:700 9px/1 var(--bsx-font-ui)', 'letter-spacing:.09em', 'cursor:pointer',
    ].join(';');
    loadBtn.dataset['action'] = 'load-plan';
    loadBtn.addEventListener('click', () => this.onLoad(name));

    row.append(tag, summary, loadBtn);
    return row;
  }
}
