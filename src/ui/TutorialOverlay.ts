// BlastSimulator2026 — Tutorial Overlay (12.4)
// Step-by-step first-time player guidance.
// Skeleton — empty stubs only.

import type { GameState } from '../core/state/GameState.js';

import { TUTORIAL_STEPS, TOTAL_TUTORIAL_STEPS } from './tutorialSteps.js';
import type { TutorialStep } from './tutorialSteps.js';

// Stub references — consumed by implementer; suppress unused-import errors.
void (TUTORIAL_STEPS as TutorialStep[]);
void (TOTAL_TUTORIAL_STEPS as number);

export class TutorialOverlay {
  private readonly overlay: HTMLElement;
  private readonly box: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly stepCounter: HTMLElement;
  private readonly skipBtn: HTMLElement;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'bs-confirm-overlay';
    this.overlay.style.display = 'none';

    this.box = document.createElement('div');
    this.box.className = 'bs-confirm-box';
    this.box.style.pointerEvents = 'all';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'bs-panel-title';

    this.textEl = document.createElement('div');

    this.stepCounter = document.createElement('div');

    this.skipBtn = document.createElement('button');
    this.skipBtn.className = 'bs-btn bs-btn-danger';
    this.skipBtn.addEventListener('click', () => this.skip());

    this.box.append(this.titleEl, this.textEl, this.stepCounter, this.skipBtn);
    this.overlay.appendChild(this.box);
    container.appendChild(this.overlay);
  }

  /** Start tutorial from the beginning. */
  start(_state: GameState): void {
    // TODO: implement
  }

  /** Skip the tutorial and persist completion. */
  skip(): void {
    // TODO: implement
  }

  /** Whether the tutorial is currently active. */
  get isActive(): boolean {
    // TODO: implement
    return false;
  }

  /** Returns true if tutorial was already completed (persisted in localStorage). */
  static isCompleted(): boolean {
    // TODO: implement
    return false;
  }

  /** Remove the overlay from the DOM. */
  dispose(): void {
    // TODO: implement
  }

  /** React to a command being executed — may advance tutorial steps. */
  onCommandExecuted(_state: GameState): void {
    // TODO: implement
  }
}
