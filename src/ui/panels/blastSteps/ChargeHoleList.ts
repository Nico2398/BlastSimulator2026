// BlastSimulator2026 — Blast Workshop / Charge step: per-hole charge rows.
//
// Gap G3: `charge hole:<id> explosive:… amount:…kg stemming:…m` is a real
// gameplay command that had no button at all — the Charge step only ever
// exposed CHARGE ALL, so a player could not charge one hole differently from
// the rest while the console could. This is the missing control, shaped like
// the Sequence step's per-hole delay rows (`[data-hole="H1"]
// [data-action="delay-inc"]`): one row per hole keyed by `data-hole`, with its
// own commit button at `[data-hole="H1"] [data-action="charge-hole"]`.
//
// Its own module rather than more of Charge.ts: that file was already over the
// 300-line convention before these rows existed.
//
// The rows carry no charge parameters of their own. The owner passes the
// panel's current product card / amount / stemming values into the dispatch
// (see ChargeStep.chargeHole), so "select, then charge this one" is the same
// gesture as "select, then charge them all".

import { t } from '../../../core/i18n/I18n.js';
import { el, emptyState } from '../../dom.js';
import { iconEl } from '../../icons.js';
import { LocaleTextRegistry } from '../../localeText.js';
import { getExplosive } from '../../../core/world/ExplosiveCatalog.js';
import type { DrillHole } from '../../../core/mining/DrillPlan.js';
import type { HoleCharge } from '../../../core/mining/ChargePlan.js';

/**
 * One hole's charge state, flattened for an owner's render signature. A
 * per-hole charge changes neither the hole list nor any other field a Charge
 * step signature holds, so without this the row a charge was fired from would
 * never repaint.
 */
export function holeChargeSignature(charge: HoleCharge | undefined): string {
  return charge ? `${charge.explosiveId}:${charge.amountKg}:${charge.stemmingM}` : '';
}

export class ChargeHoleList {
  private readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly onCharge: (holeId: string) => void;
  private readonly locale = new LocaleTextRegistry();

  constructor(onCharge: (holeId: string) => void) {
    this.onCharge = onCharge;

    this.el = el('div');
    this.el.style.cssText = 'display:flex;flex-direction:column;gap:10px';

    const header = el('div', { className: 'bsx-section' });
    header.append(
      this.locale.bindText(el('span', { className: 'bsx-section-label' }), 'ui.blast_workshop.charge.holes_section'),
      el('span', { className: 'bsx-section-rule' }),
    );

    this.listEl = el('div');
    // Bounded + independently scrollable, same reasoning as the Charge step's
    // product list and the Sequence step's hole rows: a full plan (16 holes)
    // would otherwise push the tubing block past the panel's fold.
    this.listEl.style.cssText = 'display:flex;flex-direction:column;gap:3px;max-height:160px;overflow-y:auto';

    this.el.append(header, this.listEl);
  }

  get root(): HTMLElement { return this.el; }

  render(
    holes: DrillHole[],
    charges: Record<string, HoleCharge>,
    /** Charges ordered but not yet loaded — the ordered/uncharged row state (#554). Unused until implementer wires it. */
    _plannedCharges?: Record<string, HoleCharge>,
  ): void {
    if (holes.length === 0) {
      this.listEl.replaceChildren(emptyState(t('ui.blast_workshop.charge.no_holes')));
      return;
    }
    this.listEl.replaceChildren(...holes.map(h => this.makeRow(h, charges[h.id])));
  }

  refreshLocale(): void { this.locale.refresh(); }

  private makeRow(hole: DrillHole, charge: HoleCharge | undefined): HTMLElement {
    const charged = charge !== undefined;
    const row = el('div');
    row.style.cssText = [
      'display:flex', 'align-items:center', 'gap:9px', 'height:32px', 'padding:0 10px',
      `border:1px solid ${charged ? 'rgba(79,199,107,.35)' : 'var(--bsx-hairline)'}`,
      'border-radius:4px',
      `background:${charged ? 'rgba(79,199,107,.08)' : 'var(--bsx-card)'}`,
    ].join(';');
    row.dataset['hole'] = hole.id;
    // data-charged, same reasoning as the product cards' data-selected: the
    // charged/uncharged difference lives in a cssText string full of var(...)
    // refs, which jsdom does not reliably reflect back, so the state also gets
    // an explicit attribute a test (and a scenario) can read.
    row.dataset['charged'] = String(charged);

    const tag = el('span', { text: hole.id, attrs: { style: 'font:600 11px/1 var(--bsx-font-mono);color:var(--bsx-ore);width:24px' } });

    const statusStyle = `font:400 10px/1 var(--bsx-font-mono);color:${charged ? 'var(--bsx-text-secondary)' : 'var(--bsx-text-micro)'}`;
    const status = el('span', { attrs: { style: statusStyle } });
    status.textContent = charge ? this.chargedLabel(charge) : t('ui.blast_workshop.charge.hole_uncharged');

    const chargeBtn = el('button', { text: t('ui.blast_workshop.charge.charge_hole') });
    chargeBtn.style.cssText = [
      'margin-left:auto', 'height:22px', 'padding:0 9px', 'border:1px solid var(--bsx-hairline)',
      'border-radius:4px', 'background:transparent', 'color:var(--bsx-text-secondary)',
      'font:700 9px/1 var(--bsx-font-ui)', 'letter-spacing:.09em', 'cursor:pointer',
    ].join(';');
    chargeBtn.dataset['action'] = 'charge-hole';
    chargeBtn.addEventListener('click', () => this.onCharge(hole.id));

    row.append(tag, status);
    if (charged) row.appendChild(el('div', { attrs: { style: 'color:var(--bsx-positive);display:flex' }, children: [iconEl('check', 11)] }));
    row.appendChild(chargeBtn);
    return row;
  }

  private chargedLabel(charge: HoleCharge): string {
    const explosive = getExplosive(charge.explosiveId);
    return t('ui.blast_workshop.charge.hole_charged', {
      amount: charge.amountKg,
      name: explosive ? t(explosive.nameKey) : charge.explosiveId,
    });
  }
}
