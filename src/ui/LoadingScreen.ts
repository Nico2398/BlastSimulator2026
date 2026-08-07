// BlastSimulator2026 — Level loading screen (redesign P8, strata backdrop)
//
// Entering a level runs several seconds of synchronous work — terrain
// generation, then marching-cubes meshing of both the playable grid and the
// landscape. On the largest sites that is over five seconds during which the
// main thread never yields.
//
// The important part is not the overlay itself but WHEN it reaches the
// screen. `show(); generateEverything(); hide();` displays nothing at all: the
// browser has no opportunity to paint between the three statements, so the
// player sees one long freeze and then the finished level. `runPhases` exists
// to solve exactly that — it waits for a frame to be presented before each
// blocking chunk, so the overlay and its current label are actually on screen
// while the work happens.

import { t } from '../core/i18n/I18n.js';
import { QuipBag, TipBag } from './loadingQuips.js';
import { iconEl } from './icons.js';
import { buildLoadingScreenLayout } from './loadingLayout.js';

/**
 * Resolve once the browser has presented a frame.
 *
 * A single requestAnimationFrame is not enough: the callback runs BEFORE the
 * paint it belongs to, so returning there still blocks the main thread before
 * anything reaches the screen. The nested call resolves on the following
 * frame, by which point the previous one has been presented.
 */
export function nextPaint(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame !== 'function') { resolve(); return; }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * One blocking step of a load.
 *
 * No caption: the screen shows a satirical line instead of naming the work.
 * Reporting "Generating terrain" made the wait feel like somebody else's
 * status meeting, and the phases are not the player's problem anyway.
 */
export interface LoadPhase {
  run: () => void;
}

/** One key/value row in the briefing block under the subtitle. */
export interface LoadingBriefingRow {
  /** i18n key for the row's label, e.g. 'loading.brief.starting_cash'. */
  labelKey: string;
  /** Pre-formatted, e.g. "$75,000" — LoadingScreen does not reformat it. */
  value: string;
  /** '--bsx-*' token incl. leading '--'; default '--bsx-text-primary'. */
  colorVar?: string;
}

/** Identifies the site a load is preparing, for the eyebrow/subtitle/briefing blocks. */
export interface LoadingSiteInfo {
  /** null → sandbox eyebrow wording, no "SITE NN". */
  siteNumber: number | null;
  /** 'ui.portfolio.biome.desert' | '.mountain' | '.tropical'. */
  biomeCategoryKey: string;
  /** 0-3, difficulty pip count. */
  difficulty: number;
  /** Subtitle i18n key; omitted → no subtitle block. */
  descriptionKey?: string;
  /** Omitted/empty → no briefing block. */
  briefing?: readonly LoadingBriefingRow[];
}

export class LoadingScreen {
  private readonly overlay: HTMLElement;
  private readonly label: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly percentEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly eyebrowEl: HTMLElement;
  private readonly subtitleEl: HTMLElement;
  private readonly briefingEl: HTMLElement;
  private readonly marksLayer: HTMLElement;
  private readonly stageLabelEl: HTMLElement;
  private readonly stageMetaEl: HTMLElement;
  private readonly tipLabelEl: HTMLElement;
  private readonly tipTextEl: HTMLElement;
  private readonly tipNextBtn: HTMLButtonElement;
  private readonly quips = new QuipBag();
  private readonly tips = new TipBag();

  constructor(container: HTMLElement) {
    const layout = buildLoadingScreenLayout();
    this.overlay = layout.overlay;
    this.label = layout.label;
    this.barFill = layout.barFill;
    this.percentEl = layout.percentEl;
    this.titleEl = layout.titleEl;
    this.eyebrowEl = layout.eyebrowEl;
    this.subtitleEl = layout.subtitleEl;
    this.briefingEl = layout.briefingEl;
    this.marksLayer = layout.marksLayer;
    this.stageLabelEl = layout.stageLabelEl;
    this.stageMetaEl = layout.stageMetaEl;
    this.tipLabelEl = layout.tipLabelEl;
    this.tipTextEl = layout.tipTextEl;
    this.tipNextBtn = layout.tipNextBtn;

    // Label text is set per-show() in renderTip() so it refreshes on locale
    // switch, same as every other block — this is click wiring only.
    this.tipNextBtn.addEventListener('click', () => { this.nextTip(); });

    container.appendChild(this.overlay);

    // The scenario harness asserts visibility on the DOM node itself — the
    // element is the only handle a Puppeteer-side assert has — so mirror the
    // getter there.
    Object.defineProperty(this.overlay, 'visible', { get: () => this.visible });
  }

