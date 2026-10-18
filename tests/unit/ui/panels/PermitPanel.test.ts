// @vitest-environment jsdom
// BlastSimulator2026 — PermitPanel (#1924): grade stamp, target bars, apply button, pending countdown.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermitPanel } from '../../../../src/ui/panels/PermitPanel.js';
import { createGame, type GameState } from '../../../../src/core/state/GameState.js';
import { createGradeState, gradeDef, nextGradeTargets, permitApplyBlocker } from '../../../../src/core/economy/MineGrade.js';
import { permitRefusalText } from '../../../../src/core/economy/permitRefusalText.js';
import { formatGameDuration } from '../../../../src/ui/formatGameDuration.js';
import { formatMoney } from '../../../../src/core/economy/formatMoney.js';
import { setLocale, t } from '../../../../src/core/i18n/I18n.js';

const PENDING_LINE = 'Your file is on the pile. The pile is on a desk. The desk is on holiday.';

let container: HTMLElement;
let panel: PermitPanel;
let gameConsole: ReturnType<typeof vi.fn>;

function progression(): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.grade = createGradeState();
  s.cash = 1_000_000;
  return s;
}

function meet(s: GameState): void {
  s.grade!.oreDeliveredKg = 5_000;
  s.grade!.blastsFired = 2;
}

const q = <T extends HTMLElement = HTMLElement>(sel: string): T | null => panel.root.querySelector<T>(sel);
const applyBtn = (): HTMLButtonElement | null => q<HTMLButtonElement>('[data-action="permit-apply"]');
const reason = (): string | undefined => q('[data-role="permit-apply-reason"]')?.textContent?.trim();

beforeEach(() => {
  setLocale('en');
  container = document.createElement('div');
  document.body.appendChild(container);
  panel = new PermitPanel(container);
  gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  panel.setGameConsole(gameConsole as never);
  panel.show();
});

afterEach(() => {
  panel.dispose();
  container.remove();
  setLocale('en');
});

