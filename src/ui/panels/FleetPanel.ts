// BlastSimulator2026 — Fleet panel (redesign P6)
// Traffic advisory banner, then one card per vehicle: name/id/role, status
// chip, HP gauge, LOAD gauge (haulers only), driver row or licensed-crew
// picker, HAUL (reused from the existing eligibility cache), SCRAP (confirm,
// real residual value). Dealership lands in the next task on the same class.

import { t } from '../../core/i18n/I18n.js';
import { el, card, button } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { GameState } from '../../core/state/GameState.js';
import type { Vehicle } from '../../core/entities/Vehicle.js';
import { computeScrapResidualValue } from '../../core/entities/Vehicle.js';
import { computeTrafficAdvisory } from '../../core/events/EventEngine.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { HaulEligibilityCache, makeHaulButton, refreshHaulButtons } from '../vehicleHaulButton.js';
import { vehicleDisplayName, makeStatusChip, makeHpGauge, makeLoadGauge, makeDriverRow, makeAssignRow } from '../fleetDetailSections.js';
import type { ConfirmModalConfig } from './ConfirmModal.js';
import type { CommandResult } from '../../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

export class FleetPanel {
  private readonly el: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private onCloseCb?: () => void;
  private onNavigateCb?: (panel: 'crew') => void;
  private gameConsole?: GameConsoleFn;
  private onConfirmRequestCb?: (config: ConfirmModalConfig) => void;
  private lastSignature = '';
  private lastState: GameState | null = null;
  private readonly locale = new LocaleTextRegistry();
  private readonly haulCache = new HaulEligibilityCache();

