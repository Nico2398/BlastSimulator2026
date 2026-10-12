// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ConfirmModal } from '../../../../src/ui/panels/ConfirmModal.js';

function makeModal(): { modal: ConfirmModal; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const modal = new ConfirmModal(container);
  return { modal, container };
}

describe('ConfirmModal', () => {
  it('is hidden until shown', () => {
    const { modal } = makeModal();
    expect(modal.visible).toBe(false);
  });

  it('shows with the given copy', () => {
    const { modal } = makeModal();

    modal.show({
      icon: 'trash',
      title: 'Scrap Vehicle?',
      body: 'This cannot be undone.',
      confirmLabel: 'Scrap',
      onConfirm: () => {},
    });

    expect(modal.visible).toBe(true);
    expect(modal.root.textContent).toContain('Scrap Vehicle?');
    expect(modal.root.textContent).toContain('This cannot be undone.');
    expect(modal.root.textContent).toContain('Scrap');
    expect(modal.root.textContent).toContain('Cancel');
  });

  it('Confirm dispatches the callback and hides', () => {
    const { modal } = makeModal();
    let dispatched = false;

    modal.show({
      icon: 'trash',
      title: 'Scrap Vehicle?',
      body: 'This cannot be undone.',
      confirmLabel: 'Scrap',
      onConfirm: () => { dispatched = true; },
    });
    (modal.root.querySelector('[data-action="confirm-yes"]') as HTMLButtonElement).click();

    expect(dispatched).toBe(true);
    expect(modal.visible).toBe(false);
  });

  it('Cancel hides without dispatching', () => {
    const { modal } = makeModal();
    let dispatched = false;

    modal.show({
      icon: 'trash',
      title: 'Scrap Vehicle?',
      body: 'This cannot be undone.',
      confirmLabel: 'Scrap',
      onConfirm: () => { dispatched = true; },
    });
    (modal.root.querySelector('[data-action="confirm-cancel"]') as HTMLButtonElement).click();

    expect(dispatched).toBe(false);
    expect(modal.visible).toBe(false);
  });

  it('a second show() replaces the previous callback rather than stacking it', () => {
    const { modal } = makeModal();
    let firstCalled = false;
    let secondCalled = false;

    modal.show({
      icon: 'trash', title: 'First', body: 'First body', confirmLabel: 'Go',
      onConfirm: () => { firstCalled = true; },
    });
    modal.show({
      icon: 'trash', title: 'Second', body: 'Second body', confirmLabel: 'Go',
      onConfirm: () => { secondCalled = true; },
    });
    (modal.root.querySelector('[data-action="confirm-yes"]') as HTMLButtonElement).click();

    expect(firstCalled).toBe(false);
    expect(secondCalled).toBe(true);
  });

  it('refreshLocale() does not throw', () => {
    const { modal } = makeModal();
    expect(() => modal.refreshLocale()).not.toThrow();
  });

  it('dispose() removes the modal from the DOM', () => {
    const { modal, container } = makeModal();
    modal.dispose();
    expect(container.contains(modal.root)).toBe(false);
  });
});

describe('ConfirmModal — interface cue', () => {
  const config = { icon: 'trash' as const, title: 'Scrap?', body: 'Gone.', confirmLabel: 'Scrap', onConfirm: () => {} };

  it('plays the modal cue each time it opens, and not when it closes', () => {
    const { modal } = makeModal();
    const modalShown = vi.fn();
    modal.setCues({ modalShown });

    modal.show(config);
    expect(modalShown).toHaveBeenCalledTimes(1);
    modal.hide();
    expect(modalShown).toHaveBeenCalledTimes(1);
    modal.show(config);
    expect(modalShown).toHaveBeenCalledTimes(2);
  });

  it('opens silently without cues or once they are removed', () => {
    const { modal } = makeModal();
    expect(() => modal.show(config)).not.toThrow();
    const modalShown = vi.fn();
    modal.setCues({ modalShown });
    modal.setCues(null);
    modal.show(config);
    expect(modalShown).not.toHaveBeenCalled();
  });
});

