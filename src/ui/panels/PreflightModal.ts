// BlastSimulator2026 — Preflight Modal (redesign P4/§5.B)
// The real confirm gate FIRE opens, replacing blastFooter's old ad-hoc
// `.bs-confirm-overlay` dialog. Plan snapshot, the last Preview run (if any),
// and every real pre-blast warning this codebase can already compute:
// holes sitting on a building footprint (checkProtectedPositions — not
// currently enforced by blastCommand itself, so this is the only place a
// player learns about it before firing), wet holes, and who's still
// standing in the danger zone (computeDangerZone + countZoneOccupants, same
// real zone Fire step's occupant list uses).
//
// Kept on the `.bs-confirm-overlay` class (not a new one) so the tutorial
// rail's modal carve-out (tutorialGuide.ts's MODAL_SELECTOR) and
// uiActionProbe's `confirm` region keep resolving it without changes there.

import { t } from '../../core/i18n/I18n.js';
import { el, statGrid } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { assembleBlastPlan, checkProtectedPositions, validateBlastPlan } from '../../core/mining/BlastPlan.js';
import { estimateBlastOreValue } from '../../core/mining/BlastValueEstimate.js';
import { getExplosive } from '../../core/world/ExplosiveCatalog.js';
import { wetHoles } from '../../core/mining/WetHoles.js';
import { computeDangerZone, countZoneOccupants } from '../../core/entities/Zone.js';
import { BLAST_DANGER_MARGIN_M } from '../../core/config/balance.js';
import type { GameState } from '../../core/state/GameState.js';
import type { WeatherState } from '../../core/weather/WeatherCycle.js';
import type { CommandResult } from '../../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

interface Warning { ok: boolean; text: string }

export class PreflightModal {
  private readonly overlay: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly predictedEl: HTMLElement;
  private readonly warningsEl: HTMLElement;
  private readonly detonateBtn: HTMLButtonElement;

  private gameConsole?: GameConsoleFn;
  private open = false;
  private lastSignature = '';
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.overlay = el('div', { className: 'bs-confirm-overlay' });
    this.overlay.style.display = 'none';

    const box = el('div');
    box.style.cssText = 'width:568px;max-width:92vw;max-height:86vh;display:flex;flex-direction:column;border-radius:9px;background:var(--bsx-panel);border:1px solid rgba(255,91,76,.4);box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden';

    const stripe = el('div');
    stripe.style.cssText = 'height:6px;background:repeating-linear-gradient(45deg,#ff5b4c 0 11px,var(--bsx-panel) 11px 22px)';

    const header = el('div');
    header.style.cssText = 'padding:18px 20px;display:flex;align-items:center;gap:11px;border-bottom:1px solid var(--bsx-hairline)';
    const iconChip = el('div', { children: [iconEl('blast', 18)] });
    iconChip.style.cssText = 'width:32px;height:32px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:rgba(255,91,76,.16);color:var(--bsx-critical-text)';
    const titleCol = el('div');
    titleCol.style.cssText = 'display:flex;flex-direction:column;gap:3px';
    titleCol.append(
      this.locale.bindText(el('span', { attrs: { style: 'font:800 15px/1 var(--bsx-font-ui);letter-spacing:.1em' } }), 'ui.blast_workshop.preflight.title'),
      this.locale.bindText(el('span', { attrs: { style: 'font:400 11px/1 var(--bsx-font-ui);color:var(--bsx-text-muted)' } }), 'ui.blast_workshop.preflight.subtitle'),
    );
    header.append(iconChip, titleCol);

    const body = el('div');
    body.style.cssText = 'padding:18px 20px;display:flex;flex-direction:column;gap:14px;overflow-y:auto';

    this.statsEl = el('div');
    this.predictedEl = el('div');
    this.predictedEl.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    this.warningsEl = el('div');
    this.warningsEl.style.cssText = 'display:flex;flex-direction:column;gap:8px';

    body.append(this.statsEl, this.predictedEl, this.warningsEl);

    const footer = el('div');
    footer.style.cssText = 'padding:14px 20px;background:var(--bsx-well);border-top:1px solid var(--bsx-hairline);display:flex;gap:9px';
    const cancelBtn = el('button', { className: 'bsx-btn' });
    cancelBtn.style.cssText = 'flex:1;height:40px';
    cancelBtn.dataset['action'] = 'preflight-cancel';
    this.locale.bindText(cancelBtn, 'ui.blast_workshop.preflight.cancel');
    cancelBtn.addEventListener('click', () => this.hide());

    // bs-btn-danger (legacy class, alongside the bsx- token classes): the
    // tutorial rails' blast-confirm stage target (tutorialStages.ts) and
    // tutorial-interactive.json's blast step both still match on it — without
    // it here, the rails' target selector matches nothing and this button
    // stays pointer-events:none-blocked for the whole guided tutorial.
    this.detonateBtn = el('button', { className: 'bsx-btn bsx-btn-danger-solid bs-btn-danger' });
    this.detonateBtn.style.cssText = 'flex:1.6;height:40px;gap:9px;font:800 12px/1 var(--bsx-font-ui);letter-spacing:.2em';
    this.detonateBtn.dataset['action'] = 'preflight-detonate';
    this.detonateBtn.append(iconEl('blast', 16), this.locale.bindText(el('span'), 'ui.blast_workshop.preflight.detonate'));
    this.detonateBtn.addEventListener('click', () => { if (!this.detonateBtn.disabled) this.detonate(); });

