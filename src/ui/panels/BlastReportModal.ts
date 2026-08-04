// BlastSimulator2026 — Blast Report Modal (redesign P4/§5.C)
// Shows state.lastBlastReport (built in blastCommand, task P4/#17) right
// after a blast resolves. Visibility is derived from state, not manually
// toggled — the same pattern EventDialog already uses for its own pendingEvent:
// a report whose tick differs from the last one shown means a new blast just
// happened, so the modal opens itself on the very next update() tick, right
// after PreflightModal's DETONATE dispatches `blast` and closes itself.
//
// Deviation from the design mock: its second footer button, "SEND HAULERS",
// has no real backing command — only per-vehicle `vehicle haul <id>` exists,
// which is what the Vehicles panel's own Haul button already drives (the
// tutorial's own hauling beat uses exactly that path). Dropped rather than
// wired to something that doesn't exist; CLOSE is the only real action here.

import { t } from '../../core/i18n/I18n.js';
import { el, statGrid } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import type { GameState } from '../../core/state/GameState.js';
import type { BlastReport, BlastRating } from '../../core/mining/BlastExecution.js';

const RATING_COLOR: Record<BlastRating, string> = {
  perfect: 'var(--bsx-positive)',
  good: 'var(--bsx-positive)',
  mediocre: 'var(--bsx-amber)',
  bad: 'var(--bsx-critical-text)',
  catastrophic: 'var(--bsx-critical-text)',
};

export class BlastReportModal {
  private readonly overlay: HTMLElement;
  private readonly ratingEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly notesEl: HTMLElement;

  private open = false;
  private lastShownTick: number | null = null;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.overlay = el('div', { className: 'bs-confirm-overlay' });
    this.overlay.style.display = 'none';

    const box = el('div');
    box.style.cssText = 'width:640px;max-width:92vw;max-height:86vh;display:flex;flex-direction:column;border-radius:9px;background:var(--bsx-panel);border:1px solid var(--bsx-hairline-strong);box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden';

    const header = el('div');
    header.style.cssText = 'padding:20px;display:flex;align-items:center;gap:14px;background:linear-gradient(90deg,rgba(255,176,46,.14),rgba(255,176,46,0));border-bottom:1px solid var(--bsx-hairline)';
    const iconChip = el('div', { children: [iconEl('blast', 24)] });
    iconChip.style.cssText = 'width:44px;height:44px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:rgba(255,176,46,.18);color:var(--bsx-amber)';
    const titleCol = el('div');
    titleCol.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    titleCol.append(this.locale.bindText(el('span', { attrs: { style: 'font:800 17px/1 var(--bsx-font-ui);letter-spacing:.06em' } }), 'ui.blast_workshop.report.title'));

