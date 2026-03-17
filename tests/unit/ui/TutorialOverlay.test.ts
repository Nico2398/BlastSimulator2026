// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { TutorialOverlay } from '../../../src/ui/TutorialOverlay.js';

describe('TutorialOverlay (12.4)', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Clear tutorial state between tests
    try { localStorage.removeItem('bs_tutorial_done'); } catch { /* ignore */ }
  });

  it('is not active on construction', () => {
    const tut = new TutorialOverlay(container);
    expect(tut.isActive).toBe(false);
    tut.dispose();
  });

  it('becomes active when start() is called', () => {
    const tut = new TutorialOverlay(container);
    tut.start();
    expect(tut.isActive).toBe(true);
    tut.dispose();
  });

  it('becomes inactive when skip() is called', () => {
    const tut = new TutorialOverlay(container);
    tut.start();
    tut.skip();
    expect(tut.isActive).toBe(false);
    tut.dispose();
  });

  it('persists completion to localStorage', () => {
    const tut = new TutorialOverlay(container);
    tut.start();
    tut.skip();
    expect(TutorialOverlay.isCompleted()).toBe(true);
    tut.dispose();
  });

  it('isCompleted returns false before skip', () => {
    expect(TutorialOverlay.isCompleted()).toBe(false);
  });

  it('removes overlay from DOM on dispose', () => {
    const tut = new TutorialOverlay(container);
    tut.start();
    tut.dispose();
    // Overlay element should be removed
    expect(container.querySelector('.bs-confirm-overlay')).toBeNull();
  });

  it('shows step counter text when active', () => {
    const tut = new TutorialOverlay(container);
    tut.start();
    // Find any small element with step counter text (e.g. "1 / 5")
    const allEls = Array.from(container.querySelectorAll('*'));
    const counter = allEls.find(el => /\d\s*\/\s*\d/.test(el.textContent ?? ''));
    expect(counter).toBeDefined();
    expect(counter?.textContent).toContain('1');
    tut.dispose();
  });
});