  constructor(container: HTMLElement) {
    this.el = el('div', { className: 'bsx-root', attrs: { id: 'bs-fleet-panel' } });
    this.el.style.cssText = [
      'flex-direction:column', 'width:372px', 'max-height:100%',
      'border-radius:8px', 'background:var(--bsx-panel)', 'border:1px solid var(--bsx-hairline-strong)',
      'box-shadow:0 18px 44px rgba(0,0,0,.55)', 'overflow:hidden', 'pointer-events:all',
    ].join(';');
    this.el.style.display = 'none';

    const header = el('div');
    header.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:10px;height:46px;padding:0 12px;background:#1a2028;border-bottom:1px solid var(--bsx-hairline)';
    const iconChip = el('div', { children: [iconEl('vehicle', 15)] });
    iconChip.style.cssText = 'width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;background:rgba(85,168,255,.14);color:var(--bsx-info)';
    const titleEl = this.locale.bindText(
      el('div', { attrs: { style: 'font:700 12px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-primary)' } }),
      'ui.fleet.title',
    );
    const closeBtn = el('button', { children: [iconEl('x', 12)] });
    closeBtn.style.cssText = 'margin-left:auto;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:transparent;color:var(--bsx-text-muted);cursor:pointer';
    closeBtn.addEventListener('click', () => this.onCloseCb?.());
    header.append(iconChip, titleEl, closeBtn);

    this.bodyEl = el('div');
    this.bodyEl.style.cssText = 'flex:1 1 auto;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:9px';

    this.el.append(header, this.bodyEl);
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }
  setCloseHandler(cb: () => void): void { this.onCloseCb = cb; }
  setNavigateHandler(cb: (panel: 'crew') => void): void { this.onNavigateCb = cb; }
  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }
  setConfirmHandler(cb: (config: ConfirmModalConfig) => void): void { this.onConfirmRequestCb = cb; }

  show(): void { this.el.style.display = 'flex'; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  update(state: GameState): void {
    this.lastState = state;
    // Reachable-fragment eligibility only changes once per game tick, not
    // once per rendered frame (mirrors VehiclePanel.ts's own comment).
    this.haulCache.refresh(state);

    const signature = this.computeSignature(state);
    if (signature === this.lastSignature) {
      this.refreshDynamic(state);
      refreshHaulButtons(this.bodyEl, state, this.haulCache, this.dispatch);
      return;
    }
    this.lastSignature = signature;
    this.render(state);
    refreshHaulButtons(this.bodyEl, state, this.haulCache, this.dispatch);
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = '';
    if (this.lastState) this.update(this.lastState);
  }

  dispose(): void { this.el.remove(); }

  private readonly dispatch = (cmd: string): unknown => this.gameConsole?.(cmd);

  /**
   * Structural facts only: which cards exist, whether each has a driver
   * (swaps the driver row for the assign picker), and who is eligible to
   * drive (changes the assign picker's own options). HP, load, status, and
   * the traffic banner all drift on their own — refreshDynamic patches
   * those in place so an in-flight driver pick or Haul/Scrap click survives.
   */
  private computeSignature(state: GameState): string {
    const rows = state.vehicles.vehicles.map(v => `${v.id}:${v.type}:${v.tier}:${v.driverId ?? '-'}`).join('|');
    const quals = state.employees.employees.filter(e => e.alive)
      .map(e => `${e.id}:${e.qualifications.map(q => q.category).join(',')}`).join('|');
    return `${rows}#${quals}`;
  }

  private refreshDynamic(state: GameState): void {
    const banner = this.makeTrafficBanner(state);
    if (banner) this.bodyEl.querySelector('.bs-fleet-traffic')?.replaceWith(this.tag(banner, 'bs-fleet-traffic'));
    else this.bodyEl.querySelector('.bs-fleet-traffic')?.remove();

    for (const v of state.vehicles.vehicles) {
      const row = this.bodyEl.querySelector<HTMLElement>(`[data-vehicle-id="${v.id}"]`);
      if (!row) continue;
      row.querySelector('.bs-fleet-status')?.replaceWith(this.tag(makeStatusChip(v), 'bs-fleet-status'));
      row.querySelector('.bs-fleet-hp')?.replaceWith(this.tag(makeHpGauge(v), 'bs-fleet-hp'));
      const load = makeLoadGauge(v);
      const existingLoad = row.querySelector('.bs-fleet-load');
      if (load && existingLoad) existingLoad.replaceWith(this.tag(load, 'bs-fleet-load'));
    }
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

    if (vehicles.length === 0) {
      children.push(el('div', { className: 'bsx-empty', text: t('ui.fleet.none') }));
    } else {
      for (const v of vehicles) children.push(this.makeVehicleCard(v, state));
    }
    this.bodyEl.replaceChildren(...children);
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
    head.append(iconChip, nameCol, this.tag(makeStatusChip(v), 'bs-fleet-status'), locateBtn);

    const rows: HTMLElement[] = [head, this.tag(makeHpGauge(v), 'bs-fleet-hp')];
    const load = makeLoadGauge(v);
    if (load) rows.push(this.tag(load, 'bs-fleet-load'));

    rows.push(
      v.driverId !== null
        ? makeDriverRow(v, state, () => this.gameConsole?.(`vehicle driver ${v.id} none`))
        : makeAssignRow(v, state, employeeId => this.gameConsole?.(`vehicle driver ${v.id} ${employeeId}`), () => this.onNavigateCb?.('crew')),
    );

    const actions = el('div', { attrs: { style: 'display:flex;gap:6px' } });
    const haulBtn = makeHaulButton(v, this.haulCache, this.dispatch);
    if (haulBtn) actions.appendChild(haulBtn);
    const scrapBtn = button('danger', '', { icon: 'trash' });
    scrapBtn.style.cssText = 'width:34px;height:28px;padding:0';
    scrapBtn.title = t('ui.fleet.scrap');
    scrapBtn.addEventListener('click', () => this.requestScrap(v));
    actions.appendChild(scrapBtn);
    rows.push(actions);

    const wrap = card(rows);
    wrap.dataset['vehicleId'] = String(v.id);
    return wrap;
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
