// BlastSimulator2026 — Charge step: the tier-4 charge optimizer block (#2204)
// "Optimize charges" computes a proposal on click; nothing is ordered until the player applies it,
// to every hole at once or hole by hole. Below tier 4 the block only names the software that unlocks it.

import { t } from '../../../core/i18n/I18n.js';
import { el, button } from '../../dom.js';
import { bandMixEl } from '../../bandMix.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { SOFTWARE_TIER_OPTIMIZER } from '../../../core/config/balance.js';
import { previewChargeOptimization } from '../../../core/mining/Software.js';
import { optimizerOptionsFor, type ChargeProposal } from '../../../core/mining/ChargeOptimizer.js';
import type { HoleCharge } from '../../../core/mining/ChargePlan.js';
import { getExplosive } from '../../../core/world/ExplosiveCatalog.js';
import type { GameState } from '../../../core/state/GameState.js';
import type { VoxelGrid } from '../../../core/world/VoxelGrid.js';

const SECTION_STYLE = 'display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--bsx-hairline);border-radius:5px;background:var(--bsx-card)';
const TEXT_STYLE = 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary)';
const MONO_STYLE = 'font:500 11px/1.4 var(--bsx-font-mono);color:var(--bsx-text-muted)';

/** The command that orders one proposed charge, the same one the hole row and Charge All send. */
function chargeCommand(holeId: string, c: HoleCharge): string {
  return `charge hole:${holeId} explosive:${c.explosiveId} amount:${c.amountKg}kg stemming:${c.stemmingM}m`;
}

export class ChargeOptimizerBlock {
  readonly root: HTMLElement;
  private proposal: ChargeProposal | null = null;
  /** Stemming and holes the proposal was computed for: a different pattern makes it stale. */
  private proposalKey = '';

  constructor(private readonly send: (cmd: string) => void) {
    this.root = el('div', { attrs: { 'data-role': 'charge-optimizer' } });
  }

  /** Repaint from the stored proposal; computes nothing. */
  render(state: GameState, stemmingM: number, grid: VoxelGrid | null): void {
    const holes = state.drillHoles;
    if (state.softwareTier < SOFTWARE_TIER_OPTIMIZER) {
      this.proposal = null;
      const hint = el('div', { text: t('ui.blast_workshop.optimizer.locked', { tier: SOFTWARE_TIER_OPTIMIZER, name: t('ui.blast_workshop.preview.tier_4') }), attrs: { style: TEXT_STYLE } });
      hint.dataset['role'] = 'optimizer-locked';
      this.root.replaceChildren(hint);
      return;
    }
    if (holes.length === 0 || !grid) {
      this.proposal = null;
      this.root.replaceChildren();
      return;
    }
    const key = `${stemmingM}|${holes.map(h => `${h.id}:${h.depth}:${h.diameter}`).join(',')}`;
    if (key !== this.proposalKey) this.proposal = null;

    const optimize = button('ghost', t('ui.blast_workshop.optimizer.optimize'), {
      dataAction: 'optimize-charges',
      onClick: () => {
        this.proposal = previewChargeOptimization(holes, grid, state.softwareTier, optimizerOptionsFor(state, stemmingM));
        this.proposalKey = key;
        this.render(state, stemmingM, grid);
      },
    });
    const children: HTMLElement[] = [optimize];
    if (this.proposal) children.push(this.proposalEl(this.proposal));
    this.root.replaceChildren(...children);
  }

  private proposalEl(p: ChargeProposal): HTMLElement {
    const ids = Object.keys(p.charges);
    const wrap = el('div', { attrs: { 'data-role': 'charge-proposal', style: SECTION_STYLE } });
    if (p.bandShares) wrap.appendChild(bandMixEl(p.bandShares, 'proposal-band-mix'));
    const cost = el('div', { text: t('ui.blast_workshop.optimizer.cost', { cost: `$${formatMoney(p.cost)}` }), attrs: { style: MONO_STYLE } });
    cost.dataset['role'] = 'proposal-cost';
    const kg = el('div', {
      text: Number.isFinite(p.permitKgLimit)
        ? t('ui.blast_workshop.optimizer.permit_kg', { kg: +p.totalKg.toFixed(1), limit: p.permitKgLimit })
        : t('ui.blast_workshop.optimizer.total_kg', { kg: +p.totalKg.toFixed(1) }),
      attrs: { style: `${MONO_STYLE};${p.withinPermit ? '' : 'color:var(--bsx-amber)'}` },
    });
    kg.dataset['role'] = 'proposal-permit-kg';
    wrap.append(cost, kg);
    if (!p.withinPermit) wrap.appendChild(el('div', { text: t('ui.blast_workshop.optimizer.over_permit'), attrs: { style: `${TEXT_STYLE};color:var(--bsx-amber)` } }));
    if (p.skippedHoleIds.length > 0) {
      wrap.appendChild(el('div', { text: t('ui.blast_workshop.optimizer.skipped', { holes: p.skippedHoleIds.join(', ') }), attrs: { style: TEXT_STYLE } }));
    }

    const applyAll = button('primary', t('ui.blast_workshop.optimizer.apply_all', { count: ids.length }), {
      dataAction: 'apply-proposal',
      disabled: ids.length === 0,
      onClick: () => { for (const id of ids) this.send(chargeCommand(id, p.charges[id]!)); },
    });
    wrap.appendChild(applyAll);
    for (const id of ids) wrap.appendChild(this.holeRow(id, p));
    return wrap;
  }

  private holeRow(id: string, p: ChargeProposal): HTMLElement {
    const c = p.charges[id]!;
    const explosive = getExplosive(c.explosiveId);
    const row = el('div', { attrs: { 'data-role': 'proposal-hole', style: 'display:flex;flex-direction:column;gap:3px' } });
    row.dataset['hole'] = id;
    const head = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' } });
    head.append(
      el('span', {
        text: t('ui.blast_workshop.optimizer.hole_line', { hole: id, explosive: explosive ? t(explosive.nameKey) : c.explosiveId, amount: c.amountKg }),
        attrs: { style: `${TEXT_STYLE};flex:1` },
      }),
      button('ghost', t('ui.blast_workshop.optimizer.apply_hole'), {
        dataAction: 'apply-proposal-hole',
        onClick: () => this.send(chargeCommand(id, c)),
      }),
    );
    row.appendChild(head);
    const mix = p.holeMixes[id];
    if (mix) row.appendChild(bandMixEl(mix, 'proposal-hole-band-mix'));
    return row;
  }
}
