// BlastSimulator2026 — Staff coverage tiles (#2242)
// "What we have against what we need" for people: one tile per qualification
// the fleet or the work queue depends on (core: StaffCoverage.ts), worst
// first, shown at the top of the Crew and Fleet windows.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import { staffCoverage, type CoverageLine, type CoverageStatus } from '../core/entities/StaffCoverage.js';
import { el } from './dom.js';
import { haveNeedBar, statusPill, windowSection, type Tone } from './windowKit.js';

const STATUS_TONE: Record<CoverageStatus, Tone> = { ok: 'positive', short: 'warn', missing: 'critical' };

/** How many qualified people the line needs: a driver per vehicle, else one hand for the queued orders. */
export function coverageNeed(line: CoverageLine): number {
  if (line.vehicles > 0) return line.vehicles;
  return line.queuedOrders > 0 ? 1 : 0;
}

/** How many it has toward that need: holders at the fleet's licence level, else any holder. */
export function coverageHave(line: CoverageLine): number {
  return line.vehicles > 0 ? line.holdersAtLevel : line.holders;
}

function demandText(line: CoverageLine): string {
  const parts: string[] = [];
  if (line.vehicles > 0) parts.push(t('ui.coverage.vehicles', { count: line.vehicles, level: line.levelNeeded }));
  if (line.queuedOrders > 0) parts.push(t('ui.coverage.orders', { count: line.queuedOrders }));
  return parts.join(' · ');
}

function coverageTile(line: CoverageLine): HTMLElement {
  const tone = STATUS_TONE[line.status];
  const need = coverageNeed(line);
  const have = coverageHave(line);
  return el('div', {
    className: 'bsx-coverage-item',
    attrs: { 'data-coverage-skill': line.skill, 'data-status': line.status },
    children: [
      el('div', { className: 'bsx-coverage-head', children: [
        el('span', { className: 'bsx-coverage-skill', text: t(`skill.${line.skill}`) }),
        statusPill(t(`ui.coverage.status_${line.status}`), tone, t(`ui.coverage.explain_${line.status}`)),
      ] }),
      haveNeedBar(have, need, tone),
      el('div', { className: 'bsx-coverage-figures', children: [
        el('span', { children: [el('b', { text: String(have) }), document.createTextNode(` ${t('ui.coverage.have')}`)] }),
        el('span', { text: demandText(line) }),
      ] }),
    ],
  });
}

/** Signature of what the tiles show, so a window rebuilds them only when a figure changes. */
export function coverageSignature(state: GameState): string {
  return staffCoverage(state.vehicles.vehicles, state.employees.employees, state.pendingActions)
    .map(l => `${l.skill}:${l.vehicles}:${l.levelNeeded}:${l.queuedOrders}:${l.holders}:${l.holdersAtLevel}`).join('|');
}

/**
 * Swap the coverage section under `body` for a fresh one when its figures
 * changed since `lastSignature`; returns the signature now shown. Keeps the
 * rest of the window — rows, scroll, a click in flight — untouched.
 */
export function syncStaffCoverage(body: HTMLElement, state: GameState, lastSignature: string, only?: 'licences'): string {
  const signature = coverageSignature(state);
  if (signature === lastSignature) return lastSignature;
  const next = staffCoverageSection(state, only);
  const current = body.querySelector(':scope > .bs-staff-coverage');
  if (current && next) current.replaceWith(next);
  else if (current) current.remove();
  else if (next) {
    const anchor = body.querySelector(':scope > .bs-crew-kpis, :scope > .bs-fleet-kpis');
    if (anchor) anchor.after(next); else body.prepend(next);
  }
  return signature;
}

/**
 * The coverage section, or null when nothing on site needs a qualification.
 * `only` narrows it to driving licences (the Fleet window) or shows every line (Crew).
 */
export function staffCoverageSection(state: GameState, only?: 'licences'): HTMLElement | null {
  const lines = staffCoverage(state.vehicles.vehicles, state.employees.employees, state.pendingActions)
    .filter(l => only !== 'licences' || l.vehicles > 0);
  if (lines.length === 0) return null;
  const gaps = lines.filter(l => l.status !== 'ok').length;
  return windowSection({
    title: t('ui.coverage.title'),
    count: gaps > 0 ? t('ui.coverage.gaps', { count: gaps }) : t('ui.coverage.all_ok'),
    note: t('ui.coverage.note'),
    className: 'bs-staff-coverage',
    children: [el('div', { className: 'bsx-coverage', children: lines.map(coverageTile) })],
  });
}