    const ratingCol = el('div');
    ratingCol.style.cssText = 'margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:4px';
    ratingCol.append(this.locale.bindText(el('span', { attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-micro)' } }), 'ui.blast_workshop.report.rating'));
    this.ratingEl = el('span', { attrs: { style: 'font:800 20px/1 var(--bsx-font-ui);letter-spacing:.04em' } });
    ratingCol.appendChild(this.ratingEl);

    header.append(iconChip, titleCol, ratingCol);

    const body = el('div');
    body.style.cssText = 'padding:18px 20px;display:flex;flex-direction:column;gap:16px;overflow-y:auto';
    this.statsEl = el('div');
    this.notesEl = el('div');
    this.notesEl.style.cssText = 'display:flex;flex-direction:column;gap:10px';
    body.append(this.statsEl, this.notesEl);

    const footer = el('div');
    footer.style.cssText = 'padding:14px 20px;background:var(--bsx-well);border-top:1px solid var(--bsx-hairline);display:flex;gap:9px';
    const closeBtn = el('button', { className: 'bsx-btn' });
    closeBtn.style.cssText = 'flex:1;height:40px';
    closeBtn.dataset['action'] = 'report-close';
    this.locale.bindText(closeBtn, 'ui.blast_workshop.report.close');
    closeBtn.addEventListener('click', () => this.hide());
    footer.appendChild(closeBtn);

    box.append(header, body, footer);
    this.overlay.appendChild(box);
    container.appendChild(this.overlay);
  }

  get root(): HTMLElement { return this.overlay; }

  hide(): void { this.open = false; this.overlay.style.display = 'none'; }
  get visible(): boolean { return this.open; }

  update(state: GameState): void {
    const report = state.lastBlastReport;
    if (!report || report.tick === this.lastShownTick) return;
    this.lastShownTick = report.tick;
    this.render(report, state);
    this.open = true;
    this.overlay.style.display = '';
  }

  refreshLocale(): void { this.locale.refresh(); }

  dispose(): void { this.overlay.remove(); }

  private render(report: BlastReport, state: GameState): void {
    this.ratingEl.textContent = t(`ui.blast_workshop.report.rating_${report.rating}`);
    this.ratingEl.style.color = RATING_COLOR[report.rating];

    this.statsEl.replaceChildren(statGrid([
      { key: t('ui.blast_workshop.report.stat_cleared'), value: `${report.clearedVoxels}` },
      { key: t('ui.blast_workshop.report.stat_cracked'), value: `${report.crackedVoxels}` },
      { key: t('ui.blast_workshop.report.stat_fragments'), value: `${report.fragmentCount}` },
      { key: t('ui.blast_workshop.report.stat_oversized'), value: `${report.oversizedFragments}`, ...(report.oversizedFragments > 0 ? { color: 'var(--bsx-amber)' } : {}) },
      { key: t('ui.blast_workshop.report.stat_volume'), value: `${report.totalRockVolume.toFixed(0)} m³` },
      { key: t('ui.blast_workshop.report.stat_projections'), value: `${report.projectionCount} · ${report.maxProjectionDistanceM.toFixed(0)} m`, ...(report.projectionCount > 0 ? { color: 'var(--bsx-critical-text)' } : {}) },
      { key: t('ui.blast_workshop.report.stat_spent'), value: `$${formatMoney(report.spent)}`, color: 'var(--bsx-critical-text)' },
      { key: t('ui.blast_workshop.report.stat_ore_value'), value: `$${formatMoney(report.totalOreValue)}`, color: 'var(--bsx-positive)' },
    ], 4));

    const notes: HTMLElement[] = [];
    const oreReport = state.lastOreReport;
    if (oreReport && oreReport.estimatedYieldKg > 0) {
      notes.push(this.makeOreCard(oreReport));
    }
    for (const b of report.destroyedBuildings) {
      notes.push(this.makeNoteCard('build', 'rgba(255,91,76,', 'var(--bsx-critical-text)',
        t('ui.blast_workshop.report.building_destroyed', { type: t(`building.${b.type}.name`), id: b.buildingId })));
    }
    if (report.oversizedFragments > 0) {
      notes.push(this.makeNoteCard('rock', 'rgba(255,176,46,', 'var(--bsx-amber)',
        t('ui.blast_workshop.report.oversized_hint', { count: report.oversizedFragments, vehicle: t('vehicle_type.rock_fragmenter') })));
    }
    this.notesEl.replaceChildren(...notes);
  }

  private makeOreCard(oreReport: NonNullable<GameState['lastOreReport']>): HTMLElement {
    const pct = Math.round(oreReport.yieldRatio * 100);
    const breakdown = Object.entries(oreReport.oreYields)
      .filter(([, kg]) => kg > 0)
      .map(([oreId, kg]) => `${t(`ore.${oreId}.name`)} ${kg.toFixed(0)} kg`)
      .join(' · ');
    const wrap = el('div');
    wrap.style.cssText = 'display:flex;gap:10px;padding:12px;border-radius:5px;background:rgba(169,140,255,.08);border:1px solid rgba(169,140,255,.28)';
    const iconWrap = el('div', { attrs: { style: 'color:var(--bsx-ore);padding-top:1px' }, children: [iconEl('ore', 16)] });
    const col = el('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:5px;flex:1';
    const headRow = el('div');
    headRow.style.cssText = 'display:flex;align-items:baseline;gap:8px';
    headRow.append(
      el('span', { text: t('ui.blast_workshop.report.ore_report'), attrs: { style: 'font:600 12px/1 var(--bsx-font-ui)' } }),
      el('span', { text: `${pct}%`, attrs: { style: 'margin-left:auto;font:600 15px/1 var(--bsx-font-mono);color:var(--bsx-ore)' } }),
    );
    const detail = el('span', {
      text: t('ui.blast_workshop.report.ore_detail', { actual: oreReport.totalYieldKg.toFixed(0), estimate: oreReport.estimatedYieldKg.toFixed(0), breakdown }),
      attrs: { style: 'font:400 11px/1.45 var(--bsx-font-ui);color:var(--bsx-text-secondary)' },
    });
    col.append(headRow, detail);
    wrap.append(iconWrap, col);
    return wrap;
  }

  private makeNoteCard(icon: 'build' | 'rock', bgPrefix: string, fg: string, text: string): HTMLElement {
    const wrap = el('div');
    wrap.style.cssText = `display:flex;gap:10px;padding:12px;border-radius:5px;background:${bgPrefix}.08);border:1px solid ${bgPrefix}.28)`;
    wrap.append(
      el('div', { attrs: { style: `color:${fg};padding-top:1px` }, children: [iconEl(icon, 16)] }),
      el('span', { text, attrs: { style: 'font:400 11px/1.45 var(--bsx-font-ui);color:var(--bsx-text-secondary);flex:1' } }),
    );
    return wrap;
  }
}