describe('PermitPanel (#1924)', () => {
  it('root id is bs-permit-panel', () => {
    expect(panel.root.id).toBe('bs-permit-panel');
  });

  it('shows the grade name and a stamp badge', () => {
    panel.update(progression());
    const stamp = q('[data-role="permit-stamp"]');
    expect(stamp).not.toBeNull();
    expect(stamp!.textContent).toContain(t(gradeDef(0).nameKey));
  });

  it('renders one row per next-grade target', () => {
    const s = progression();
    panel.update(s);
    const targets = nextGradeTargets(s);
    expect(targets.length).toBeGreaterThan(0);
    for (const tg of targets) {
      expect(panel.root.querySelectorAll(`[data-target="${tg.kind}"]`)).toHaveLength(1);
    }
    expect(panel.root.querySelectorAll('[data-target]')).toHaveLength(targets.length);
  });

  it('target bar width is min(100, current/needed*100)% and met rows are flagged', () => {
    const s = progression();
    s.grade!.oreDeliveredKg = 2_500; // half of 5 t
    s.grade!.blastsFired = 9; // over the target of 2
    panel.update(s);
    const ore = q('[data-target="ore_kg"]')!;
    const blasts = q('[data-target="blasts"]')!;
    const oreBar = ore.querySelector<HTMLElement>('[data-role="target-bar"]')!;
    const blastBar = blasts.querySelector<HTMLElement>('[data-role="target-bar"]')!;
    const need = nextGradeTargets(s).find(x => x.kind === 'ore_kg')!.needed;
    expect(oreBar.style.width).toBe(`${Math.min(100, (2_500 / need) * 100)}%`);
    expect(blastBar.style.width).toBe('100%');
    expect(ore.dataset['met']).not.toBe('true');
    expect(blasts.dataset['met']).toBe('true');
  });

  it('target row text carries current and needed values', () => {
    const s = progression();
    s.grade!.blastsFired = 1;
    panel.update(s);
    expect(q('[data-target="blasts"]')!.textContent).toContain(t('permit.target.blasts', { current: '1', needed: '2' }));
  });

  it('shows the fee and the processing time', () => {
    panel.update(progression());
    const next = gradeDef(1);
    expect(panel.root.textContent).toContain(formatMoney(next.fee));
    expect(panel.root.textContent).toContain(formatGameDuration(next.processingTicks));
  });

  it('unmet targets: Apply is disabled and the reason equals permitRefusalText', () => {
    const s = progression();
    panel.update(s);
    const btn = applyBtn()!;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
    const b = permitApplyBlocker(s)!;
    expect(reason()).toBe(permitRefusalText(b.refusal, b.unmet, gradeDef(1).fee, s.cash));
  });

  it('clicking a disabled Apply never calls the console', () => {
    panel.update(progression());
    applyBtn()!.click();
    expect(gameConsole).not.toHaveBeenCalled();
  });

  it('targets met but cash short: Apply disabled with the insufficient-funds text', () => {
    const s = progression();
    meet(s);
    s.cash = 100;
    panel.update(s);
    expect(applyBtn()!.disabled).toBe(true);
    expect(reason()).toBe(permitRefusalText('insufficient_funds', [], gradeDef(1).fee, 100));
  });

  it('targets met and cash ok: Apply enabled, no reason, click runs `permit apply` once', () => {
    const s = progression();
    meet(s);
    panel.update(s);
    const btn = applyBtn()!;
    expect(btn.disabled).toBe(false);
    expect(q('[data-role="permit-apply-reason"]')).toBeNull();
    btn.click();
    expect(gameConsole).toHaveBeenCalledTimes(1);
    expect(gameConsole).toHaveBeenCalledWith('permit apply');
  });

  it('re-rendering on every update does not stack click handlers', () => {
    const s = progression();
    meet(s);
    panel.update(s);
    panel.update(s);
    panel.update(s);
    applyBtn()!.click();
    expect(gameConsole).toHaveBeenCalledTimes(1);
  });

  it('pending: no Apply button, a pending block with countdown and the satirical line', () => {
    const s = progression();
    meet(s);
    s.grade!.pending = { toGrade: 1, ticksLeft: 30 };
    panel.update(s);
    expect(applyBtn()).toBeNull();
    const pending = q('[data-role="permit-pending"]')!;
    expect(pending).not.toBeNull();
    expect(pending.textContent).toContain(PENDING_LINE);
    expect(pending.textContent).toContain(formatGameDuration(30));
  });

  it('pending countdown updates when ticksLeft drops', () => {
    const s = progression();
    s.grade!.pending = { toGrade: 1, ticksLeft: 30 };
    panel.update(s);
    const before = q('[data-role="permit-pending"]')!.textContent;
    s.grade!.pending.ticksLeft = 5;
    panel.update(s);
    const after = q('[data-role="permit-pending"]')!.textContent;
    expect(after).not.toBe(before);
    expect(after).toContain(formatGameDuration(5));
  });

  it('Apply and pending block do not coexist, and the button returns when pending clears', () => {
    const s = progression();
    meet(s);
    s.grade!.pending = { toGrade: 1, ticksLeft: 3 };
    panel.update(s);
    s.grade!.pending = null;
    panel.update(s);
    expect(q('[data-role="permit-pending"]')).toBeNull();
    expect(applyBtn()).not.toBeNull();
  });

  it('after approval the stamp shows the new grade name', () => {
    const s = progression();
    s.grade!.grade = 1;
    panel.update(s);
    expect(q('[data-role="permit-stamp"]')!.textContent).toContain(t(gradeDef(1).nameKey));
  });

  it('refreshLocale re-renders in French', () => {
    const s = progression();
    panel.update(s);
    const en = panel.root.textContent;
    setLocale('fr');
    panel.refreshLocale();
    expect(panel.root.textContent).not.toBe(en);
    expect(panel.root.textContent).toContain(t(gradeDef(0).nameKey));
  });

  it('a state without grade shows the no-ladder text and no apply button or stamp', () => {
    const s = createGame({ seed: 1, mineType: 'desert' });
    expect(() => panel.update(s)).not.toThrow();
    expect(panel.root.textContent).toContain(t('permit.no_ladder'));
    expect(applyBtn()).toBeNull();
    expect(q('[data-role="permit-stamp"]')).toBeNull();
  });
});
