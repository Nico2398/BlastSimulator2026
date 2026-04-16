// BlastSimulator2026 — Tutorial Overlay (12.4)
// Step-by-step first-time player guidance. Uses event system for delivery.
// Can be skipped at any time.

import { t } from '../core/i18n/I18n.js';

import type { CommandResult } from '../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

const STEPS = [
  'tutorial.step1',
  'tutorial.step2',
  'tutorial.step3',
  'tutorial.step4',
  'tutorial.done',
] as const;

export class TutorialOverlay {
  private readonly overlay: HTMLElement;
  private readonly box: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly stepCounter: HTMLElement;
  private step = 0;
  private active = false;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'bs-confirm-overlay';
    this.overlay.style.cssText = 'display:none;pointer-events:none';
    // Tutorial sits at bottom-center, doesn't block gameplay
    this.overlay.style.alignItems = 'flex-end';
    this.overlay.style.paddingBottom = '60px';

    this.box = document.createElement('div');
    this.box.className = 'bs-confirm-box';
    this.box.style.cssText = 'max-width:380px;pointer-events:all;text-align:left';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    title.style.margin = '0';
    title.textContent = t('tutorial.title');

    this.stepCounter = document.createElement('div');
    this.stepCounter.style.cssText = 'font-size:10px;color:#806050';

    header.append(title, this.stepCounter);

    this.textEl = document.createElement('p');
    this.textEl.style.cssText = 'font-size:12px;color:#c0a070;margin:0 0 10px';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;justify-content:flex-end';

    const skipBtn = document.createElement('button');
    skipBtn.className = 'bs-btn bs-btn-danger';
    skipBtn.style.cssText = 'font-size:10px;padding:2px 8px';
    skipBtn.textContent = t('tutorial.skip');
    skipBtn.addEventListener('click', () => this.skip());

    const nextBtn = document.createElement('button');
    nextBtn.className = 'bs-btn bs-btn-primary';
    nextBtn.style.cssText = 'font-size:10px;padding:2px 8px';
    nextBtn.textContent = t('tutorial.next');
    nextBtn.addEventListener('click', () => this.next());

    btnRow.append(skipBtn, nextBtn);
    this.box.append(header, this.textEl, btnRow);
    this.overlay.appendChild(this.box);
    container.appendChild(this.overlay);
  }

  /** Start tutorial from the beginning. */
  start(): void {
    this.step = 0;
    this.active = true;
    this.overlay.style.display = 'flex';
    this.render();
  }

  skip(): void {
    this.active = false;
    this.overlay.style.display = 'none';
    localStorage.setItem('bs_tutorial_done', '1');
  }

  get isActive(): boolean { return this.active; }

  /** Returns true if tutorial was already completed (persisted in localStorage). */
  static isCompleted(): boolean {
    try { return !!localStorage.getItem('bs_tutorial_done'); } catch { return false; }
  }

  dispose(): void { this.overlay.remove(); }

  private next(): void {
    this.step++;
    if (this.step >= STEPS.length) {
      this.skip(); // done
    } else {
      this.render();
    }
  }

  private render(): void {
    const key = STEPS[this.step];
    if (!key) return;
    this.textEl.textContent = t(key);
    this.stepCounter.textContent = `${this.step + 1} / ${STEPS.length}`;
  }
}
