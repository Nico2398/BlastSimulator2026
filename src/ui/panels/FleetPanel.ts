// BlastSimulator2026 — Fleet panel (redesign P6)
// Traffic advisory banner, then one card per vehicle: name/id/role, status
// chip, HP gauge, LOAD gauge (haulers only), driver row or no-driver status
// (licence warning or "unmanned" — display-only since #921), REPOSITION
// (pick a tile in the scene, then `vehicle reposition`), SCRAP (confirm,
// real residual value). Both Haul and Break are
// self-dispatching now (#552, #618) — there is no button for either; a
// qualified idle employee/driver auto-claims the free vehicle and does the
// work on its own.
// DEALERSHIP below the roster: every role/tier with a real stat-multiplier
// line from VEHICLE_TIER_MULTIPLIERS, dispatching `vehicle buy`.
//
// Root id and the dealership buttons' [data-vtype]/[data-tier] are preserved
// from the old VehiclePanel so tutorialStages.ts, uiActionProbe.ts, and the
// tutorial/scenario defs keep resolving unchanged — same convention
// ContractsPanel.ts already established for #bs-contract-panel in P5.

import { PanelBase } from './PanelBase.js';
import { t } from '../../core/i18n/I18n.js';
import { el, card, button, sectionHeader, panelRoot, panelHeader, panelBody, scrollBoundedSection } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { GameState } from '../../core/state/GameState.js';
import type { Vehicle, VehicleRole, VehicleTier } from '../../core/entities/Vehicle.js';
import type { Employee } from '../../core/entities/Employee.js';
import { computeScrapResidualValue, getAllVehicleRoles, getVehicleDefByTier, vehicleDriverId, ROLE_LICENCE_REQUIRED } from '../../core/entities/Vehicle.js';
import { isLicensedForRole } from '../../core/engine/VehicleReservation.js';
import { VEHICLE_TIER_MULTIPLIERS } from '../../core/config/balance.js';
import { computeTrafficAdvisory } from '../../core/events/EventEngine.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { vehicleDisplayName, makeStatusChip, makeHpGauge, makeLoadGauge, makeDriverRow, makeNoDriverRow, makePendingDriverRow } from '../fleetDetailSections.js';
import type { ConfirmModalConfig } from './ConfirmModal.js';
import type { GameConsoleFn } from '../gameConsole.js';
import type { PlacementKit } from '../scene/PlacementKit.js';
import { placementRefusalReason } from '../scene/PlacementKit.js';


export class FleetPanel extends PanelBase {
  private readonly bodyEl: HTMLElement;
  private onNavigateCb?: (panel: 'crew') => void;
  private gameConsole?: GameConsoleFn;
  private onConfirmRequestCb?: (config: ConfirmModalConfig) => void;
  private onSelectVehicleCb?: (vehicleId: number) => void;
  private lastSignature = '';
  private lastState: GameState | null = null;
  private readonly locale = new LocaleTextRegistry();
  /** Shared in-scene placement tool (#1092), for the "Reposition" click flow — armed by each card's Reposition button, same pattern as `SurveyPanel.pickTargetAndRun`. */
  private placementKit: PlacementKit | null = null;

  constructor(container: HTMLElement) {
    super(panelRoot('bs-vehicle-panel'));

    const { header, titleEl } = panelHeader({
      icon: 'vehicle',
      accent: 'info',
      onClose: () => this.onCloseCb?.(),
    });
    this.locale.bindText(titleEl, 'ui.fleet.title');

    this.bodyEl = panelBody(9);

    this.el.append(header, this.bodyEl);
    container.appendChild(this.el);
  }

