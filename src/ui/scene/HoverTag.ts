// BlastSimulator2026 — Scene hover tag (redesign P2)
// Small DOM tooltip anchored to a raycast hit's screen projection. Two
// variants: entity (name/kind/status) and terrain (tile coords + known
// survey estimate + staleness — the dead SurveyUI.showSurveyResult path's
// per-column formatting, resurrected as tooltip data instead of a panel).

import * as THREE from 'three';
import { t } from '../../core/i18n/I18n.js';
import { el } from '../dom.js';
import { iconEl, type IconName } from '../icons.js';
import type { GameState } from '../../core/state/GameState.js';
import { findSurveyForColumn, isSurveyStale } from '../../core/mining/SurveyCalc.js';
import { holeNumericId } from '../../core/mining/DrillPlan.js';
import type { PickResult } from './ScenePicking.js';

const ROLE_ICON: Record<string, IconName> = {
  driller: 'blast', blaster: 'explosive', driver: 'vehicle', surveyor: 'survey', manager: 'crew',
};
const VEHICLE_ICON: Record<string, IconName> = {
  debris_hauler: 'vehicle', rock_digger: 'vehicle', drill_rig: 'blast',
  building_destroyer: 'vehicle', rock_fragmenter: 'vehicle',
};

/** Space reserved above the anchor for the tag before it flips to render below instead. */
const FLIP_MARGIN_PX = 90;
const ANCHOR_OFFSET_PX = 14;

export class HoverTag {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.Camera;
  private readonly projected = new THREE.Vector3();

  constructor(container: HTMLElement, canvas: HTMLCanvasElement, camera: THREE.Camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.root = el('div', { className: 'bsx-root' });
    this.root.style.cssText = [
      'position:fixed', 'z-index:var(--bsx-z-hovertag)', 'pointer-events:none',
      'padding:7px 10px', 'border-radius:var(--bsx-r-card)',
      'background:rgba(18,22,28,.94)', 'border:1px solid var(--bsx-hairline-strong)',
      'box-shadow:0 6px 20px rgba(0,0,0,.4)', 'max-width:220px',
    ].join(';');
    this.root.style.display = 'none'; // set separately — jsdom's cssText parser can drop this declaration when it shares a cssText string with a var(...) value
    container.appendChild(this.root);
  }

  /** Show/update/hide the tag for the current hover result. Null hides it. */
  update(hover: PickResult | null, state: GameState): void {
    if (!hover || (!hover.entity && !hover.terrain)) { this.hide(); return; }

    const content = hover.entity
      ? this.renderEntity(hover.entity, state)
      : this.renderTerrain(hover.terrain!, state);
    if (!content) { this.hide(); return; }

    this.root.replaceChildren(content);
    const anchorPoint = hover.entity?.point ?? hover.terrain!.point;
    this.position(anchorPoint);
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  dispose(): void {
    this.root.remove();
  }

  private position(worldPoint: THREE.Vector3): void {
    this.projected.copy(worldPoint).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    const screenX = rect.left + ((this.projected.x + 1) / 2) * rect.width;
    const screenY = rect.top + ((1 - this.projected.y) / 2) * rect.height;

    this.root.style.left = `${Math.round(screenX)}px`;
    if (screenY < FLIP_MARGIN_PX) {
      // Not enough room above the anchor (e.g. cursor near the top edge) — flip below it.
      this.root.style.top = `${Math.round(screenY + ANCHOR_OFFSET_PX)}px`;
      this.root.style.transform = 'translate(-50%, 0)';
    } else {
      this.root.style.top = `${Math.round(screenY - ANCHOR_OFFSET_PX)}px`;
      this.root.style.transform = 'translate(-50%, -100%)';
    }
  }

  private row(icon: IconName, title: string, sub?: string): HTMLElement {
    const wrap = el('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px';
    wrap.appendChild(iconEl(icon, 14));
    const col = el('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:1px';
    col.appendChild(el('div', { text: title, attrs: { style: 'font:600 11px/1.2 var(--bsx-font-ui);color:var(--bsx-text-primary)' } }));
    if (sub) col.appendChild(el('div', { className: 'bsx-mono', text: sub, attrs: { style: 'font-size:10px;color:var(--bsx-text-muted)' } }));
    wrap.appendChild(col);
    return wrap;
  }

  private renderEntity(entity: NonNullable<PickResult['entity']>, state: GameState): HTMLElement | null {
    switch (entity.kind) {
      case 'building': {
        const b = state.buildings.buildings.find(x => x.id === entity.id);
        if (!b) return null;
        return this.row('build', t(`building.${b.type}.t${b.tier}.name`), `HP ${Math.round(b.hp)}`);
      }
      case 'vehicle': {
        const v = state.vehicles.vehicles.find(x => x.id === entity.id);
        if (!v) return null;
        return this.row(VEHICLE_ICON[v.type] ?? 'vehicle', t(`vehicle_type.${v.type}`), `${t(`vehicle_state.${v.state}`)} · HP ${Math.round(v.hp)}`);
      }
      case 'employee': {
        const e = state.employees.employees.find(x => x.id === entity.id);
        if (!e) return null;
        return this.row(ROLE_ICON[e.role] ?? 'crew', e.name, `${t(`role.${e.role}`)} · ${t('ui.employees.morale')} ${Math.round(e.morale)}%`);
      }
      case 'fragment':
        return this.row('rock', t('shell.hovertag.fragment', { id: entity.id }));
      case 'hole': {
        const hole = state.drillHoles.find(h => holeNumericId(h.id) === entity.id);
        if (!hole) return null;
        const delay = state.sequenceDelays[hole.id];
        return this.row('blast', hole.id, delay !== undefined ? `${hole.depth}m · +${delay}ms` : `${hole.depth}m`);
      }
    }
  }

  private renderTerrain(terrain: NonNullable<PickResult['terrain']>, state: GameState): HTMLElement {
    const wrap = el('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:5px';
    wrap.appendChild(el('div', {
      className: 'bsx-mono',
      text: t('shell.hovertag.tile', { x: terrain.tileX, z: terrain.tileZ }),
      attrs: { style: 'font-size:10px;color:var(--bsx-text-micro);letter-spacing:.08em' },
    }));

    const survey = findSurveyForColumn(state.surveyResults, terrain.tileX, terrain.tileZ);
    const colEstimates = survey?.estimates[`${terrain.tileX},${terrain.tileZ}`];
    if (!survey || !colEstimates || Object.keys(colEstimates).length === 0) {
      wrap.appendChild(el('div', { text: t('shell.hovertag.no_survey'), attrs: { style: 'font-size:11px;color:var(--bsx-text-muted)' } }));
      return wrap;
    }

    const stale = isSurveyStale(survey, state.tickCount);
    const ranked = Object.entries(colEstimates).sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [oreId, density] of ranked) {
      const row = el('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:10px;font-size:11px';
      row.appendChild(el('span', { text: t(`ore.${oreId}.name`), attrs: { style: 'color:var(--bsx-text-secondary)' } }));
      row.appendChild(el('span', { className: 'bsx-mono', text: `${Math.round(density * 100)}%`, attrs: { style: 'color:var(--bsx-ore-text)' } }));
      wrap.appendChild(row);
    }
    wrap.appendChild(el('div', {
      className: stale ? 'bsx-chip bsx-chip-warn' : 'bsx-chip bsx-chip-positive',
      text: stale ? t('shell.hovertag.stale') : t('shell.hovertag.fresh'),
      attrs: { style: 'align-self:flex-start' },
    }));
    return wrap;
  }
}
