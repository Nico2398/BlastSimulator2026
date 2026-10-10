// BlastSimulator2026 — Keyboard Shortcuts (12.7)
// Registers key bindings for common gameplay actions.
// Shortcuts panel shown in Settings/Help.

import type { PanelName } from './UIManager.js';
import { SURVEY_OVERLAY_TOGGLE_TARGET } from './tutorialStepHelpers.js';

export type GameConsoleFn = (cmd: string) => string;

export interface ShortcutCallbacks {
  togglePause: () => void;
  setSpeed: (n: number) => void;
  togglePanel: (name: PanelName) => void;
  quickSave: () => void;
  /**
   * Esc cascade: close whatever's on top (popover, modal, placement,
   * selection) before falling back to closing the active panel. Owned by
   * UIManager.handleEscape — Esc no longer opens Settings directly.
   */
  onEscape: () => void;
  /** Toggle the NavGrid overlay on the MiniMap. */
  onToggleNavGrid?: () => void;
  /** Toggle the survey confidence overlay's player-facing visibility. */
  onToggleSurveyOverlay?: () => void;
}

interface ShortcutOptions {
  /**
   * When it returns true, every key except Escape is ignored and Space/F5
   * are not preventDefault'd. `setEnabled(false)` still suppresses everything.
   */
  isSuppressed?: () => boolean;
  /**
   * Reports whether the on-screen control a shortcut drives is live. When it returns
   * false the shortcut is swallowed (preventDefault, no callback).
   */
  isControlLive?: (selector: string) => boolean;
}

/** Game speed each digit key selects. */
const SPEED_KEYS: Readonly<Record<string, number>> = {
  Digit1: 1,
  Digit2: 2,
  Digit3: 4,
  Digit4: 8,
};

/** On-screen control each shortcut drives, so a rail on the control also holds the key. */
const SHORTCUT_CONTROLS: Readonly<Record<string, string>> = {
  Space: 'button[data-action="pause-toggle"]',
  KeyO: SURVEY_OVERLAY_TOGGLE_TARGET,
  ...Object.fromEntries(
    Object.entries(SPEED_KEYS).map(([code, speed]) => [code, `button[data-speed="${speed}"]`]),
  ),
};

export class KeyboardShortcuts {
  private readonly handler: (e: KeyboardEvent) => void;
  private enabled = true;
  private readonly options: ShortcutOptions;

  constructor(callbacks: ShortcutCallbacks, options: ShortcutOptions = {}) {
    this.options = options;
    this.handler = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      // Don't fire shortcuts when typing in an input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (this.options.isSuppressed?.() && e.code !== 'Escape') return;

      const control = SHORTCUT_CONTROLS[e.code];
      if (control !== undefined && this.options.isControlLive?.(control) === false) {
        if (e.code === 'Space') e.preventDefault();
        return;
      }

      const speed = SPEED_KEYS[e.code];
      if (speed !== undefined) {
        callbacks.setSpeed(speed);
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          callbacks.togglePause();
          break;
        case 'KeyB': callbacks.togglePanel('blast'); break;
        case 'KeyC': callbacks.togglePanel('contracts'); break;
        case 'KeyG': callbacks.togglePanel('build'); break;
        case 'KeyV': callbacks.togglePanel('vehicles'); break;
        case 'KeyE': callbacks.togglePanel('employees'); break;
        case 'KeyS': callbacks.togglePanel('survey'); break;
        case 'KeyN': callbacks.onToggleNavGrid?.(); break;
        case 'KeyO': callbacks.onToggleSurveyOverlay?.(); break;
        case 'F5':
          e.preventDefault();
          callbacks.quickSave();
          break;
        case 'Escape':
          callbacks.onEscape();
          break;
      }
    };

    window.addEventListener('keydown', this.handler);
  }

  setEnabled(enabled: boolean): void { this.enabled = enabled; }

  dispose(): void {
    window.removeEventListener('keydown', this.handler);
  }
}