  get visible(): boolean { return this.overlay.style.display !== 'none'; }

  /** Caption currently shown — exposed so tests can assert phase progression. */
  get phaseText(): string { return this.label.textContent ?? ''; }

  /** Progress as a 0-1 fraction, read back off the bar. */
  get progress(): number { return parseFloat(this.barFill.style.width) / 100; }

  /** Eyebrow row text (site identity + biome) — exposed for tests. */
  get eyebrowText(): string {
    return this.eyebrowEl.querySelector('.bsx-loading-eyebrow-text')?.textContent ?? '';
  }

  /** Subtitle text under the title — exposed for tests. */
  get subtitleText(): string { return this.subtitleEl.textContent ?? ''; }

  /** Briefing rows currently rendered — exposed for tests. */
  get briefingRows(): { label: string; value: string }[] {
    return Array.from(this.briefingEl.children).map((cell) => ({
      label: cell.querySelector('.bsx-stat-key')?.textContent ?? '',
      value: cell.querySelector('.bsx-stat-value')?.textContent ?? '',
    }));
  }

  /** Stage label text alongside the percentage — exposed for tests. */
  get stageLabelText(): string { return this.stageLabelEl.textContent ?? ''; }

  /** Stage meta text alongside the percentage — exposed for tests. */
  get stageMetaText(): string { return this.stageMetaEl.textContent ?? ''; }

  /** Tip text currently shown in the tip block — exposed for tests. */
  get tipText(): string { return this.tipTextEl.textContent ?? ''; }

  /** TIP badge label — exposed for tests (locale refresh, #493). */
  get tipLabelText(): string { return this.tipLabelEl.textContent ?? ''; }

  /** NEXT button label — exposed for tests (locale refresh, #493). */
  get tipNextText(): string { return this.tipNextBtn.textContent ?? ''; }

  show(siteInfo?: LoadingSiteInfo): void {
    this.titleEl.textContent = t('loading.title');
    this.renderEyebrow(siteInfo ?? null);
    this.renderSubtitle(siteInfo ?? null);
    this.renderBriefing(siteInfo ?? null);
    this.setStage(0, 0);
    this.renderTip();
    this.setPhase(this.quips.next(), 0);
    this.overlay.style.display = 'flex';
  }

  /** `caption` is shown verbatim — the quips are not translated strings. */
  setPhase(caption: string, fraction: number): void {
    const clamped = Math.min(1, Math.max(0, fraction));
    this.label.textContent = caption;
    this.barFill.style.width = `${Math.round(clamped * 100)}%`;
    this.percentEl.textContent = `${Math.round(clamped * 100)}%`;
  }

  /** Next unused quip, so a caller driving its own phases can label them. */
  nextQuip(): string { return this.quips.next(); }

  /** Serve another tip into the tip block, for the NEXT button. */
  nextTip(): string {
    const tip = this.tips.next();
    this.tipTextEl.textContent = tip;
    return tip;
  }

  hide(): void { this.overlay.style.display = 'none'; }

  dispose(): void { this.overlay.remove(); }

  /** Populate the eyebrow row (site identity, biome, difficulty pips) from `info`. */
  private renderEyebrow(info: LoadingSiteInfo | null): void {
    this.eyebrowEl.replaceChildren();
    if (!info) return;

    const leadRule = document.createElement('span');
    leadRule.className = 'bsx-loading-eyebrow-rule';

    const text = document.createElement('span');
    text.className = 'bsx-loading-eyebrow-text';
    const siteText = info.siteNumber === null
      ? t('loading.eyebrow_sandbox')
      : t('loading.eyebrow_site', { number: String(info.siteNumber).padStart(2, '0') });
    text.textContent = `${siteText} · ${t(info.biomeCategoryKey)}`;

    const pips = document.createElement('span');
    pips.className = 'bsx-loading-eyebrow-pips';
    for (let i = 0; i < Math.max(0, info.difficulty); i++) pips.appendChild(iconEl('pick', 13));

    const tailRule = document.createElement('span');
    tailRule.className = 'bsx-loading-eyebrow-rule';

    this.eyebrowEl.append(leadRule, text, pips, tailRule);
  }

