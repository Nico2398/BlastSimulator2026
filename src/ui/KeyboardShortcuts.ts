// BlastSimulator2026 — Keyboard Shortcuts (12.7)
// Registers key bindings for common gameplay actions.
// Shortcuts panel shown in Settings/Help.

import { t } from '../core/i18n/I18n.js';

export type GameConsoleFn = (cmd: string) => string;

export interface ShortcutCallbacks {
  togglePause: () => void;
  setSpeed: (n: number) => void;
  togglePanel: (name: string) => void;
  quickSave: () => void;
  openSettings: () => void;
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
        case 'KeyV': callbacks.togglePanel('vehicles'); break;
        case 'KeyE': callbacks.togglePanel('employees'); break;
        case 'KeyS': callbacks.togglePanel('survey'); break;
        case 'F5':
          e.preventDefault();
          callbacks.quickSave();
          break;
        case 'Escape':
          callbacks.openSettings();
          break;
      }
    };

    window.addEventListener('keydown', this.handler);
  }

  setEnabled(enabled: boolean): void { this.enabled = enabled; }

  /** Render a shortcuts help panel element (for use in SettingsMenu). */
  static makeHelpPanel(): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:10px;color:#a08060;margin-top:8px';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:11px;color:#d0b090;margin-bottom:4px;font-weight:bold';
    title.textContent = t('shortcuts.title');

    el.appendChild(title);

    const keys = [
      'shortcuts.pause', 'shortcuts.speed',
      'shortcuts.blast', 'shortcuts.contracts',
      'shortcuts.vehicles', 'shortcuts.employees',
      'shortcuts.survey', 'shortcuts.saves',
      'shortcuts.settings',
    ] as const;

    for (const key of keys) {
      const line = document.createElement('div');
      line.textContent = t(key);
      el.appendChild(line);
    }

    return el;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handler);
  }
}
