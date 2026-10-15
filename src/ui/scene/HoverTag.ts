// BlastSimulator2026 — Scene hover tag (redesign P2)
// Small DOM tooltip anchored to a resting cursor's terrain hit. Shown only
// for a surveyed column while the survey overlay is visible: tile coords +
// known survey estimate + staleness. Entities and unsurveyed tiles show nothing.

import * as THREE from 'three';
import { t } from '../../core/i18n/I18n.js';
import { el } from '../dom.js';
import type { GameState } from '../../core/state/GameState.js';
import { isSurveyStale } from '../../core/mining/SurveyStaleness.js';
import { findSurveyForColumn, surveyColumnKey } from '../../core/mining/SurveyColumn.js';
import { oreDepthBands } from '../../core/mining/SurveyDepthProfile.js';
import type { PickResult } from './ScenePicking.js';

/** Space reserved above the anchor for the tag before it flips to render below instead. */
const FLIP_MARGIN_PX = 90;
const ANCHOR_OFFSET_PX = 14;
/** Depth ranges listed under each ore of a surveyed column. */
const HOVER_DEPTH_RUNS_PER_ORE = 3;

export class HoverTag {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: THREE.Camera;
  private readonly projected = new THREE.Vector3();

  constructor(container: HTMLElement, canvas: HTMLCanvasElement, camera: THREE.Camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.root = el('div', { className: 'bsx-root', attrs: { id: 'bs-hover-tag' } });
    this.root.style.cssText = [
      'position:fixed', 'z-index:var(--bsx-z-hovertag)', 'pointer-events:none',
      'padding:7px 10px', 'border-radius:var(--bsx-r-card)',
      'background:rgba(18,22,28,.94)', 'border:1px solid var(--bsx-hairline-strong)',
      'box-shadow:0 6px 20px rgba(0,0,0,.4)', 'max-width:220px',
    ].join(';');
    this.root.style.display = 'none'; // set separately — jsdom's cssText parser can drop this declaration when it shares a cssText string with a var(...) value
    this.root.dataset['visible'] = 'false';
    container.appendChild(this.root);
  }

  /**
   * Show the tag for a resting cursor over a surveyed terrain tile while the
   * survey overlay is visible; hide it in every other case.
   */
  update(hover: PickResult | null, state: GameState, overlayVisible: boolean): void {
    const terrain = hover?.terrain;
    if (!hover || !terrain || hover.entity || !overlayVisible) { this.hide(); return; }

    const content = this.renderTerrain(terrain, state);
    if (!content) { this.hide(); return; }

    this.root.replaceChildren(content);
    this.position(terrain.point);
    this.root.style.display = '';
    this.root.dataset['visible'] = 'true';
  }

  hide(): void {
    this.root.style.display = 'none';
    this.root.dataset['visible'] = 'false';
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

  private renderTerrain(terrain: NonNullable<PickResult['terrain']>, state: GameState): HTMLElement | null {
    const survey = findSurveyForColumn(state.surveyResults, terrain.tileX, terrain.tileZ);
    const colEstimates = survey?.estimates[surveyColumnKey(terrain.tileX, terrain.tileZ)];
    if (!survey || !colEstimates || Object.keys(colEstimates).length === 0) return null;

    const wrap = el('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:5px';
    wrap.appendChild(el('div', {
      className: 'bsx-mono',
      text: t('shell.hovertag.tile', { x: terrain.tileX, z: terrain.tileZ }),
      attrs: { style: 'font-size:10px;color:var(--bsx-text-micro);letter-spacing:.08em' },
    }));

    const stale = isSurveyStale(survey);
    const ranked = Object.entries(colEstimates).sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [oreId, density] of ranked) {
      const row = el('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:10px;font-size:11px';
      row.appendChild(el('span', { text: t(`ore.${oreId}.name`), attrs: { style: 'color:var(--bsx-text-secondary)' } }));
      row.appendChild(el('span', { className: 'bsx-mono', text: `${Math.round(density * 100)}%`, attrs: { style: 'color:var(--bsx-ore-text)' } }));
      wrap.appendChild(row);
      const runs = oreDepthBands(survey.depthProfile?.[surveyColumnKey(terrain.tileX, terrain.tileZ)], oreId).slice(0, HOVER_DEPTH_RUNS_PER_ORE);
      if (runs.length > 0) {
        wrap.appendChild(el('div', {
          className: 'bsx-mono',
          text: runs.map(r => t('shell.hovertag.depth_range', { from: r.fromM, to: r.toM })).join(', '),
          attrs: { style: 'font-size:10px;color:var(--bsx-text-muted)' },
        }));
      }
    }
    wrap.appendChild(el('div', {
      className: stale ? 'bsx-chip bsx-chip-warn' : 'bsx-chip bsx-chip-positive',
      text: stale ? t('shell.hovertag.stale') : t('shell.hovertag.fresh'),
      attrs: { style: 'align-self:flex-start' },
    }));
    return wrap;
  }
}
