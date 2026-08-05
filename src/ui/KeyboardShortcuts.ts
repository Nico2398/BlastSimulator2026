// BlastSimulator2026 — Keyboard Shortcuts (12.7)
// Registers key bindings for common gameplay actions.
// Shortcuts panel shown in Settings/Help.

import type { PanelName } from './UIManager.js';

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
}

export class KeyboardShortcuts {
  private readonly handler: (e: KeyboardEvent) => void;
  private enabled = true;

  constructor(callbacks: ShortcutCallbacks) {
    this.handler = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      // Don't fire shortcuts when typing in an input
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          callbacks.togglePause();
          break;
        case 'Digit1': callbacks.setSpeed(1); break;
        case 'Digit2': callbacks.setSpeed(2); break;
        case 'Digit3': callbacks.setSpeed(4); break;
        case 'Digit4': callbacks.setSpeed(8); break;
        case 'KeyB': callbacks.togglePanel('blast'); break;
        case 'KeyC': callbacks.togglePanel('contracts'); break;
        case 'KeyG': callbacks.togglePanel('build'); break;
        case 'KeyV': callbacks.togglePanel('vehicles'); break;
        case 'KeyE': callbacks.togglePanel('employees'); break;
        case 'KeyS': callbacks.togglePanel('survey'); break;
        case 'KeyN': callbacks.onToggleNavGrid?.(); break;
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
