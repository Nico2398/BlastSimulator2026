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

import { chargeDeliveryArrivalByHole } from '../../core/mining/ExplosiveStock.js';
import { formatGameClock } from '../formatGameClock.js';
import { formatGameDuration } from '../formatGameDuration.js';
import { t } from '../../core/i18n/I18n.js';
import { el, statGrid } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { assembleBlastPlan, buildingsInBlastReach, checkProtectedPositions, validateBlastPlan } from '../../core/mining/BlastPlan.js';
import { isHazardRating } from '../../core/mining/BlastRatingCaps.js';
import type { BlastPreviewSummary } from '../../core/mining/Software.js';
import { totalChargeKg } from '../../core/mining/BlastCalc.js';
import { oreEstimateView, oreValueColor, oreValueText } from './oreEstimateDisplay.js';
import { OreEstimateMemo } from './oreEstimateMemo.js';
import { WallWarningMemo } from './wallWarningMemo.js';
import { wallWarningText } from './wallWarningText.js';
import { BreakoutWarningMemo } from './breakoutWarningMemo.js';
import { breakoutWarningFor } from './breakoutWarningText.js';
import { recordedChargesCost } from '../../core/mining/ChargePlan.js';
import { rainExposedHoles, wetHoles } from '../../core/mining/WetHoles.js';
import { computeDangerZone, countZoneOccupants } from '../../core/entities/Zone.js';
import { detonationPhase, type DetonationPhase } from '../../core/engine/DetonationSequence.js';
import { BLAST_DANGER_MARGIN_M } from '../../core/config/balance.js';
import { buildingRiskText } from './buildingRiskText.js';
import { permitPreview } from './permitPreview.js';
import type { WeatherState } from '../../core/weather/WeatherCycle.js';
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import type { GameState } from '../../core/state/GameState.js';
import type { GameConsoleFn } from '../gameConsole.js';


interface Warning { ok: boolean; text: string; role?: string; buildingType?: string }

/** The dry-charges row: wet beats rain risk beats all-clear. */
function dryWarning(wetCount: number, rainExposedCount: number): Warning {
  if (wetCount > 0) return { ok: false, text: t('ui.blast_workshop.preflight.warn_wet', { count: wetCount }) };
  if (rainExposedCount > 0) {
    return { ok: false, text: t('ui.blast_workshop.preflight.warn_rain_risk', { count: rainExposedCount }), role: 'preflight-rain-risk' };
  }
  return { ok: true, text: t('ui.blast_workshop.preflight.ok_dry') };
}

/** Warning row when the analysis forecasts a hazardous blast (bad or catastrophic); never gates firing. */
function predictedRatingWarning(preview: BlastPreviewSummary | null): Warning[] {
  const projections = preview?.projections;
  if (!projections || !isHazardRating(projections.predictedRating)) return [];
  return [{
    ok: false,
    role: 'preflight-predicted-rating',
    text: t('ui.blast_workshop.preflight.warn_predicted_rating', {
      rating: t(`blast.rating.${projections.predictedRating}`),
      share: Math.round(projections.thrownShare * 100),
      metres: Math.round(projections.furthestThrowM),
    }),
  }];
}

