// BlastSimulator2026 — Blast Workshop: Fire step (redesign P4)
// Danger-zone occupant list and a 2-item pre-flight checklist (DETONATE clears
// the zone itself, #1362). The FIRE button itself stays in the
// always-visible sticky footer (blastFooter.ts) — it now opens
// PreflightModal rather than firing directly (see that file's header).
//
// The zone shown here isn't read from state.zone.activeZone (that only
// exists once the player has already run zone clear at least once) — it's
// computeDangerZone()'s live padded box around the current holes, so the
// occupant list has something real to show from the moment a plan exists.
// DETONATE (PreflightModal) evacuates that exact same box via the real
// detonation sequence, so the occupant list just empties on its own once
// everyone is out.

import { t } from '../../../core/i18n/I18n.js';
import { el, scrollBoundedSection } from '../../dom.js';
import { iconEl, type IconName } from '../../icons.js';
import { LocaleTextRegistry } from '../../localeText.js';
import { wetHoles } from '../../../core/mining/WetHoles.js';
import { computeDangerZone, isInZone, type ZoneBounds } from '../../../core/entities/Zone.js';
import { BLAST_DANGER_MARGIN_M } from '../../../core/config/balance.js';
import { vehicleDriverId } from '../../../core/entities/Vehicle.js';
import type { WeatherState } from '../../../core/weather/WeatherCycle.js';
import type { GameState } from '../../../core/state/GameState.js';


interface Occupant {
  icon: IconName;
  name: string;
  sub: string;
  /** True for a vehicle stranded in the zone with no driver aboard — clearZone/evacuateZone report it via strandedVehicleIds rather than moving it. */
  strandedNoDriver: boolean;
}

export class FireStep {
  private readonly el: HTMLElement;
  private readonly zoneHeaderLabelEl: HTMLElement;
  private readonly zoneListEl: HTMLElement;
  private readonly checklistEl: HTMLElement;

  private lastSignature = '';
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = el('div');
    this.el.style.cssText = 'display:flex;flex-direction:column;gap:11px';

    const zoneHeader = el('div', { className: 'bsx-section' });
    this.zoneHeaderLabelEl = el('span', { className: 'bsx-section-label' });
    zoneHeader.append(this.zoneHeaderLabelEl, el('span', { className: 'bsx-section-rule' }));

    // Bounded + independently scrollable, same reasoning as Charge's product
    // list: a crowded danger zone would otherwise push the
    // preflight checklist past the panel's fold.
    this.zoneListEl = scrollBoundedSection([], 200, { gap: 4 });

    const preflightHeader = el('div', { className: 'bsx-section' });
    preflightHeader.style.cssText = 'padding-top:3px';
    preflightHeader.append(
      this.locale.bindText(el('span', { className: 'bsx-section-label' }), 'ui.blast_workshop.fire.preflight_section'),
      el('span', { className: 'bsx-section-rule' }),
    );
    this.checklistEl = el('div');
    this.checklistEl.style.cssText = 'display:flex;flex-direction:column;gap:7px';

