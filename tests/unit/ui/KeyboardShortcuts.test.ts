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
    onEscape: ReturnType<typeof vi.fn>;
    onToggleNavGrid: ReturnType<typeof vi.fn>;
    onToggleSurveyOverlay: ReturnType<typeof vi.fn>;
  };
  let ks: KeyboardShortcuts;

  beforeEach(() => {
    callbacks = {
      togglePause: vi.fn(),
      setSpeed: vi.fn(),
      togglePanel: vi.fn(),
      quickSave: vi.fn(),
      onEscape: vi.fn(),
      onToggleNavGrid: vi.fn(),
      onToggleSurveyOverlay: vi.fn(),
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

  it('KeyG toggles build panel', () => {
    fireKey('KeyG');
    expect(callbacks.togglePanel).toHaveBeenCalledWith('build');
    ks.dispose();
  });

  it('KeyN triggers onToggleNavGrid', () => {
    fireKey('KeyN');
    expect(callbacks.onToggleNavGrid).toHaveBeenCalledOnce();
    ks.dispose();
  });

  it('KeyN is a no-op when onToggleNavGrid is not provided', () => {
    const partialCallbacks = {
      togglePause: vi.fn(),
      setSpeed: vi.fn(),
      togglePanel: vi.fn(),
      quickSave: vi.fn(),
      onEscape: vi.fn(),
    };
    const partialKs = new KeyboardShortcuts(partialCallbacks);
    expect(() => fireKey('KeyN')).not.toThrow();
    partialKs.dispose();
    ks.dispose();
  });

  it('KeyO triggers onToggleSurveyOverlay (#496)', () => {
    fireKey('KeyO');
    expect(callbacks.onToggleSurveyOverlay).toHaveBeenCalledOnce();
    ks.dispose();
  });

  it('KeyO is a no-op when onToggleSurveyOverlay is not provided (#496)', () => {
    const partialCallbacks = {
      togglePause: vi.fn(),
      setSpeed: vi.fn(),
      togglePanel: vi.fn(),
      quickSave: vi.fn(),
      onEscape: vi.fn(),
    };
    const partialKs = new KeyboardShortcuts(partialCallbacks);
    expect(() => fireKey('KeyO')).not.toThrow();
    partialKs.dispose();
    ks.dispose();
  });

  it('KeyO does not trigger the panel-toggle callback (guards against a future key collision) (#496)', () => {
    fireKey('KeyO');
    expect(callbacks.togglePanel).not.toHaveBeenCalled();
    ks.dispose();
  });

  it('Escape runs the Esc cascade', () => {
    fireKey('Escape');
    expect(callbacks.onEscape).toHaveBeenCalledOnce();
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

  describe('isSuppressed option (#1323)', () => {
    function fireCancelable(code: string, target?: EventTarget): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
      if (target) Object.defineProperty(event, 'target', { value: target });
      window.dispatchEvent(event);
      return event;
    }

    function allCallbacksSilent(): boolean {
      return callbacks.togglePause.mock.calls.length === 0
        && callbacks.setSpeed.mock.calls.length === 0
        && callbacks.togglePanel.mock.calls.length === 0
        && callbacks.quickSave.mock.calls.length === 0
        && callbacks.onToggleNavGrid.mock.calls.length === 0
        && callbacks.onToggleSurveyOverlay.mock.calls.length === 0;
    }

    const SUPPRESSED_CODES = [
      'Space', 'F5', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
      'KeyB', 'KeyC', 'KeyG', 'KeyV', 'KeyE', 'KeyS', 'KeyN', 'KeyO',
    ];

    beforeEach(() => { ks.dispose(); });

    it.each(SUPPRESSED_CODES)('%s invokes no callback while suppressed', (code) => {
      const sut = new KeyboardShortcuts(callbacks, { isSuppressed: () => true });
      fireCancelable(code);
      expect(allCallbacksSilent()).toBe(true);
      sut.dispose();
    });

    it('Space and F5 are not defaultPrevented while suppressed', () => {
      const sut = new KeyboardShortcuts(callbacks, { isSuppressed: () => true });
      expect(fireCancelable('Space').defaultPrevented).toBe(false);
      expect(fireCancelable('F5').defaultPrevented).toBe(false);
      sut.dispose();
    });

    it('Space and F5 are defaultPrevented when not suppressed', () => {
      const sut = new KeyboardShortcuts(callbacks, { isSuppressed: () => false });
      expect(fireCancelable('Space').defaultPrevented).toBe(true);
      expect(fireCancelable('F5').defaultPrevented).toBe(true);
      sut.dispose();
    });

    it('Escape still calls onEscape while suppressed', () => {
      const sut = new KeyboardShortcuts(callbacks, { isSuppressed: () => true });
      fireCancelable('Escape');
      expect(callbacks.onEscape).toHaveBeenCalledOnce();
      sut.dispose();
    });

    it('keys work again when the predicate flips back to false', () => {
      let suppressed = true;
      const sut = new KeyboardShortcuts(callbacks, { isSuppressed: () => suppressed });
      fireCancelable('Space');
      expect(callbacks.togglePause).not.toHaveBeenCalled();
      suppressed = false;
      fireCancelable('Space');
      fireCancelable('KeyB');
      expect(callbacks.togglePause).toHaveBeenCalledOnce();
      expect(callbacks.togglePanel).toHaveBeenCalledWith('blast');
      suppressed = true;
      fireCancelable('Space');
      expect(callbacks.togglePause).toHaveBeenCalledOnce();
      sut.dispose();
    });

    it('is evaluated per keydown, not once at construction', () => {
      const isSuppressed = vi.fn(() => false);
      const sut = new KeyboardShortcuts(callbacks, { isSuppressed });
      fireCancelable('Digit1');
      fireCancelable('Digit2');
      expect(isSuppressed.mock.calls.length).toBeGreaterThanOrEqual(2);
      sut.dispose();
    });

    it('nested overlays: hiding only one keeps keys suppressed', () => {
      let menuVisible = true;
      let settingsVisible = true;
      const sut = new KeyboardShortcuts(callbacks, { isSuppressed: () => menuVisible || settingsVisible });
      fireCancelable('Space');
      settingsVisible = false;
      fireCancelable('Space');
      expect(callbacks.togglePause).not.toHaveBeenCalled();
      menuVisible = false;
      fireCancelable('Space');
      expect(callbacks.togglePause).toHaveBeenCalledOnce();
      sut.dispose();
    });

    it('omitted options keep existing behaviour', () => {
      const sut = new KeyboardShortcuts(callbacks);
      const e = fireCancelable('Space');
      expect(callbacks.togglePause).toHaveBeenCalledOnce();
      expect(e.defaultPrevented).toBe(true);
      sut.dispose();
    });

    it('options object without isSuppressed keeps existing behaviour', () => {
      const sut = new KeyboardShortcuts(callbacks, {});
      fireCancelable('KeyB');
      expect(callbacks.togglePanel).toHaveBeenCalledWith('blast');
      sut.dispose();
    });

    it('setEnabled(false) suppresses everything including Escape even when not suppressed', () => {
      const sut = new KeyboardShortcuts(callbacks, { isSuppressed: () => false });
      sut.setEnabled(false);
      fireCancelable('Escape');
      fireCancelable('Space');
      expect(callbacks.onEscape).not.toHaveBeenCalled();
      expect(callbacks.togglePause).not.toHaveBeenCalled();
      sut.dispose();
    });

    it('setEnabled(false) suppresses Escape while also suppressed', () => {
      const sut = new KeyboardShortcuts(callbacks, { isSuppressed: () => true });
      sut.setEnabled(false);
      fireCancelable('Escape');
      expect(callbacks.onEscape).not.toHaveBeenCalled();
      sut.dispose();
    });

    it('input guard unchanged: typing in an input fires nothing when not suppressed', () => {
      const sut = new KeyboardShortcuts(callbacks, { isSuppressed: () => false });
      const input = document.createElement('input');
      fireCancelable('Space', input);
      fireCancelable('KeyB', input);
      expect(allCallbacksSilent()).toBe(true);
      sut.dispose();
    });

    it('input guard unchanged: textarea and select also ignored', () => {
      const sut = new KeyboardShortcuts(callbacks, { isSuppressed: () => false });
      fireCancelable('KeyC', document.createElement('textarea'));
      fireCancelable('KeyC', document.createElement('select'));
      expect(callbacks.togglePanel).not.toHaveBeenCalled();
      sut.dispose();
    });
  });

});

describe('KeyboardShortcuts — rails-aware shortcuts (#1597)', () => {
  function make(live: (sel: string) => boolean) {
    const callbacks = {
      togglePause: vi.fn(), setSpeed: vi.fn(), togglePanel: vi.fn(), quickSave: vi.fn(), onEscape: vi.fn(),
    };
    const isControlLive = vi.fn(live);
    const ks = new KeyboardShortcuts(callbacks, { isControlLive });
    return { callbacks, isControlLive, ks };
  }
  function fire(code: string): KeyboardEvent {
    const e = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });
    window.dispatchEvent(e);
    return e;
  }

  it('Space is swallowed when the pause button is not live, but still preventDefault', () => {
    const { callbacks, isControlLive, ks } = make(() => false);
    const e = fire('Space');
    expect(callbacks.togglePause).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
    expect(isControlLive).toHaveBeenCalledWith('button[data-action="pause-toggle"]');
    ks.dispose();
  });

  it('Space toggles when the pause button is live', () => {
    const { callbacks, ks } = make(() => true);
    fire('Space');
    expect(callbacks.togglePause).toHaveBeenCalledOnce();
    ks.dispose();
  });

  it.each([['Digit1', 1], ['Digit2', 2], ['Digit3', 4], ['Digit4', 8]])('%s asks about button[data-speed="%i"] and is swallowed when not live', (code, speed) => {
    const { callbacks, isControlLive, ks } = make(() => false);
    fire(code);
    expect(isControlLive).toHaveBeenCalledWith(`button[data-speed="${speed}"]`);
    expect(callbacks.setSpeed).not.toHaveBeenCalled();
    ks.dispose();
  });

  it.each([['Digit1', 1], ['Digit2', 2], ['Digit3', 4], ['Digit4', 8]])('%s sets speed %i when live', (code, speed) => {
    const { callbacks, ks } = make(() => true);
    fire(code);
    expect(callbacks.setSpeed).toHaveBeenCalledWith(speed);
    ks.dispose();
  });

  it('only the speed button that is not live is swallowed', () => {
    const { callbacks, ks } = make(sel => sel !== 'button[data-speed="2"]');
    fire('Digit2');
    fire('Digit1');
    expect(callbacks.setSpeed).toHaveBeenCalledTimes(1);
    expect(callbacks.setSpeed).toHaveBeenCalledWith(1);
    ks.dispose();
  });

  it('without the option nothing changes', () => {
    const callbacks = { togglePause: vi.fn(), setSpeed: vi.fn(), togglePanel: vi.fn(), quickSave: vi.fn(), onEscape: vi.fn() };
    const ks = new KeyboardShortcuts(callbacks);
    fire('Space');
    fire('Digit3');
    expect(callbacks.togglePause).toHaveBeenCalledOnce();
    expect(callbacks.setSpeed).toHaveBeenCalledWith(4);
    ks.dispose();
  });
});