/** Title and body of the waiting panel for each non-idle detonation phase. */
function waitingText(phase: Exclude<DetonationPhase, { kind: 'idle' }>): { title: string; body: string } {
  switch (phase.kind) {
    case 'held':
      return {
        title: t('ui.blast_workshop.preflight.held_title'),
        body: t('ui.blast_workshop.preflight.held_body', { count: phase.fizzleHoleIds.length, holes: phase.fizzleHoleIds.join(', ') }),
      };
    case 'stranded':
      return {
        title: t('ui.blast_workshop.preflight.detonating_title'),
        body: t('ui.blast_workshop.preflight.stranded_names', { names: phase.names.join(', ') }),
      };
    case 'evacuating':
      return {
        title: t('ui.blast_workshop.preflight.detonating_title'),
        body: t('ui.blast_workshop.preflight.detonating_remaining', { count: phase.remaining }),
      };
    case 'ready':
      return {
        title: t('ui.blast_workshop.preflight.detonating_title'),
        body: t('ui.blast_workshop.preflight.detonating_remaining', { count: 0 }),
      };
  }
}

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
  private gridProvider: () => VoxelGrid | null = () => null;
  private readonly estimateMemo = new OreEstimateMemo();
  private readonly wallMemo = new WallWarningMemo();
  private readonly breakoutMemo = new BreakoutWarningMemo();
  private lastSignature = '';
  private readonly locale = new LocaleTextRegistry();

  /** Supplies the voxel grid the pre-blast estimate reads geometry from (#1703). */
  setGridProvider(fn: () => VoxelGrid | null): void { this.gridProvider = fn; }

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
      this.locale.bindText(el('span', { attrs: { style: 'font:800 15px/1 var(--bsx-font-ui);letter-spacing:.1em;color:var(--bsx-text-primary)' } }), 'ui.blast_workshop.preflight.title'),
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
    this.waitingEl.dataset['role'] = 'preflight-waiting';
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
    const planCost = recordedChargesCost(state.chargesByHole).cashCost;
    const chargeKg = totalChargeKg(plan.holes, plan.charges);
    const estimate = this.estimateMemo.get(state, plan, this.gridProvider());
    const { value: estValue, coverage, brokenVoxels, charged, holeCoverage } = estimate;

    const wallFaces = this.wallMemo.get(state, plan, this.gridProvider());
    const breakoutText = breakoutWarningFor(this.breakoutMemo.get(state, plan, this.gridProvider()), {
      none: 'ui.blast_workshop.preflight.warn_breakout_none',
      partial: 'ui.blast_workshop.preflight.warn_breakout_partial',
    });
    const wet = wetHoles(state);
    const rainExposed = rainExposedHoles(state);
    const zone = computeDangerZone(state.drillHoles, BLAST_DANGER_MARGIN_M);
    const occupantCount = zone ? countZoneOccupants(zone, state.vehicles, state.employees) : 0;
    const protectedHoles = checkProtectedPositions(state.drillHoles, state.buildings.buildings);
    const buildingsAtRisk = buildingsInBlastReach(state.drillHoles, state.chargesByHole, state.buildings.buildings);
    const loadingHoleIds = new Set(Object.keys(state.plannedChargesByHole));
    const deliveryArrivals = chargeDeliveryArrivalByHole(state);
    const validationErrors = validateBlastPlan(plan, loadingHoleIds, deliveryArrivals);
    const awaitingArrivals = validationErrors
      .filter(e => e.issue === 'blast.validation.charge_awaiting_delivery')
      .flatMap(e => (e.arrivalTick === undefined ? [] : [e.arrivalTick]));
    const awaitingCount = awaitingArrivals.length;
    const earliestArrival = awaitingCount > 0 ? Math.min(...awaitingArrivals) : null;
    const loadingCount = validationErrors.filter(e => e.issue === 'blast.validation.charge_loading').length;

    // Warning only, never a detonate gate: firing cancels these drill orders (#1346).
    const undrilledCount = state.plannedDrillHoles.length;

    const permit = permitPreview(state.grade, plan, state.tickCount);

    const signature = JSON.stringify({
      permit, undrilledCount, holes: state.drillHoles.length, chargeKg, planCost, estValue, coverage, brokenVoxels, charged, holeCoverage,
      preview: state.lastBlastPreview, wetCount: wet.length, rainExposedCount: rainExposed.length, occupantCount,
      walls: wallFaces.map(w => wallWarningText(w)), breakoutText, phase, protectedCount: protectedHoles.length, buildingsAtRisk, loadingCount, awaitingCount, earliestArrival, errorCount: validationErrors.length,
    });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    this.renderWaiting(phase);
    this.detonateBtn.disabled = validationErrors.length > 0;
    this.detonateBtn.style.cursor = validationErrors.length > 0 ? 'not-allowed' : 'pointer';

    const oreView = oreEstimateView(estimate);
    this.statsEl.replaceChildren(statGrid([
      { key: t('ui.blast_workshop.preflight.stat_holes'), value: `${state.drillHoles.length}` },
      { key: t('ui.blast_workshop.preflight.stat_charge'), value: `${chargeKg.toFixed(1)} kg` },
      { key: t('ui.blast_workshop.preflight.stat_cost'), value: `$${formatMoney(planCost)}`, color: 'var(--bsx-critical-text)', info: 'preflight-cost' },
      { key: t('ui.blast_workshop.preflight.stat_value'), value: oreValueText(oreView, estValue), color: oreValueColor(oreView) },
    ], 4));
    if (permit) {
      // Cost line under the stats grid, beside the charges cost it adds to.
      const fee = el('div', { text: permit.feeText, attrs: { style: 'margin-top:8px;font:400 12px/1.45 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } });
      fee.dataset['role'] = 'preflight-permit-fee';
      this.statsEl.appendChild(fee);
    }

    this.renderPredicted(state);

    const warnings: Warning[] = [
      ...(protectedHoles.length > 0
        ? [{ ok: false, text: t('ui.blast_workshop.preflight.warn_protected', { count: protectedHoles.length, hole: protectedHoles[0]!.holeId }) }]
        : []),
      ...buildingsAtRisk.map(b => ({ ok: false, text: buildingRiskText(b), role: 'preflight-building-risk', buildingType: b.type })),
      ...(loadingCount > 0
        ? [{ ok: false, text: t('ui.blast_workshop.preflight.warn_charge_loading', { count: loadingCount }) }]
        : []),
      ...(earliestArrival !== null
        ? [{
          ok: false,
          text: t('ui.blast_workshop.preflight.warn_charge_awaiting_delivery', {
            count: awaitingCount,
            when: formatGameClock(earliestArrival),
            duration: formatGameDuration(earliestArrival - state.tickCount),
          }),
        }]
        : []),
      ...(undrilledCount > 0
        ? [{ ok: false, text: t('ui.blast_workshop.preflight.warn_undrilled', { count: undrilledCount }) }]
        : []),
      ...wallFaces.map(w => ({ ok: false, text: wallWarningText(w, 'ui.blast_workshop.preflight.warn_wall_slump'), role: 'preflight-wall-warning' })),
      ...(breakoutText ? [{ ok: false, text: breakoutText, role: 'preflight-breakout-warning' }] : []),
      ...predictedRatingWarning(state.lastBlastPreview),
      dryWarning(wet.length, rainExposed.length),
      occupantCount > 0
        ? { ok: false, text: t('ui.blast_workshop.preflight.warn_zone', { count: occupantCount }) }
        : { ok: true, text: t('ui.blast_workshop.preflight.ok_zone') },
    ];
    const rows = warnings.map(w => this.makeWarningRow(w));
    if (permit) {
      rows.push(this.makeRoleRow('preflight-permit-strikes', true, permit.strikesText));
      if (permit.over) rows.push(this.makeRoleRow('preflight-permit-warning', false, permit.warningText));
    }
    this.warningsEl.replaceChildren(...rows);
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
    const projections = preview.projections;
    if (!projections) {
      line.appendChild(el('span', { text: t('ui.blast_workshop.preflight.predicted_locked_projections'), attrs: { style: 'color:var(--bsx-text-micro)' } }));
    } else {
      line.append(
        el('span', { text: t('ui.blast_workshop.preflight.predicted_rating', { rating: t(`blast.rating.${projections.predictedRating}`) }) }),
        el('span', { text: t('ui.blast_workshop.preflight.predicted_thrown_share', { share: Math.round(projections.thrownShare * 100) }) }),
        el('span', { text: t('ui.blast_workshop.preflight.predicted_furthest_throw', { metres: Math.round(projections.furthestThrowM) }) }),
      );
    }
    this.predictedEl.replaceChildren(label, line);
  }

  private makeRoleRow(role: string, ok: boolean, text: string): HTMLElement {
    const row = this.makeWarningRow({ ok, text });
    row.dataset['role'] = role;
    return row;
  }

  private makeWarningRow(w: Warning): HTMLElement {
    const row = el('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:flex-start';
    row.append(
      el('div', { attrs: { style: `color:${w.ok ? 'var(--bsx-positive)' : 'var(--bsx-amber)'};padding-top:1px` }, children: [iconEl(w.ok ? 'check' : 'warn', 13)] }),
      el('span', { text: w.text, attrs: { style: 'font:400 12px/1.45 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } }),
    );
    if (w.role) row.dataset['role'] = w.role;
    if (w.buildingType) row.dataset['buildingType'] = w.buildingType;
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
    if (!waiting) { this.waitingEl.replaceChildren(); delete this.waitingEl.dataset['phase']; return; }
    this.waitingEl.dataset['phase'] = phase.kind;
    const { title, body } = waitingText(phase);
    this.waitingEl.replaceChildren(
      el('span', { text: title, attrs: { style: 'font:800 12px/1 var(--bsx-font-ui);letter-spacing:.12em;color:var(--bsx-critical-text)' } }),
      el('span', { text: body, attrs: { style: 'font:400 12px/1.45 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } }),
    );
  }
}
