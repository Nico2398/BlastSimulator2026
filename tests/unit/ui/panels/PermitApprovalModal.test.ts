// @vitest-environment jsdom
// BlastSimulator2026 — PermitApprovalModal (#1926): the Ministry's stamped approval letter.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PermitApprovalModal } from '../../../../src/ui/panels/PermitApprovalModal.js';
import { createGame, type GameState } from '../../../../src/core/state/GameState.js';
import { createGradeState, gradeDef, unlockLinesFor } from '../../../../src/core/economy/MineGrade.js';
// Importing PermitLimits registers its unlock line (#1926).
import '../../../../src/core/economy/PermitLimits.js';
import { serialize, deserialize } from '../../../../src/core/state/SaveLoad.js';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';
import type { GameConsoleFn } from '../../../../src/ui/gameConsole.js';

function makeState(unseen: number | null = null, grade = unseen ?? 0): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.grade = { ...createGradeState(), grade, unseenApproval: unseen };
  return state;
}

function makeModal(): { modal: PermitApprovalModal; container: HTMLElement; console: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const modal = new PermitApprovalModal(container);
  const fn = vi.fn<any[], any>(() => ({ success: true, output: '' }));
  modal.setGameConsole(fn as unknown as GameConsoleFn);
  return { modal, container, console: fn as unknown as ReturnType<typeof vi.fn> };
}

const dismissBtn = (c: HTMLElement) => c.querySelectorAll('.bs-permit-approval-dismiss');

describe('PermitApprovalModal (#1926)', () => {
  beforeEach(() => setLocale('en'));

  it('is hidden with no pending approval', () => {
    const { modal, container } = makeModal();
    modal.update(makeState(null));
    expect(modal.visible).toBe(false);
    expect(dismissBtn(container).length === 0 || (dismissBtn(container)[0] as HTMLElement).offsetParent === null || !modal.visible).toBe(true);
  });

  it('is hidden when the site has no permit ladder at all', () => {
    const { modal } = makeModal();
    const state = makeState(null);
    delete state.grade;
    modal.update(state);
    expect(modal.visible).toBe(false);
  });

  it('opens when an approval is unseen and shows the new grade name', () => {
    const { modal, container } = makeModal();
    modal.update(makeState(1));
    expect(modal.visible).toBe(true);
    expect(container.textContent).toContain(t(gradeDef(1).nameKey, gradeDef(1).nameParams));
    expect(container.textContent).toContain('Hobby Quarry Licence');
  });

  it('shows a stamp element', () => {
    const { modal, container } = makeModal();
    modal.update(makeState(1));
    expect(container.querySelector('[class*="stamp"]')).not.toBeNull();
  });

  it.each([1, 3, 5, 7])('lists one li per unlock line for grade %i with resolved text', (g) => {
    const { modal, container } = makeModal();
    modal.update(makeState(g));
    const items = container.querySelectorAll('li');
    expect(items).toHaveLength(unlockLinesFor(g).length);
    items.forEach(li => {
      expect(li.textContent!.length).toBeGreaterThan(0);
      expect(li.textContent).not.toMatch(/^progression\./);
      expect(li.textContent).not.toMatch(/\{\w+\}/);
    });
  });

  it('renders the grade-1 hint line from the registry', () => {
    const { modal, container } = makeModal();
    modal.update(makeState(1));
    expect(container.textContent).toContain('Your pile of rubble is a logistics problem now.');
  });

  it('has exactly one dismiss button', () => {
    const { modal, container } = makeModal();
    modal.update(makeState(2));
    expect(dismissBtn(container)).toHaveLength(1);
  });

  it('clicking dismiss sends "permit ack" to the console', () => {
    const { modal, container, console: fn } = makeModal();
    modal.update(makeState(1));
    (dismissBtn(container)[0] as HTMLElement).click();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('permit ack');
  });

  it('stays open until state clears, then hides on the next update', () => {
    const { modal, container } = makeModal();
    const state = makeState(1);
    modal.update(state);
    (dismissBtn(container)[0] as HTMLElement).click();
    modal.update(state);
    expect(modal.visible).toBe(true);
    state.grade!.unseenApproval = null;
    modal.update(state);
    expect(modal.visible).toBe(false);
  });

  it('repeated updates with the same pending approval do not duplicate the list', () => {
    const { modal, container } = makeModal();
    const state = makeState(1);
    modal.update(state);
    modal.update(state);
    expect(container.querySelectorAll('li')).toHaveLength(unlockLinesFor(1).length);
    expect(dismissBtn(container)).toHaveLength(1);
  });

  it('a later approval of a different grade shows that grade', () => {
    const { modal, container } = makeModal();
    const state = makeState(1);
    modal.update(state);
    state.grade!.unseenApproval = null;
    modal.update(state);
    state.grade!.grade = 2;
    state.grade!.unseenApproval = 2;
    modal.update(state);
    expect(modal.visible).toBe(true);
    expect(container.textContent).toContain('Licensed Quarry');
  });

  it('reopens from state on the first update, as after a save/load round trip', () => {
    const saved = serialize(makeState(2));
    const restored = deserialize(saved);
    expect(restored.grade!.unseenApproval).toBe(2);
    const { modal, container } = makeModal();
    modal.update(restored);
    expect(modal.visible).toBe(true);
    expect(container.textContent).toContain('Licensed Quarry');
  });

  it('refreshLocale rebuilds the content in the new language', () => {
    const { modal, container } = makeModal();
    modal.update(makeState(1));
    const en = container.textContent;
    setLocale('fr');
    modal.refreshLocale();
    expect(container.textContent).not.toBe(en);
    expect(container.textContent).toContain(t(gradeDef(1).nameKey, gradeDef(1).nameParams));
    expect(container.querySelectorAll('li')).toHaveLength(unlockLinesFor(1).length);
    expect(modal.visible).toBe(true);
  });

  it('refreshLocale on a hidden modal does not throw or open it', () => {
    const { modal } = makeModal();
    expect(() => modal.refreshLocale()).not.toThrow();
    expect(modal.visible).toBe(false);
  });

  it('dispose removes the modal DOM', () => {
    const { modal, container } = makeModal();
    modal.update(makeState(1));
    modal.dispose();
    expect(container.querySelector('.bs-permit-approval-dismiss')).toBeNull();
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });
});