    this.el.append(zoneHeader, this.zoneListEl, preflightHeader, this.checklistEl);
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }

  update(state: GameState, _weather?: WeatherState): void {
    const zone = computeDangerZone(state.drillHoles, BLAST_DANGER_MARGIN_M);
    const wet = wetHoles(state);

    const occupantKeys = zone ? this.occupantKeys(state, zone) : [];
    const signature = JSON.stringify({ zone, occupants: occupantKeys, wetCount: wet.length });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    const span = zone ? Math.round(Math.max(zone.x2 - zone.x1, zone.z2 - zone.z1)) : 0;
    this.zoneHeaderLabelEl.textContent = t('ui.blast_workshop.fire.danger_zone', { span });

    const occupants = zone ? this.occupants(state, zone) : [];
    this.renderZoneList(occupants, zone !== null);
    this.renderChecklist(state.drillHoles.length, wet.length, occupants);
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = '';
  }

  dispose(): void { this.el.remove(); }

  private occupants(state: GameState, zone: ZoneBounds): Occupant[] {
    const result: Occupant[] = [];
    for (const e of state.employees.employees) {
      if (!e.alive || !isInZone(e.x, e.z, zone)) continue;
      result.push({
        icon: e.collapsing ? 'collapse' : 'crew',
        name: e.name,
        sub: t(`role.${e.role}`),
        strandedNoDriver: false,
      });
    }
    for (const v of state.vehicles.vehicles) {
      if (!isInZone(v.x, v.z, zone)) continue;
      result.push({ icon: 'vehicle', name: t(`vehicle_type.${v.type}`), sub: `#${v.id}`, strandedNoDriver: vehicleDriverId(v) === null });
    }
    return result;
  }

  /** Cheap identity for the update() signature — full names/subs aren't needed just to detect a change. */
  private occupantKeys(state: GameState, zone: ZoneBounds): string[] {
    const keys: string[] = [];
    for (const e of state.employees.employees) {
      if (e.alive && isInZone(e.x, e.z, zone)) keys.push(`e${e.id}`);
    }
    for (const v of state.vehicles.vehicles) {
      if (isInZone(v.x, v.z, zone)) keys.push(`v${v.id}:${vehicleDriverId(v) === null ? 'nodriver' : 'driver'}`);
    }
    return keys;
  }

  private renderZoneList(occupants: Occupant[], hasZone: boolean): void {
    if (!hasZone) {
      this.zoneListEl.replaceChildren(el('div', { className: 'bsx-empty', text: t('ui.blast_workshop.fire.no_plan') }));
      return;
    }
    if (occupants.length === 0) {
      const clear = el('div');
      clear.style.cssText = 'display:flex;align-items:center;gap:9px;padding:11px;border:1px solid rgba(79,199,107,.28);border-radius:5px;background:rgba(79,199,107,.06)';
      clear.append(
        el('div', { attrs: { style: 'color:var(--bsx-positive)' }, children: [iconEl('check', 15)] }),
        el('span', { text: t('ui.blast_workshop.fire.zone_clear'), attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } }),
      );
      this.zoneListEl.replaceChildren(clear);
      return;
    }
    this.zoneListEl.replaceChildren(...occupants.map(o => this.makeOccupantRow(o)));
  }

  private makeOccupantRow(o: Occupant): HTMLElement {
    const row = el('div');
    row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid var(--bsx-hairline);border-radius:5px;background:var(--bsx-card)';
    row.append(
      el('div', { attrs: { style: 'color:var(--bsx-critical-text)' }, children: [iconEl(o.icon, 14)] }),
      el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:2px' }, children: [
        el('span', { text: o.name, attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
        el('span', { text: o.sub, attrs: { style: 'font:400 10px/1 var(--bsx-font-mono);color:var(--bsx-text-micro)' } }),
      ] }),
      el('span', {
        text: t(o.strandedNoDriver ? 'ui.blast_workshop.fire.tag_stranded' : 'ui.blast_workshop.fire.tag_in_zone'),
        attrs: { style: 'margin-left:auto;font:700 10px/1 var(--bsx-font-ui);letter-spacing:.12em;color:var(--bsx-critical-text)' },
      }),
    );
    return row;
  }

  private renderChecklist(holeCount: number, wetCount: number, occupants: Occupant[]): void {
    const dryOk = wetCount === 0;
    const occupantCount = occupants.length;
    const strandedCount = occupants.filter(o => o.strandedNoDriver).length;
    const zoneOk = occupantCount === 0;
    this.checklistEl.replaceChildren(
      this.makeCheckRow(dryOk, dryOk ? t('ui.blast_workshop.fire.check_dry', { count: holeCount }) : t('ui.blast_workshop.fire.check_wet', { count: wetCount })),
      this.makeCheckRow(zoneOk, zoneOk
        ? t('ui.blast_workshop.fire.check_zone_clear')
        : strandedCount > 0
          ? t('ui.blast_workshop.fire.check_zone_occupied_stranded', { count: occupantCount, strandedCount })
          : t('ui.blast_workshop.fire.check_zone_occupied', { count: occupantCount })),
    );
  }

  private makeCheckRow(ok: boolean, text: string): HTMLElement {
    const row = el('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:flex-start';
    row.append(
      el('div', { attrs: { style: `color:${ok ? 'var(--bsx-positive)' : 'var(--bsx-amber)'};padding-top:1px` }, children: [iconEl(ok ? 'check' : 'warn', 12)] }),
      el('span', { text, attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } }),
    );
    return row;
  }
}
