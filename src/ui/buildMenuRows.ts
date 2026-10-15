// Row-building helpers for the Build panel's building roster: the info block of a placed row,
// the construction-site rows, and the in-place writers for their live values (§2.3: a row is
// rebuilt only on a signature change, HP / utilization / progress are written into the nodes).

import { t } from '../core/i18n/I18n.js';
import { el } from './dom.js';
import { iconEl } from './icons.js';
import { makeLocateButton } from './locateButton.js';
import { writeText } from './panels/inspector/inspectorWidgets.js';
import type { PlacedRowModel, SiteRowModel } from './panels/placedRowModel.js';
import type { Building } from '../core/entities/Building.js';
import type { PlannedBuilding } from '../core/state/GameState.js';
import { isSelected, type ListSelection } from './selectionRoute.js';

const SELECTED_ROW_CLASS = 'bs-build-row-selected';

const live = (node: HTMLElement, key: string): HTMLElement => {
  node.dataset['live'] = key;
  return node;
};

const liveNode = (row: HTMLElement, key: string): HTMLElement | null =>
  row.querySelector<HTMLElement>(`[data-live="${key}"]`);

/** Row-body click: selects unless the click landed on one of the row's buttons. */
export function onRowBodyClick(row: HTMLElement, select: () => void): void {
  row.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement | null)?.closest('button')) return;
    select();
  });
}

function hpBar(): HTMLElement {
  const fill = live(el('div', { className: 'bs-build-hp-fill' }), 'hp-bar');
  return el('div', { className: 'bs-build-hp-bar', children: [fill] });
}

/** Icon, tier name, id, position, HP bar, utilization, badge and Locate for a placed row. */
export function placedInfoBlock(b: Building, model: PlacedRowModel, onLocate: () => void): HTMLElement {
  const nameText = `#${b.id} ${t(`building.${b.type}.t${b.tier}.name`)} (${b.x},${b.z})`;
  const locate = makeLocateButton({ title: t('ui.build.row.locate'), size: 20, onClick: onLocate });
  locate.addEventListener('click', (ev) => ev.stopPropagation());
  const head = el('div', {
    className: 'bs-build-row-head',
    children: [iconEl('build', 12), el('span', { className: 'bs-build-row-name', text: nameText }), locate],
  });
  const hp = el('div', {
    className: 'bs-build-row-hp',
    children: [hpBar(), live(el('span', { className: 'bsx-mono bs-build-row-hp-text' }), 'hp')],
  });
  const info = el('div', { className: 'bs-build-row-info', children: [head, hp] });
  info.style.cssText = 'flex:1 1 100%;min-width:0;overflow-wrap:break-word';
  info.title = `${b.type} T${b.tier} at (${b.x},${b.z})`;
  syncPlacedRow(info, model);
  return info;
}

/** Create, update or remove one optional live node (`key`) of `parent` so it matches `text`. */
function syncOptional(parent: HTMLElement, key: string, text: string | null, make: () => HTMLElement): void {
  const node = liveNode(parent, key);
  if (text === null) { node?.remove(); return; }
  if (node) { writeText(node, text); return; }
  const created = make();
  created.textContent = text;
  parent.append(created);
}

/** Write HP, utilization and badge into `row` in place. */
export function syncPlacedRow(row: HTMLElement, model: PlacedRowModel): void {
  const fill = liveNode(row, 'hp-bar');
  if (fill) fill.style.width = `${Math.round(model.hpFraction * 100)}%`;
  const hp = liveNode(row, 'hp');
  if (hp) writeText(hp, model.hpText);
  syncOptional(row, 'util', model.utilization?.text ?? null, () => live(el('div', { className: 'bsx-mono bs-build-row-util' }), 'util'));
  syncOptional(row, 'badge', model.badge === null ? null : t(`ui.build.row.badge.${model.badge}`),
    () => live(el('span', { className: 'bs-build-row-badge' }), 'badge'));
  const badge = liveNode(row, 'badge');
  if (badge) badge.dataset['badge'] = model.badge ?? '';
}

function progressText(progress: number | null): string {
  return progress === null ? t('ui.build.row.site_waiting') : t('ui.build.row.site_progress', { percent: Math.round(progress * 100) });
}

/** One construction-site row; `data-building-id` is the id the finished building will carry. */
export function makeSiteRow(pb: PlannedBuilding, model: SiteRowModel, onSelect: () => void): HTMLElement {
  const name = `#${pb.buildingId} ${t(`building.${pb.type}.t${pb.tier}.name`)} (${pb.x},${pb.z})`;
  const info = el('div', {
    className: 'bs-build-row-info',
    children: [
      el('div', { className: 'bs-build-row-head', children: [iconEl('build', 12), el('span', { className: 'bs-build-row-name', text: name })] }),
      live(el('div', { className: 'bsx-mono bs-build-row-util' }), 'progress'),
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
  const progress = liveNode(row, 'progress');
  if (progress) writeText(progress, progressText(model.progress));
  syncOptional(row, 'badge', model.rebuild ? t('ui.build.row.badge.rebuilding') : null,
    () => live(el('span', { className: 'bs-build-row-badge' }), 'badge'));
}

/** Signature that names a site row set: a change rebuilds the rows. */
export function siteSignature(sites: ReadonlyArray<PlannedBuilding>, isRebuild: (pb: PlannedBuilding) => boolean): string {
  return sites.map((pb) => `${pb.buildingId}:${pb.type}:${pb.tier}:${isRebuild(pb)}`).join(',');
}

/** Highlight exactly the building row matching `sel` under each container. */
export function applyRowSelection(containers: ReadonlyArray<HTMLElement>, sel: ListSelection): void {
  for (const container of containers) {
    for (const row of Array.from(container.querySelectorAll<HTMLElement>('[data-building-id]'))) {
      const on = isSelected(sel, 'building', Number(row.dataset['buildingId']));
      row.classList.toggle(SELECTED_ROW_CLASS, on);
      if (on) row.setAttribute('aria-selected', 'true');
      else row.removeAttribute('aria-selected');
    }
  }
}
