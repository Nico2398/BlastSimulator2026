// Placement cutoff warning and "Place anyway?" modal config (#1391).

import type { GameState } from '../core/state/GameState.js';
import type { Rect } from '../core/world/WorldGen.js';
import { computePlacementCutoff, type PlacementCutoff } from '../core/entities/Building.js';
import { t } from '../core/i18n/I18n.js';
import type { ConfirmModalConfig } from './panels/ConfirmModal.js';

/** What `newRect` (and the footprint it frees, on move/upgrade) would strand from the crew now; null when nothing or no nav grid. */
export function placementCutoffFor(state: GameState, newRect: Rect, freedRect?: Rect): PlacementCutoff | null {
  if (!state.navGrid) return null;
  const crew = state.employees.employees.filter(e => e.alive);
  const holes = [...(state.drillHoles ?? []), ...(state.plannedDrillHoles ?? [])];
  const orders = state.pendingActions.map(a => ({ x: a.targetX, z: a.targetZ }));
  return computePlacementCutoff(state.navGrid, crew, newRect, freedRect, { holes, orders });
}

const rectKey = (r: Rect): string => `${r.minX},${r.minZ},${r.maxX},${r.maxZ}`;

/** One verdict per nav grid: hover redraws and the inspector ask every frame, but the flood only changes with the grid, crew, holes, or orders. */
const cutoffMemos = new WeakMap<object, { key: string; value: PlacementCutoff | null }>();

/** `placementCutoffFor`, memoized by nav revision, crew fingerprint and rects (#1391). */
export function memoizedPlacementCutoff(state: GameState, newRect: Rect, freedRect?: Rect): PlacementCutoff | null {
  const grid = state.navGrid;
  if (!grid) return null;
  const key = `${grid.revision}|${cutoffStateKey(state)}|${rectKey(newRect)}|${freedRect ? rectKey(freedRect) : ''}`;
  const hit = cutoffMemos.get(grid);
  if (hit?.key === key) return hit.value;
  const value = placementCutoffFor(state, newRect, freedRect);
  cutoffMemos.set(grid, { key, value });
  return value;
}

/** Cheap fingerprint of the state a cutoff verdict depends on beyond the nav grid: crew positions, holes, orders. */
export function cutoffStateKey(state: GameState): string {
  let crew = 0;
  let sum = 0;
  for (const e of state.employees.employees) {
    if (!e.alive) continue;
    crew++;
    sum += Math.round(e.x) * 7919 + Math.round(e.z);
  }
  return `${crew}:${sum}:${state.drillHoles?.length ?? 0}:${state.plannedDrillHoles?.length ?? 0}:${state.pendingActions.length}`;
}

/** "Cuts off 3 benches / 2 drill holes / 1 queued order" — zero parts dropped. */
export function cutoffLine(c: PlacementCutoff): string {
  const parts: string[] = [];
  if (c.benches > 0) parts.push(t('ui.build.cutoff_benches', { count: c.benches }));
  if (c.holes > 0) parts.push(t('ui.build.cutoff_holes', { count: c.holes }));
  if (c.orders > 0) parts.push(t('ui.build.cutoff_orders', { count: c.orders }));
  return t('ui.build.cutoff_line', { parts: parts.join(' / ') });
}

/** Confirm-modal config asking whether to go ahead despite the cutoff; `onConfirm` performs the placement. */
export function buildPlacementCutoffConfirm(c: PlacementCutoff, onConfirm: () => void): ConfirmModalConfig {
  return {
    icon: 'warn',
    title: t('ui.build.cutoff_confirm_title'),
    body: t('ui.build.cutoff_confirm_body', { line: cutoffLine(c) }),
    confirmLabel: t('ui.build.cutoff_confirm_label'),
    onConfirm,
  };
}
