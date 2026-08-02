// BlastSimulator2026 — Level loading screen
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

/** One blocking step of a load, with the caption shown while it runs. */
export interface LoadPhase {
  labelKey: string;
  run: () => void;
}

export class LoadingScreen {
  private readonly overlay: HTMLElement;
  private readonly label: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly titleEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'bs-loading-screen';
    // Above the main menu and the sandbox panel — a load can start from either.
    this.overlay.style.cssText = [
      'position:fixed;inset:0;z-index:10500;display:none',
      'flex-direction:column;align-items:center;justify-content:center;gap:18px',
      'background:#060402',
    ].join(';');

    this.titleEl = document.createElement('div');
    this.titleEl.style.cssText = [
      'color:#f0b840;font-size:26px;font-family:monospace;letter-spacing:0.04em',
      'text-shadow:0 0 24px rgba(200,100,0,0.5)',
    ].join(';');

    this.label = document.createElement('div');
    this.label.id = 'bs-loading-label';
    this.label.style.cssText = 'color:#8a7040;font-size:12px;letter-spacing:0.1em;text-transform:uppercase';

    const bar = document.createElement('div');
    bar.style.cssText = [
      'width:320px;height:6px;border-radius:3px;overflow:hidden',
      'background:rgba(255,255,255,0.07);border:1px solid rgba(200,160,60,0.25)',
    ].join(';');

    this.barFill = document.createElement('div');
    this.barFill.id = 'bs-loading-bar';
    this.barFill.style.cssText = 'height:100%;width:0%;background:#c08030;transition:width 120ms linear';
    bar.appendChild(this.barFill);

    this.overlay.append(this.titleEl, this.label, bar);
    container.appendChild(this.overlay);
  }

  get visible(): boolean { return this.overlay.style.display !== 'none'; }

  /** Caption currently shown — exposed so tests can assert phase progression. */
  get phaseText(): string { return this.label.textContent ?? ''; }

  /** Progress as a 0-1 fraction, read back off the bar. */
  get progress(): number { return parseFloat(this.barFill.style.width) / 100; }

  show(): void {
    this.titleEl.textContent = t('loading.title');
    this.setPhase('loading.preparing', 0);
    this.overlay.style.display = 'flex';
  }

  setPhase(labelKey: string, fraction: number): void {
    this.label.textContent = t(labelKey);
    this.barFill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
  }

  hide(): void { this.overlay.style.display = 'none'; }

  dispose(): void { this.overlay.remove(); }

  /**
   * Run each phase with the overlay visible and its caption up to date.
   *
   * Every phase gets a presented frame before it starts, which is what keeps
   * the screen from being a decoration painted only after the work is done.
   * The overlay is hidden even if a phase throws, so a failed load can never
   * strand the player behind an opaque panel.
   */
  async runPhases(phases: readonly LoadPhase[]): Promise<void> {
    this.show();
    await nextPaint();
    try {
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i]!;
        // (i+1)/(n+1), not i/n: the bar would otherwise sit at zero through
        // the longest phase, which reads as nothing happening. This starts it
        // moving on the first phase and still leaves the last step for "ready".
        this.setPhase(phase.labelKey, (i + 1) / (phases.length + 1));
        await nextPaint();
        phase.run();
      }
      this.setPhase('loading.ready', 1);
      await nextPaint();
    } finally {
      this.hide();
    }
  }
}