    footer.append(cancelBtn, this.detonateBtn);
    box.append(stripe, header, body, footer);
    this.overlay.appendChild(box);
    container.appendChild(this.overlay);
  }

  get root(): HTMLElement { return this.overlay; }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  show(): void { this.open = true; this.overlay.style.display = ''; this.lastSignature = ''; }
  hide(): void { this.open = false; this.overlay.style.display = 'none'; }
  get visible(): boolean { return this.open; }

  update(state: GameState, weather: WeatherState | undefined): void {
    if (!this.open) return;

    const plan = assembleBlastPlan(state.drillHoles, state.chargesByHole, state.sequenceDelays);
    const planCost = Object.values(state.chargesByHole).reduce((sum, charge) => {
      const explosive = getExplosive(charge.explosiveId);
      return sum + (explosive ? explosive.costPerKg * charge.amountKg : 0);
    }, 0);
    const chargeKg = Object.values(state.chargesByHole).reduce((sum, c) => sum + c.amountKg, 0);
    const estValue = estimateBlastOreValue(plan, state.surveyResults);

    const wet = weather ? wetHoles(state, weather) : [];
    const zone = computeDangerZone(state.drillHoles, BLAST_DANGER_MARGIN_M);
    const occupantCount = zone ? countZoneOccupants(zone, state.vehicles, state.employees) : 0;
    const protectedHoles = checkProtectedPositions(state.drillHoles, state.buildings);
    const loadingHoleIds = new Set(Object.keys(state.plannedChargesByHole));
    const validationErrors = validateBlastPlan(plan, loadingHoleIds);
    const loadingCount = state.drillHoles.filter(h => loadingHoleIds.has(h.id) && !state.chargesByHole[h.id]).length;

    const signature = JSON.stringify({
      holes: state.drillHoles.length, chargeKg, planCost, estValue,
      preview: state.lastBlastPreview, wetCount: wet.length, occupantCount,
      protectedCount: protectedHoles.length, loadingCount, errorCount: validationErrors.length,
    });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.detonateBtn.disabled = validationErrors.length > 0;
    this.detonateBtn.style.cursor = validationErrors.length > 0 ? 'not-allowed' : 'pointer';

    this.statsEl.replaceChildren(statGrid([
      { key: t('ui.blast_workshop.preflight.stat_holes'), value: `${state.drillHoles.length}` },
      { key: t('ui.blast_workshop.preflight.stat_charge'), value: `${chargeKg.toFixed(1)} kg` },
      { key: t('ui.blast_workshop.preflight.stat_cost'), value: `$${formatMoney(planCost)}`, color: 'var(--bsx-critical-text)' },
      { key: t('ui.blast_workshop.preflight.stat_value'), value: `$${formatMoney(estValue)}`, color: 'var(--bsx-positive)' },
    ], 4));

    this.renderPredicted(state);

    const warnings: Warning[] = [
      ...(protectedHoles.length > 0
        ? [{ ok: false, text: t('ui.blast_workshop.preflight.warn_protected', { count: protectedHoles.length, hole: protectedHoles[0]!.holeId }) }]
        : []),
      ...(loadingCount > 0
        ? [{ ok: false, text: t('ui.blast_workshop.preflight.warn_charge_loading', { count: loadingCount }) }]
        : []),
      wet.length > 0
        ? { ok: false, text: t('ui.blast_workshop.preflight.warn_wet', { count: wet.length }) }
        : { ok: true, text: t('ui.blast_workshop.preflight.ok_dry') },
      occupantCount > 0
        ? { ok: false, text: t('ui.blast_workshop.preflight.warn_zone', { count: occupantCount }) }
        : { ok: true, text: t('ui.blast_workshop.preflight.ok_zone') },
    ];
    this.warningsEl.replaceChildren(...warnings.map(w => this.makeWarningRow(w)));
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = '';
  }

  dispose(): void { this.overlay.remove(); }

  private renderPredicted(state: GameState): void {
    const preview = state.lastBlastPreview;
    if (!preview || !preview.energy) {
      this.predictedEl.replaceChildren(el('span', {
        text: t('ui.blast_workshop.preflight.no_preview'),
        attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-micro)' },
      }));
      return;
    }
    const label = el('span', {
      text: t('ui.blast_workshop.preflight.predicted_at_tier', { tier: preview.tier }),
      attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-micro)' },
    });
    const line = el('div');
    line.style.cssText = 'display:flex;gap:16px;font:500 12px/1 var(--bsx-font-mono);color:var(--bsx-text-secondary)';
    line.append(el('span', { text: t('ui.blast_workshop.preflight.predicted_voxels', { count: preview.energy.affectedVoxels }) }));
    if (!preview.fragments) line.appendChild(el('span', { text: t('ui.blast_workshop.preflight.predicted_locked_fragments'), attrs: { style: 'color:var(--bsx-text-micro)' } }));
    if (!preview.projections) line.appendChild(el('span', { text: t('ui.blast_workshop.preflight.predicted_locked_projections'), attrs: { style: 'color:var(--bsx-text-micro)' } }));
    this.predictedEl.replaceChildren(label, line);
  }

  private makeWarningRow(w: Warning): HTMLElement {
    const row = el('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:flex-start';
    row.append(
      el('div', { attrs: { style: `color:${w.ok ? 'var(--bsx-positive)' : 'var(--bsx-amber)'};padding-top:1px` }, children: [iconEl(w.ok ? 'check' : 'warn', 13)] }),
      el('span', { text: w.text, attrs: { style: 'font:400 12px/1.45 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } }),
    );
    return row;
  }

  private detonate(): void {
    this.gameConsole?.('blast');
    this.hide();
  }
}
