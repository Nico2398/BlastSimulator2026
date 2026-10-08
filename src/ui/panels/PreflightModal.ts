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
import { totalChargeKg } from '../../core/mining/BlastCalc.js';
import { estimateBlastOreValue } from '../../core/mining/BlastValueEstimate.js';
import { plannedChargesCost } from '../../core/mining/ChargePlan.js';
import { wetHoles } from '../../core/mining/WetHoles.js';
import { computeDangerZone, countZoneOccupants } from '../../core/entities/Zone.js';
import { detonationPhase, type DetonationPhase } from '../../core/engine/DetonationSequence.js';
import { BLAST_DANGER_MARGIN_M } from '../../core/config/balance.js';
import type { WeatherState } from '../../core/weather/WeatherCycle.js';
import type { GameState } from '../../core/state/GameState.js';
import type { GameConsoleFn } from '../gameConsole.js';


interface Warning { ok: boolean; text: string }

export class PreflightModal {
  private readonly overlay: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly predictedEl: HTMLElement;
  private readonly warningsEl: HTMLElement;
  private readonly detonateBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;
  private readonly waitingEl: HTMLElement;
  private readonly refusalEl: HTMLElement;
  private readonly footerEl: HTMLElement;
  private readonly fireAnywayBtn: HTMLButtonElement;
  private readonly cancelDetonationBtn: HTMLButtonElement;

  private gameConsole?: GameConsoleFn;
  private open = false;
  /** True once DETONATE was pressed: the modal closes when the sequence ends (#1362). */
  private awaitingDetonation = false;
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

    this.waitingEl = el('div');
    this.waitingEl.style.cssText = 'display:none;flex-direction:column;gap:6px;padding:11px;border:1px solid rgba(255,91,76,.4);border-radius:5px;background:rgba(255,91,76,.06)';

    this.refusalEl = el('div');
    this.refusalEl.style.cssText = 'font:400 12px/1.45 var(--bsx-font-ui);color:var(--bsx-critical-text)';
    this.refusalEl.dataset['role'] = 'preflight-refusal';

    body.append(this.refusalEl, this.waitingEl, this.statsEl, this.predictedEl, this.warningsEl);

    const footer = el('div');
    this.footerEl = footer;
    footer.style.cssText = 'padding:14px 20px;background:var(--bsx-well);border-top:1px solid var(--bsx-hairline);display:flex;gap:9px';
    this.cancelBtn = el('button', { className: 'bsx-btn' });
    this.cancelBtn.style.cssText = 'flex:1;height:40px';
    this.cancelBtn.dataset['action'] = 'preflight-cancel';
    this.locale.bindText(this.cancelBtn, 'ui.blast_workshop.preflight.cancel');
    this.cancelBtn.addEventListener('click', () => this.hide());

    // Waiting-state buttons (#1362): blast with people still inside, or abort.
    this.fireAnywayBtn = el('button', { className: 'bsx-btn bsx-btn-danger-solid' });
    this.fireAnywayBtn.style.cssText = 'flex:1.6;height:40px';
    this.fireAnywayBtn.dataset['action'] = 'preflight-fire-anyway';
    this.locale.bindText(this.fireAnywayBtn, 'ui.blast_workshop.preflight.fire_anyway');
    this.fireAnywayBtn.addEventListener('click', () => this.gameConsole?.('blast'));
    this.cancelDetonationBtn = el('button', { className: 'bsx-btn' });
    this.cancelDetonationBtn.style.cssText = 'flex:1;height:40px';
    this.cancelDetonationBtn.dataset['action'] = 'preflight-cancel-detonation';
    this.locale.bindText(this.cancelDetonationBtn, 'ui.blast_workshop.preflight.cancel_detonation');
    this.cancelDetonationBtn.addEventListener('click', () => this.gameConsole?.('blast cancel'));

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

    footer.append(this.cancelBtn, this.detonateBtn);
    box.append(stripe, header, body, footer);
    this.overlay.appendChild(box);
    container.appendChild(this.overlay);
  }

  get root(): HTMLElement { return this.overlay; }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  show(): void { this.open = true; this.awaitingDetonation = false; this.refusalEl.textContent = ''; this.overlay.style.display = ''; this.lastSignature = ''; }
  hide(): void { this.open = false; this.overlay.style.display = 'none'; }
  get visible(): boolean { return this.open; }

  update(state: GameState, _weather?: WeatherState): void {
    if (!this.open) return;

    // DETONATE keeps the modal open while armed; it closes once the sequence
    // has ended (fired or cancelled), whichever way (#1362).
    const phase = detonationPhase(state);
    if (phase.kind !== 'idle') this.awaitingDetonation = true;
    else if (this.awaitingDetonation) { this.hide(); return; }

    const plan = assembleBlastPlan(state.drillHoles, state.chargesByHole);
    const planCost = plannedChargesCost(state.chargesByHole);
    const chargeKg = totalChargeKg(plan.holes, plan.charges);
    const estValue = estimateBlastOreValue(plan, state.surveyResults);

    const wet = wetHoles(state);
    const zone = computeDangerZone(state.drillHoles, BLAST_DANGER_MARGIN_M);
    const occupantCount = zone ? countZoneOccupants(zone, state.vehicles, state.employees) : 0;
    const protectedHoles = checkProtectedPositions(state.drillHoles, state.buildings.buildings);
    const loadingHoleIds = new Set(Object.keys(state.plannedChargesByHole));
    const validationErrors = validateBlastPlan(plan, loadingHoleIds);
    const loadingCount = state.drillHoles.filter(h => loadingHoleIds.has(h.id) && !state.chargesByHole[h.id]).length;

    // Warning only, never a detonate gate: firing cancels these drill orders (#1346).
    const undrilledCount = state.plannedDrillHoles.length;

    const signature = JSON.stringify({
      undrilledCount, holes: state.drillHoles.length, chargeKg, planCost, estValue,
      preview: state.lastBlastPreview, wetCount: wet.length, occupantCount,
      phase, protectedCount: protectedHoles.length, loadingCount, errorCount: validationErrors.length,
    });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.renderWaiting(phase);
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
      ...(undrilledCount > 0
        ? [{ ok: false, text: t('ui.blast_workshop.preflight.warn_undrilled', { count: undrilledCount }) }]
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
    const result = this.gameConsole?.('blast detonate');
    this.refusalEl.textContent = result && !result.success ? result.output : '';
    if (result?.success) this.awaitingDetonation = true;
  }

  /** Swap the footer and body between the pre-flight and the waiting state. */
  private renderWaiting(phase: DetonationPhase): void {
    const waiting = phase.kind !== 'idle';
    // Only the controls of the current state exist in the DOM.
    this.footerEl.replaceChildren(...(waiting
      ? [this.cancelDetonationBtn, this.fireAnywayBtn]
      : [this.cancelBtn, this.detonateBtn]));
    this.waitingEl.style.display = waiting ? 'flex' : 'none';
    if (!waiting) { this.waitingEl.replaceChildren(); return; }
    const body = phase.kind === 'stranded'
      ? t('ui.blast_workshop.preflight.stranded_names', { names: phase.names.join(', ') })
      : t('ui.blast_workshop.preflight.detonating_remaining', { count: phase.kind === 'evacuating' ? phase.remaining : 0 });
    this.waitingEl.replaceChildren(
      el('span', { text: t('ui.blast_workshop.preflight.detonating_title'), attrs: { style: 'font:800 12px/1 var(--bsx-font-ui);letter-spacing:.12em;color:var(--bsx-critical-text)' } }),
      el('span', { text: body, attrs: { style: 'font:400 12px/1.45 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } }),
    );
  }
}
