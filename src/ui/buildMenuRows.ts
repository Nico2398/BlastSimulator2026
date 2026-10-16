// Row-building helpers for the Build panel's building roster: the info block of a placed row,
// the construction-site rows, and the in-place writers for their live values (§2.3: a row is
// rebuilt only on a signature change, HP / utilization / progress are written into the nodes).

import { t } from '../core/i18n/I18n.js';
import { el } from './dom.js';
import { iconEl } from './icons.js';
import { makeLocateButton } from './locateButton.js';
import { findLive, markLive, writeText } from './panels/inspector/inspectorWidgets.js';
import type { PlacedRowModel, SiteRowModel } from './panels/placedRowModel.js';
import type { Building } from '../core/entities/Building.js';
import type { PlannedBuilding } from '../core/state/GameState.js';

const makeBadge = (): HTMLElement => markLive(el('span', { className: 'bs-build-row-badge' }), 'badge');

/** Icon + `#id tier-name (x,z)` title, with optional trailing controls, shared by placed and site rows. */
function rowHead(id: number, type: string, tier: number, x: number, z: number, trailing: HTMLElement[] = []): HTMLElement {
  const name = `#${id} ${t(`building.${type}.t${tier}.name`)} (${x},${z})`;
  return el('div', {
    className: 'bs-build-row-head',
    children: [iconEl('build', 12), el('span', { className: 'bs-build-row-name', text: name }), ...trailing],
  });
}

/** Row-body click: selects unless the click landed on one of the row's buttons. */
export function onRowBodyClick(row: HTMLElement, select: () => void): void {
  row.addEventListener('click', (ev) => {
    if (ev.target instanceof Element && ev.target.closest('button')) return;
    select();
  });
}

function hpBar(): HTMLElement {
  const fill = markLive(el('div', { className: 'bs-build-hp-fill' }), 'hp-bar');
  return el('div', { className: 'bs-build-hp-bar', children: [fill] });
}

/** Icon, tier name, id, position, HP bar, utilization, badge and Locate for a placed row. */
export function placedInfoBlock(b: Building, model: PlacedRowModel, onLocate: () => void): HTMLElement {
  const locate = makeLocateButton({ title: t('ui.build.row.locate'), size: 20, onClick: onLocate });
  locate.addEventListener('click', (ev) => ev.stopPropagation());
  const head = rowHead(b.id, b.type, b.tier, b.x, b.z, [locate]);
  const hp = el('div', {
    className: 'bs-build-row-hp',
    children: [hpBar(), markLive(el('span', { className: 'bsx-mono bs-build-row-hp-text' }), 'hp')],
  });
  const info = el('div', { className: 'bs-build-row-info', children: [head, hp] });
  info.style.cssText = 'flex:1 1 100%;min-width:0;overflow-wrap:break-word';
  info.title = `${b.type} T${b.tier} at (${b.x},${b.z})`;
  syncPlacedRow(info, model);
  return info;
}

/** Create, update or remove one optional live node (`key`) of `parent` so it matches `text`. */
function syncOptional(parent: HTMLElement, key: string, text: string | null, make: () => HTMLElement): void {
  const node = findLive(parent, key);
  if (text === null) { node?.remove(); return; }
  if (node) { writeText(node, text); return; }
  const created = make();
  created.textContent = text;
  parent.append(created);
}

/** Write HP, utilization and badge into `row` in place. */
export function syncPlacedRow(row: HTMLElement, model: PlacedRowModel): void {
  const fill = findLive(row, 'hp-bar');
  if (fill) fill.style.width = `${Math.round(model.hpFraction * 100)}%`;
  const hp = findLive(row, 'hp');
  if (hp) writeText(hp, model.hpText);
  syncOptional(row, 'util', model.utilization?.text ?? null, () => markLive(el('div', { className: 'bsx-mono bs-build-row-util' }), 'util'));
  // The badge node always exists on a placed row so a status change later writes in place.
  let badge = findLive(row, 'badge');
  if (!badge) { badge = makeBadge(); row.append(badge); }
  writeText(badge, model.badge === null ? '' : t(`ui.build.row.badge.${model.badge}`));
  badge.hidden = model.badge === null;
  badge.dataset['badge'] = model.badge ?? '';
}

function progressText(progress: number | null): string {
  return progress === null ? t('ui.build.row.site_waiting') : t('ui.build.row.site_progress', { percent: Math.round(progress * 100) });
}

/** One construction-site row; `data-building-id` is the id the finished building will carry. */
export function makeSiteRow(pb: PlannedBuilding, model: SiteRowModel, onSelect: () => void): HTMLElement {
  const info = el('div', {
    className: 'bs-build-row-info',
    children: [
      rowHead(pb.buildingId, pb.type, pb.tier, pb.x, pb.z),
      markLive(el('div', { className: 'bsx-mono bs-build-row-util' }), 'progress'),
    ],
  });
  info.style.cssText = 'flex:1 1 100%;min-width:0;overflow-wrap:break-word';
  const row = el('div', { className: 'bs-build-site-row', children: [info] });
  row.dataset['buildingId'] = String(pb.buildingId);
  onRowBodyClick(row, onSelect);
  syncSiteRow(row, model);
  return row;
}

export function syncSiteRow(row: HTMLElement, model: SiteRowModel): void {
  const progress = findLive(row, 'progress');
  if (progress) writeText(progress, progressText(model.progress));
  syncOptional(row, 'badge', model.rebuild ? t('ui.build.row.badge.rebuilding') : null,
    makeBadge);
}

/** Signature that names a site row set: a change rebuilds the rows. */
export function siteSignature(sites: ReadonlyArray<PlannedBuilding>, isRebuild: (pb: PlannedBuilding) => boolean): string {
  return sites.map((pb) => `${pb.buildingId}:${pb.type}:${pb.tier}:${isRebuild(pb)}`).join(',');
}