  setNavigateHandler(cb: (panel: 'crew') => void): void { this.onNavigateCb = cb; }
  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }
  setConfirmHandler(cb: (config: ConfirmModalConfig) => void): void { this.onConfirmRequestCb = cb; }

  /** Register a callback fired when a vehicle's Fleet panel row is clicked to select it. */
  setSelectVehicleHandler(cb: (vehicleId: number) => void): void { this.onSelectVehicleCb = cb; }

  setPlacementKit(kit: PlacementKit): void { this.placementKit = kit; }

  /**
   * Arms the shared placement tool to pick a parking spot for `vehicleId`,
   * the "Reposition" click flow's entry point — same pattern as
   * `SurveyPanel.pickTargetAndRun`: arm on click, dispatch
   * `vehicle reposition <id> <x> <z>` via `this.gameConsole` on confirm.
   * Pre-selects the vehicle's own tile so Confirm is reachable immediately
   * and the player can see which vehicle the strip is talking about.
   */
  requestReposition(vehicleId: number): void {
    const kit = this.placementKit;
    if (!kit) return;
    const { controller, overlay, strip } = kit;
    if (controller.isArmed) { controller.cancel(); return; }

    const vehicle = this.lastState?.vehicles.vehicles.find(v => v.id === vehicleId);
    const subtitle = vehicle ? vehicleDisplayName(vehicle.type, vehicle.tier) : `#${vehicleId}`;

    const refresh = (): void => {
      if (controller.currentPhase === 'idle') { overlay.clear(); strip.hide(); return; }
      const sel = controller.selection;
      overlay.update(sel ? { shape: 'point', x: sel.x1, z: sel.z1 } : null);
      strip.show({
        icon: 'vehicle',
        title: t('ui.fleet.reposition_pick_target'),
        subtitle,
        fields: [],
        result: sel ? `(${sel.x1}, ${sel.z1})` : '—',
        confirmEnabled: controller.canConfirm,
        confirmDisabledReason: placementRefusalReason(controller),
        instruction: t('ui.fleet.reposition_pick_instruction'),
      });
    };

    controller.setConfirmHandler((sel) => {
      this.gameConsole?.(`vehicle reposition ${vehicleId} ${sel.x1} ${sel.z1}`);
      overlay.flashConfirm();
    });
    controller.setChangeHandler(refresh);
    controller.arm({
      shape: 'point',
      ...(vehicle ? { initialSelection: { x: Math.round(vehicle.x), z: Math.round(vehicle.z) } } : {}),
    });
    refresh();
  }


  update(state: GameState): void {
    this.lastState = state;

    const signature = this.computeSignature(state);
    if (signature === this.lastSignature) {
      this.refreshDynamic(state);
      this.refreshDealershipAffordability(state.cash);
      return;
    }
    this.lastSignature = signature;
    this.render(state);
    this.refreshDealershipAffordability(state.cash);
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = '';
    if (this.lastState) this.update(this.lastState);
  }


  /**
   * Structural facts only: which cards exist, whether each has a driver
   * (swaps the driver row for the no-driver row), and who is eligible to
   * drive (changes the no-driver row's licence warning). HP, load, status,
   * and the traffic banner all drift on their own — refreshDynamic patches
   * those in place so an in-progress board-walk or Haul/Scrap click survives.
   */
  private computeSignature(state: GameState): string {
    // reservedForActionId is part of the signature too (#1092): it decides
    // whether the card's Reposition button renders enabled or refused.
    const rows = state.vehicles.vehicles
      .map(v => `${v.id}:${v.type}:${v.tier}:${vehicleDriverId(v) ?? '-'}:${v.reservedForActionId ?? '-'}`).join('|');
    // pendingDriverVehicleId, not just the driver seat: VehicleReservation's
    // automatic claim sets it immediately, but the seat itself stays empty
    // for the whole walk to the vehicle (the board arrival step fills it).
    // Omitting it here let every OTHER vehicle's already-rendered
    // no-driver row go stale the moment one claim took an employee, until
    // some unrelated structural change (a further purchase) happened to
    // force a fresh render — #715.
    const quals = state.employees.employees.filter(e => e.alive)
      .map(e => `${e.id}:${e.qualifications.map(q => q.category).join(',')}:${e.pendingDriverVehicleId ?? '-'}`).join('|');
    return `${rows}#${quals}`;
  }

  private refreshDynamic(state: GameState): void {
    const banner = this.makeTrafficBanner(state);
    if (banner) this.bodyEl.querySelector('.bs-fleet-traffic')?.replaceWith(this.tag(banner, 'bs-fleet-traffic'));
    else this.bodyEl.querySelector('.bs-fleet-traffic')?.remove();

    for (const v of state.vehicles.vehicles) {
      const row = this.bodyEl.querySelector<HTMLElement>(`[data-vehicle-id="${v.id}"]`);
      if (!row) continue;
      row.querySelector('.bs-fleet-status')?.replaceWith(this.tag(makeStatusChip(v, this.occupantOf(v, state)), 'bs-fleet-status'));
      row.querySelector('.bs-fleet-hp')?.replaceWith(this.tag(makeHpGauge(v), 'bs-fleet-hp'));
      const load = makeLoadGauge(v);
      const existingLoad = row.querySelector('.bs-fleet-load');
      if (load && existingLoad) existingLoad.replaceWith(this.tag(load, 'bs-fleet-load'));
    }
  }

  /** The employee in `v`'s driver seat, for the occupant-derived status line (#1092) — undefined when nobody is aboard. */
  private occupantOf(v: Vehicle, state: GameState): Employee | undefined {
    const driverId = vehicleDriverId(v);
    return driverId === null ? undefined : state.employees.employees.find(e => e.id === driverId);
  }

  private tag(elToTag: HTMLElement, className: string): HTMLElement {
    elToTag.classList.add(className);
    return elToTag;
  }

  private makeTrafficBanner(state: GameState): HTMLElement | null {
    const advisories = computeTrafficAdvisory(state.vehicles.vehicles);
    if (advisories.length === 0) return null;
    const worst = advisories.reduce((a, b) => (b.count > a.count ? b : a));
    const banner = el('div', { attrs: { style: 'display:flex;gap:8px;padding:9px 11px;border-radius:5px;background:rgba(255,176,46,.08);border:1px solid rgba(255,176,46,.26)' } });
    banner.append(
      el('div', { attrs: { style: 'color:var(--bsx-amber)' }, children: [iconEl('warn', 14)] }),
      el('span', {
        text: t('ui.fleet.traffic_advisory', { count: worst.count, x: worst.targetX, z: worst.targetZ }),
        attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary);flex:1' },
      }),
    );
    return banner;
  }

  private render(state: GameState): void {
    const { vehicles } = state.vehicles;
    const children: HTMLElement[] = [];
    const banner = this.makeTrafficBanner(state);
    if (banner) children.push(this.tag(banner, 'bs-fleet-traffic'));

    const vehicleCards = vehicles.length === 0
      ? [el('div', { className: 'bsx-empty', text: t('ui.fleet.none') })]
      : vehicles.map(v => this.makeVehicleCard(v, state));
    children.push(scrollBoundedSection(vehicleCards, 200, { gap: 9 }));
    children.push(sectionHeader(t('ui.fleet.dealership')), ...this.makeDealershipRows(state.cash));
    this.bodyEl.replaceChildren(...children);
  }

  // ── Dealership ──

  private makeDealershipRows(cash: number): HTMLElement[] {
    return getAllVehicleRoles().map(role => {
      const group = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:5px' } });
      group.appendChild(el('span', { text: t(`vehicle_type.${role}`), attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.1em;color:var(--bsx-text-secondary)' } }));
      const tiers: VehicleTier[] = [1, 2, 3];
      for (const tier of tiers) group.appendChild(this.makeTierButton(role, tier, cash));
      return group;
    });
  }

  private makeTierButton(role: VehicleRole, tier: VehicleTier, cash: number): HTMLElement {
    const def = getVehicleDefByTier(role, tier);
    const m = VEHICLE_TIER_MULTIPLIERS[tier];
    const btn = el('button', {
      className: 'bs-fleet-tier-btn',
      attrs: { style: 'display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid var(--bsx-hairline);border-radius:5px;background:var(--bsx-card);cursor:pointer;text-align:left', 'data-role': role, 'data-tier': String(tier), 'data-vtype': role },
    });
    const info = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0' } });
    info.append(
      el('span', { text: t(getVehicleDefByTier(role, tier).nameKey), attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
      el('span', {
        text: t('ui.fleet.tier_stats', { speed: m.speed.toFixed(1), capacity: m.capacity.toFixed(1), work: m.workRate.toFixed(1) }),
        className: 'bsx-mono',
        attrs: { style: 'font-size:10px;color:var(--bsx-text-micro)' },
      }),
    );
    const cost = el('span', { text: `$${def.purchaseCost.toLocaleString('en-US')}`, className: 'bsx-mono', attrs: { style: 'font-size:11px;font-weight:600;color:var(--bsx-amber)' } });
    btn.append(info, cost);
    this.setTierButtonAffordable(btn, cash >= def.purchaseCost);
    btn.addEventListener('click', () => this.gameConsole?.(`vehicle buy ${role} tier:${tier}`));
    return btn;
  }

  private setTierButtonAffordable(btn: HTMLButtonElement, affordable: boolean): void {
    btn.disabled = !affordable;
    btn.style.opacity = affordable ? '1' : '.45';
    btn.style.cursor = affordable ? 'pointer' : 'not-allowed';
  }

  private refreshDealershipAffordability(cash: number): void {
    this.bodyEl.querySelectorAll<HTMLButtonElement>('.bs-fleet-tier-btn').forEach(btn => {
      const role = btn.dataset['role'] as VehicleRole;
      const tier = Number(btn.dataset['tier']) as VehicleTier;
      this.setTierButtonAffordable(btn, cash >= getVehicleDefByTier(role, tier).purchaseCost);
    });
  }

  private makeVehicleCard(v: Vehicle, state: GameState): HTMLElement {
    const head = el('div', { attrs: { style: 'display:flex;align-items:flex-start;gap:9px' } });
    const iconChip = el('div', { attrs: { style: 'width:26px;height:26px;border-radius:4px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);color:var(--bsx-info)' }, children: [iconEl('vehicle', 14)] });
    const nameCol = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0' } });
    nameCol.append(
      el('div', { attrs: { style: 'display:flex;align-items:baseline;gap:6px' }, children: [
        el('span', { text: vehicleDisplayName(v.type, v.tier), attrs: { style: 'font:600 12px/1 var(--bsx-font-ui);color:var(--bsx-text-primary)' } }),
        el('span', { text: `#${v.id}`, className: 'bsx-mono', attrs: { style: 'font-size:10px;color:var(--bsx-text-micro)' } }),
      ] }),
      el('span', { text: t(`vehicle_type.${v.type}`), attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' } }),
    );
    const locateBtn = el('button', { attrs: { style: 'width:26px;height:26px;display:flex;align-items:center;justify-content:center;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:transparent;color:var(--bsx-text-muted);cursor:pointer' }, children: [iconEl('locate', 12)] });
    locateBtn.addEventListener('click', () => window.__cameraFocus?.(v.x, v.z, 15));
    head.append(iconChip, nameCol, this.tag(makeStatusChip(v, this.occupantOf(v, state)), 'bs-fleet-status'), locateBtn);

    const rows: HTMLElement[] = [head, this.tag(makeHpGauge(v), 'bs-fleet-hp')];
    const load = makeLoadGauge(v);
    if (load) rows.push(this.tag(load, 'bs-fleet-load'));

    // The driver seat stays empty for a driver's whole walk to the vehicle
    // (only the board arrival step fills it), so a pending claim needs its
    // own row — falling through to makeNoDriverRow would re-offer the vehicle
    // as driverless even though someone's already en route to it (#715).
    const driverId = vehicleDriverId(v);
    const pendingDriver = driverId === null
      ? state.employees.employees.find(e => e.pendingDriverVehicleId === v.id)
      : undefined;
    rows.push(
      driverId !== null
        ? makeDriverRow(v, state)
        : pendingDriver
          ? makePendingDriverRow(pendingDriver)
          : makeNoDriverRow(v, state, () => this.onNavigateCb?.('crew')),
    );

    const actions = el('div', { attrs: { style: 'display:flex;gap:6px' } });
    actions.appendChild(this.makeRepositionButton(v, state));
    const scrapBtn = button('danger', '', { icon: 'trash' });
    scrapBtn.style.cssText = 'width:34px;height:28px;padding:0';
    scrapBtn.title = t('ui.fleet.scrap');
    scrapBtn.addEventListener('click', () => this.requestScrap(v));
    actions.appendChild(scrapBtn);
    rows.push(actions);

    const wrap = card(rows);
    wrap.dataset['vehicleId'] = String(v.id);
    // Mirrors the dealership buy buttons' own [data-vtype] (this file's
    // header comment) so a tutorial stage can scope its purchase target to a
    // specific vehicle TYPE, not just "the first matching element in the
    // DOM" — see tutorialStages.ts's 'vehicle-buy-assign' (and
    // tutorialStagesTraining.ts's 'buy-drill-rig-assign'/
    // 'buy-rock-digger-assign') for why that distinction matters (#557
    // follow-up).
    wrap.dataset['vtype'] = v.type;
    wrap.style.cursor = 'pointer';
    wrap.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('button, select, input, a')) return;
      this.onSelectVehicleCb?.(v.id);
    });
    return wrap;
  }

  /**
   * "Reposition": park this vehicle somewhere with no work attached (#1092).
   * Click arms the in-scene point picker (`requestReposition`), and the
   * confirmed tile is dispatched as `vehicle reposition <id> <x> <z>` — the
   * one player-facing path to the itinerary's `reposition` goal.
   *
   * Disabled, with the reason on the button itself, in the two states the
   * console command would refuse anyway: the vehicle is reserved for a task
   * (repositioning it would strand that work), or nobody on the roster holds
   * its licence at all, so no driver could ever be found for it.
   */
  private makeRepositionButton(v: Vehicle, state: GameState): HTMLButtonElement {
    const btn = button('ghost', t('ui.fleet.reposition'), { icon: 'drive' });
    btn.className += ' bs-fleet-reposition-btn';
    btn.style.cssText += ';height:28px;font-size:10px;flex:1';
    // `data-action`, not `data-vehicle-id`: the card wrapper already carries
    // the id, and duplicating the key onto a descendant makes every
    // `[data-vehicle-id]` card query count each card twice. Scoping is by
    // the card's own `[data-vtype]` ancestor — see
    // vehicle-reposition-before-blast.json's own click selector.
    btn.dataset['action'] = 'reposition';

    const reason = v.reservedForActionId !== null
      ? t('ui.fleet.reposition_busy')
      : !state.employees.employees.some(e => e.alive && isLicensedForRole(e, v.type))
        ? t('ui.fleet.no_licensed', { licence: t(`skill.${ROLE_LICENCE_REQUIRED[v.type]}`) })
        : null;

    if (reason !== null) {
      btn.disabled = true;
      btn.title = reason;
      btn.style.opacity = '.45';
      btn.style.cursor = 'not-allowed';
      return btn;
    }

    btn.title = t('ui.fleet.reposition_hint');
    btn.addEventListener('click', () => this.requestReposition(v.id));
    return btn;
  }

  /** destroyVehicle removes the vehicle outright — no reversal — so scrap always confirms first, with the real residual credit shown up front. */
  private requestScrap(v: Vehicle): void {
    const residual = computeScrapResidualValue(v.type, v.tier, v.hp);
    this.onConfirmRequestCb?.({
      icon: 'trash',
      title: t('ui.fleet.scrap_confirm_title'),
      body: t('ui.fleet.scrap_confirm_body', { name: vehicleDisplayName(v.type, v.tier), amount: formatMoney(residual) }),
      confirmLabel: t('ui.fleet.scrap'),
      onConfirm: () => this.gameConsole?.(`vehicle scrap ${v.id}`),
    });
  }
}