  /** Populate the subtitle from `info.descriptionKey`, or clear it when absent. */
  private renderSubtitle(info: LoadingSiteInfo | null): void {
    this.subtitleEl.textContent = info?.descriptionKey ? t(info.descriptionKey) : '';
  }

  /** Populate the briefing block's key/value rows from `info.briefing`. */
  private renderBriefing(info: LoadingSiteInfo | null): void {
    this.briefingEl.replaceChildren();
    for (const row of info?.briefing ?? []) {
      const cell = document.createElement('div');
      cell.className = 'bsx-stat-cell bsx-stat-cell-center';

      const key = document.createElement('span');
      key.className = 'bsx-stat-key';
      key.textContent = t(row.labelKey);

      const value = document.createElement('span');
      value.className = 'bsx-stat-value';
      value.textContent = row.value;
      value.style.color = `var(${row.colorVar ?? '--bsx-text-primary'})`;

      cell.append(key, value);
      this.briefingEl.appendChild(cell);
    }
  }

  /**
   * Lay `phaseCount` segment marks onto the progress track.
   *
   * Boundaries mirror the fractions `setPhase` already drives the bar to
   * ((i+1)/(phaseCount+1) for each phase index i) — one mark per phase
   * boundary, none at 0% or 100%.
   */
  private renderSegmentMarks(phaseCount: number): void {
    this.marksLayer.replaceChildren();
    if (phaseCount <= 0) return;
    const total = phaseCount + 1;
    for (let i = 1; i <= phaseCount; i++) {
      const mark = document.createElement('div');
      mark.className = 'bsx-loading-mark';
      mark.style.left = `${(i / total) * 100}%`;
      this.marksLayer.appendChild(mark);
    }
  }

  /**
   * Update the stage label + meta alongside the percentage.
   *
   * `total <= 0` means no phase count is known yet — `show()` calls this
   * before `runPhases()` has any phases to report, e.g. the debug-preview
   * path that never calls `runPhases()` at all. "PHASE 0 / 0" would read as
   * zero total stages rather than "not started yet", so an em dash stands in
   * for both numbers until the first real call arrives.
   */
  private setStage(current: number, total: number): void {
    if (total <= 0) {
      this.stageLabelEl.textContent = t('loading.stage_label', { current: '—', total: '—' });
      this.stageMetaEl.textContent = t('loading.stage_meta', { current: '—', total: '—' });
      return;
    }
    this.stageLabelEl.textContent = t('loading.stage_label', { current, total });
    this.stageMetaEl.textContent = t('loading.stage_meta', { current, total });
  }

  /** Refresh the tip block's own static labels, then draw the next tip. */
  private renderTip(): void {
    this.tipLabelEl.textContent = t('loading.tip_label');
    this.tipNextBtn.title = t('loading.tip_next_hint');
    this.tipNextBtn.textContent = t('loading.tip_next');
    this.nextTip();
  }

  /**
   * Run each phase with the overlay visible and its caption up to date.
   *
   * Every phase gets a presented frame before it starts, which is what keeps
   * the screen from being a decoration painted only after the work is done.
   * The overlay is hidden even if a phase throws, so a failed load can never
   * strand the player behind an opaque panel.
   */
  async runPhases(phases: readonly LoadPhase[], siteInfo?: LoadingSiteInfo): Promise<void> {
    this.show(siteInfo);
    this.renderSegmentMarks(phases.length);
    await nextPaint();
    try {
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i]!;
        // (i+1)/(n+1), not i/n: the bar would otherwise sit at zero through
        // the longest phase, which reads as nothing happening. This starts it
        // moving on the first phase and still leaves the last step for "ready".
        this.setPhase(this.quips.next(), (i + 1) / (phases.length + 1));
        this.setStage(i + 1, phases.length);
        await nextPaint();
        phase.run();
      }
      this.setPhase(t('loading.ready'), 1);
      await nextPaint();
    } finally {
      this.hide();
    }
  }
}
