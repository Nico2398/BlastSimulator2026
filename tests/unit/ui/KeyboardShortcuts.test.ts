// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyboardShortcuts } from '../../../src/ui/KeyboardShortcuts.js';

function fireKey(code: string, target?: EventTarget): void {
  const event = new KeyboardEvent('keydown', { code, bubbles: true });
  if (target) {
    Object.defineProperty(event, 'target', { value: target });
  }
  window.dispatchEvent(event);
}

describe('KeyboardShortcuts (12.7)', () => {
  let callbacks: {
    togglePause: ReturnType<typeof vi.fn>;
    setSpeed: ReturnType<typeof vi.fn>;
    togglePanel: ReturnType<typeof vi.fn>;
    quickSave: ReturnType<typeof vi.fn>;
    openSettings: ReturnType<typeof vi.fn>;
  };
  let ks: KeyboardShortcuts;

  beforeEach(() => {
    callbacks = {
      togglePause: vi.fn(),
      setSpeed: vi.fn(),
      togglePanel: vi.fn(),
      quickSave: vi.fn(),
      openSettings: vi.fn(),
    };
    ks = new KeyboardShortcuts(callbacks);
  });

  it('Space triggers togglePause', () => {
    fireKey('Space');
    expect(callbacks.togglePause).toHaveBeenCalledOnce();
    ks.dispose();
  });

  it('Digit1 sets speed to 1', () => {
    fireKey('Digit1');
    expect(callbacks.setSpeed).toHaveBeenCalledWith(1);
    ks.dispose();
  });

  it('Digit2 sets speed to 2', () => {
    fireKey('Digit2');
    expect(callbacks.setSpeed).toHaveBeenCalledWith(2);
    ks.dispose();
  });

  it('Digit3 sets speed to 4', () => {
    fireKey('Digit3');
    expect(callbacks.setSpeed).toHaveBeenCalledWith(4);
    ks.dispose();
  });

  it('Digit4 sets speed to 8', () => {
    fireKey('Digit4');
    expect(callbacks.setSpeed).toHaveBeenCalledWith(8);
    ks.dispose();
  });

  it('KeyB toggles blast panel', () => {
    fireKey('KeyB');
    expect(callbacks.togglePanel).toHaveBeenCalledWith('blast');
    ks.dispose();
  });

  it('KeyC toggles contracts panel', () => {
    fireKey('KeyC');
    expect(callbacks.togglePanel).toHaveBeenCalledWith('contracts');
    ks.dispose();
  });

  it('Escape opens settings', () => {
    fireKey('Escape');
    expect(callbacks.openSettings).toHaveBeenCalledOnce();
    ks.dispose();
  });

  it('setEnabled(false) disables all shortcuts', () => {
    ks.setEnabled(false);
    fireKey('Space');
    expect(callbacks.togglePause).not.toHaveBeenCalled();
    ks.dispose();
  });

  it('dispose() removes event listener', () => {
    ks.dispose();
    fireKey('Space');
    expect(callbacks.togglePause).not.toHaveBeenCalled();
  });

  it('makeHelpPanel returns an HTMLElement with shortcut labels', () => {
    const panel = KeyboardShortcuts.makeHelpPanel();
    expect(panel).toBeInstanceOf(HTMLElement);
    expect(panel.children.length).toBeGreaterThan(1);
    ks.dispose();
  });
});
