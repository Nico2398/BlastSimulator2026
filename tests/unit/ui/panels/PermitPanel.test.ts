// @vitest-environment jsdom
// BlastSimulator2026 — PermitPanel (#1924): grade stamp, target bars, apply button, pending countdown.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PermitPanel } from '../../../../src/ui/panels/PermitPanel.js';
import { createGame, type GameState } from '../../../../src/core/state/GameState.js';
import { createGradeState, gradeDef, nextGradeTargets, currentTierTargets, permitApplyBlocker, formatGradeAmount } from '../../../../src/core/economy/MineGrade.js';
import { permitRefusalText } from '../../../../src/core/economy/permitRefusalText.js';
import { formatGameDuration } from '../../../../src/ui/formatGameDuration.js';
import { formatMoney } from '../../../../src/core/economy/formatMoney.js';
import { permitLimitsFor } from '../../../../src/core/economy/PermitLimits.js';
import { setLocale, t } from '../../../../src/core/i18n/I18n.js';
import { createQuestState, completeQuest } from '../../../../src/core/economy/Quests.js';
import { getAllQuests, getQuest } from '../../../../src/core/economy/QuestCatalog.js';
import { explosivesOfTier } from '../../../../src/core/world/ExplosiveCatalog.js';
import { placeBuilding } from '../../../../src/core/entities/Building.js';
import { createEmployeeState, hireEmployee } from '../../../../src/core/entities/Employee.js';
import { Random } from '../../../../src/core/math/Random.js';
import { meetTargets, tierTargets } from '../../../helpers/gradeLadder.js';
import { MINE_GRADES, PERMIT_STRIKES_TO_SUSPEND, PERMIT_STRIKE_WINDOW_TICKS, PERMIT_SUSPENSION_TICKS } from '../../../../src/core/config/balance.js';

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

/** Tier 3 of grade 0 with the tier-3 targets and the zone mastery met: the grade-up application is open. */
function meet(s: GameState): void {
  s.grade!.tier = 3;
  meetTargets(s, tierTargets(0, 3));
  meetTargets(s, MINE_GRADES[0]!.mastery);
}

/** The grade-up checklist rows: `[data-target]` rows outside the tier blocks. */
const checklistRows = (): HTMLElement[] =>
  Array.from(panel.root.querySelectorAll<HTMLElement>('[data-target]')).filter(r => !r.closest('[data-role="permit-tier"]'));
const tierEls = (): HTMLElement[] => Array.from(panel.root.querySelectorAll<HTMLElement>('[data-role="permit-tier"]'));
const gradeEls = (): HTMLElement[] => Array.from(panel.root.querySelectorAll<HTMLElement>('[data-role="permit-grade"]'));

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
  it('shows charge, pattern area and fee limits of the current grade and tier', () => {
    const s = progression();
    s.grade!.grade = 1;
    s.grade!.tier = 2;
    panel.update(s);
    const lim = permitLimitsFor(1, 2);
    const text = q('[data-role="permit-limits"]')!.textContent!;
    expect(text).toContain(`${lim.maxChargeKg} kg`);
    expect(text).toContain(`${lim.maxAreaM2} m²`);
    expect(text).not.toMatch(/\bholes\b/);
    expect(text).toContain(formatMoney(lim.fee));
    expect(q('[data-role="permit-strikes"]')!.textContent).toBe(t('permit.status.strikes', { count: 0 }));
  });

  it('shows live strikes and refreshes when they change', () => {
    const s = progression();
    panel.update(s);
    s.tickCount = 100;
    s.grade!.strikeTicks = [90, 95];
    panel.update(s);
    expect(q('[data-role="permit-strikes"]')!.textContent).toBe(t('permit.status.strikes', { count: 2 }));
    s.tickCount = 100_000;
    panel.update(s);
    expect(q('[data-role="permit-strikes"]')!.textContent).toBe(t('permit.status.strikes', { count: 0 }));
  });

  it('root id is bs-permit-panel', () => {
    expect(panel.root.id).toBe('bs-permit-panel');
  });

  it('shows the grade name and a stamp badge', () => {
    panel.update(progression());
    const stamp = q('[data-role="permit-stamp"]');
    expect(stamp).not.toBeNull();
    expect(stamp!.textContent).toContain(t(gradeDef(0).nameKey));
  });

  it('renders one checklist row per grade-up target: tier-3 targets plus the zone mastery', () => {
    const s = progression();
    panel.update(s);
    const targets = nextGradeTargets(s);
    expect(targets.length).toBeGreaterThan(0);
    const rows = checklistRows();
    expect(rows).toHaveLength(targets.length);
    expect(new Set(rows.map(r => r.dataset['target']))).toEqual(new Set(targets.map(x => x.kind)));
  });

  it('checklist bar width is min(100, current/needed*100)% and met rows are flagged', () => {
    const s = progression();
    s.grade!.oreDeliveredKg = 2_500;
    s.grade!.blastsFired = 9; // over every blasts target
    panel.update(s);
    const targets = nextGradeTargets(s);
    const rows = checklistRows();
    rows.forEach((row, i) => {
      const tg = targets[i]!;
      expect(row.dataset['target']).toBe(tg.kind);
      const bar = row.querySelector<HTMLElement>('[data-role="target-bar"]')!;
      expect(bar.style.width).toBe(`${Math.min(100, (tg.current / tg.needed) * 100)}%`);
      expect(row.dataset['met']).toBe(String(tg.met));
    });
    expect(rows.some(r => r.dataset['target'] === 'blasts' && r.dataset['met'] === 'true')).toBe(true);
    expect(rows.some(r => r.dataset['target'] === 'ore_kg' && r.dataset['met'] !== 'true')).toBe(true);
  });

  it('checklist row text carries current and needed values', () => {
    const s = progression();
    s.grade!.blastsFired = 1;
    panel.update(s);
    const need = tierTargets(0, 3).find(x => x.kind === 'blasts')!.value;
    const row = checklistRows().find(r => r.dataset['target'] === 'blasts')!;
    expect(row.textContent).toContain(t('permit.target.blasts', { current: '1', needed: String(need) }));
  });

  it('shows the fee of the next grade', () => {
    panel.update(progression());
    expect(panel.root.textContent).toContain(formatMoney(gradeDef(1).fee));
  });

  it('tier 1: Apply is disabled and the reason is the tier_incomplete refusal', () => {
    const s = progression();
    panel.update(s);
    const btn = applyBtn()!;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
    expect(permitApplyBlocker(s)!.refusal).toBe('tier_incomplete');
    expect(reason()).toBe(permitRefusalText('tier_incomplete', [], gradeDef(1).fee, s.cash));
  });

  it('tier 3 with the tier targets met but the mastery short: Apply is disabled, naming the unmet target', () => {
    const s = progression();
    s.grade!.tier = 3;
    meetTargets(s, tierTargets(0, 3));
    panel.update(s);
    expect(applyBtn()!.disabled).toBe(true);
    const b = permitApplyBlocker(s)!;
    expect(b.refusal).toBe('unmet_targets');
    expect(reason()).toBe(permitRefusalText(b.refusal, b.unmet, gradeDef(1).fee, s.cash));
  });

  it('unmet targets: Apply is disabled and the reason equals permitRefusalText', () => {
    const s = progression();
    s.grade!.tier = 3;
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

  it('a tier-up re-renders: the Apply button follows the tier without a reopen', () => {
    const s = progression();
    s.grade!.tier = 3;
    meetTargets(s, tierTargets(0, 3));
    meetTargets(s, MINE_GRADES[0]!.mastery);
    s.grade!.tier = 2;
    panel.update(s);
    expect(applyBtn()!.disabled).toBe(true);
    s.grade!.tier = 3;
    panel.update(s);
    expect(applyBtn()!.disabled).toBe(false);
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

  it('a state without grade shows the no-ladder text and no apply button, stamp, grades or tiers', () => {
    const s = createGame({ seed: 1, mineType: 'desert' });
    expect(() => panel.update(s)).not.toThrow();
    expect(panel.root.textContent).toContain(t('permit.no_ladder'));
    expect(applyBtn()).toBeNull();
    expect(q('[data-role="permit-stamp"]')).toBeNull();
    expect(gradeEls()).toHaveLength(0);
    expect(tierEls()).toHaveLength(0);
  });
});

describe('PermitPanel — four grades and three tiers (#2277)', () => {
  it('lists the four named grades, in order, each with its name', () => {
    panel.update(progression());
    const els = gradeEls();
    expect(els.map(e => e.dataset['grade'])).toEqual(['0', '1', '2', '3']);
    els.forEach((e, g) => expect(e.textContent).toContain(t(`permit.grade.${g}`)));
  });

  it.each([0, 1, 2, 3])('marks only grade %i as current', (grade) => {
    const s = progression();
    s.grade!.grade = grade;
    panel.update(s);
    const current = gradeEls().filter(e => e.dataset['current'] === 'true');
    expect(current.map(e => e.dataset['grade'])).toEqual([String(grade)]);
  });

  it('the current mark moves when the grade is approved', () => {
    const s = progression();
    panel.update(s);
    expect(gradeEls().find(e => e.dataset['current'] === 'true')!.dataset['grade']).toBe('0');
    s.grade!.grade = 1;
    panel.update(s);
    expect(gradeEls().find(e => e.dataset['current'] === 'true')!.dataset['grade']).toBe('1');
  });

  it('shows the three tiers of the current grade, numbered 1-3', () => {
    panel.update(progression());
    expect(tierEls().map(e => e.dataset['tier'])).toEqual(['1', '2', '3']);
  });

  it.each([
    [1, ['current', 'locked', 'locked']],
    [2, ['done', 'current', 'locked']],
    [3, ['done', 'done', 'current']],
  ])('at tier %i the tier blocks read %j', (tier, states) => {
    const s = progression();
    s.grade!.tier = tier;
    panel.update(s);
    expect(tierEls().map(e => e.dataset['state'])).toEqual(states);
  });

  it('a tier-up flips the states on the next update', () => {
    const s = progression();
    panel.update(s);
    expect(tierEls().map(e => e.dataset['state'])).toEqual(['current', 'locked', 'locked']);
    s.grade!.tier = 2;
    panel.update(s);
    expect(tierEls().map(e => e.dataset['state'])).toEqual(['done', 'current', 'locked']);
  });

  it('the tiers follow the grade: grade 2 shows grade 2\'s tiers, back at tier 1', () => {
    const s = progression();
    s.grade!.grade = 2;
    panel.update(s);
    expect(tierEls().map(e => e.dataset['state'])).toEqual(['current', 'locked', 'locked']);
    const tier1 = tierEls()[0]!;
    for (const tg of tierTargets(2, 1)) expect(tier1.textContent).toContain(formatGradeAmount(tg.value));
  });

  it('every tier block carries its own target values', () => {
    panel.update(progression());
    tierEls().forEach((el, i) => {
      for (const tg of tierTargets(0, i + 1)) expect(el.textContent, `tier ${i + 1} ${tg.kind}`).toContain(formatGradeAmount(tg.value));
    });
  });

  it('the current tier shows live progress for each of its targets', () => {
    const s = progression();
    s.grade!.oreDeliveredKg = 300;
    panel.update(s);
    const cur = tierEls().find(e => e.dataset['state'] === 'current')!;
    for (const tg of currentTierTargets(s)) {
      expect(cur.textContent).toContain(t(`permit.target.${tg.kind}`, { current: formatGradeAmount(tg.current), needed: formatGradeAmount(tg.needed) }));
    }
  });

  it('the live progress moves with the counters', () => {
    const s = progression();
    panel.update(s);
    const before = tierEls().find(e => e.dataset['state'] === 'current')!.textContent;
    s.grade!.oreDeliveredKg = 123;
    panel.update(s);
    expect(tierEls().find(e => e.dataset['state'] === 'current')!.textContent).not.toBe(before);
  });

  it('shows a perk line in every tier that grants one, a different one per tier', () => {
    const s = progression();
    s.grade!.grade = 1;
    panel.update(s);
    const perks = tierEls().map(e => e.querySelector('[data-role="tier-perk"]')?.textContent?.trim() ?? '');
    expect(perks).toHaveLength(3);
    for (const p of perks) {
      expect(p.length).toBeGreaterThan(0);
      expect(p).not.toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    }
    expect(new Set(perks).size).toBe(3);
  });

  it('speaks French in the perk lines after a locale change', () => {
    const s = progression();
    s.grade!.grade = 1;
    panel.update(s);
    const en = tierEls().map(e => e.querySelector('[data-role="tier-perk"]')?.textContent);
    setLocale('fr');
    panel.refreshLocale();
    const fr = tierEls().map(e => e.querySelector('[data-role="tier-perk"]')?.textContent);
    expect(fr).not.toEqual(en);
    expect(fr.every(x => (x ?? '').length > 0)).toBe(true);
  });

  it('keeps the grade-up checklist rows apart from the tier blocks', () => {
    const s = progression();
    panel.update(s);
    expect(checklistRows()).toHaveLength(nextGradeTargets(s).length);
    expect(panel.root.querySelectorAll('[data-action="permit-apply"]')).toHaveLength(1);
  });

  it('an endless class has no tier blocks, but keeps its checklist and apply block', () => {
    const s = progression();
    s.grade!.grade = 4;
    expect(() => panel.update(s)).not.toThrow();
    expect(tierEls()).toHaveLength(0);
    expect(checklistRows()).toHaveLength(nextGradeTargets(s).length);
    expect(applyBtn()).not.toBeNull();
  });
});

describe('PermitPanel — strikes explanation (#2170)', () => {
  const explain = (): string => q('[data-role="permit-strikes"]')?.dataset['explain'] ?? '';
  const quotes = (text: string, n: number): boolean =>
    text.includes(String(n)) || text.includes(n.toLocaleString('en-US')) || text.includes(formatGameDuration(n));

  it('explains the strikes line with the balance numbers', () => {
    panel.update(progression());
    const text = explain();
    expect(text).toContain(String(PERMIT_STRIKES_TO_SUSPEND));
    expect(quotes(text, PERMIT_STRIKE_WINDOW_TICKS)).toBe(true);
    expect(quotes(text, PERMIT_SUSPENSION_TICKS)).toBe(true);
    expect(text).toMatch(/blast/i);
  });

  it('still explains once strikes have accrued', () => {
    const s = progression();
    s.tickCount = 100;
    s.grade!.strikeTicks = [90, 95];
    panel.update(s);
    expect(explain()).toContain(String(PERMIT_STRIKES_TO_SUSPEND));
    expect(q('[data-role="permit-strikes"]')!.textContent).toBe(t('permit.status.strikes', { count: 2 }));
  });

  it('keeps the visible strikes text apart from the explanation', () => {
    panel.update(progression());
    expect(explain()).not.toBe(q('[data-role="permit-strikes"]')!.textContent);
  });

  it('speaks French after a locale change', () => {
    panel.update(progression());
    const en = explain();
    setLocale('fr');
    panel.refreshLocale();
    panel.update(progression());
    expect(explain().length).toBeGreaterThan(0);
    expect(explain()).not.toBe(en);
  });
});

describe('PermitPanel — the Progression panel and its quests (#2280)', () => {
  const T2 = 'quest_explosive_t2';
  const T3 = 'quest_explosive_t3';

  function questSite(): GameState {
    const s = progression();
    s.quests = createQuestState();
    s.scores.safety = 0;
    return s;
  }

  const questEls = (): HTMLElement[] => Array.from(panel.root.querySelectorAll<HTMLElement>('[data-role="quest"]'));
  const questEl = (id: string): HTMLElement => questEls().find(e => e.dataset['questId'] === id)!;
  const objectives = (id: string): HTMLElement[] =>
    Array.from(questEl(id).querySelectorAll<HTMLElement>('[data-role="quest-objective"]'));
  const objective = (id: string, kind: string): HTMLElement => objectives(id).find(o => o.dataset['kind'] === kind)!;
  const barWidth = (row: HTMLElement): string => {
    const bar = row.querySelector<HTMLElement>('[data-role="quest-bar"]')!;
    return (bar.querySelector<HTMLElement>('.bsx-progress-fill') ?? bar).style.width;
  };
  const names = (tier: 2 | 3): string[] => explosivesOfTier(tier).map(e => t(e.nameKey));

  it('the panel is titled PROGRESSION and keeps its root id', () => {
    panel.update(questSite());
    expect(panel.root.textContent).toContain('PROGRESSION');
    expect(panel.root.id).toBe('bs-permit-panel');
  });

  it('lists every quest from the start, all available', () => {
    panel.update(questSite());
    expect(questEls().map(e => e.dataset['questId']).sort()).toEqual(getAllQuests().map(q => q.id).sort());
    for (const e of questEls()) expect(e.dataset['state']).toBe('available');
  });

  it('keeps the grade ladder beside the quests', () => {
    panel.update(questSite());
    expect(gradeEls()).toHaveLength(4);
    expect(tierEls()).toHaveLength(3);
    expect(applyBtn()).not.toBeNull();
    expect(checklistRows().length).toBeGreaterThan(0);
    expect(q('[data-role="permit-stamp"]')).not.toBeNull();
  });

  it('quest objective rows never count as grade-up checklist rows', () => {
    const s = questSite();
    panel.update(s);
    expect(checklistRows()).toHaveLength(nextGradeTargets(s).length);
  });

  it('shows each quest title and its giver', () => {
    panel.update(questSite());
    for (const def of getAllQuests()) {
      const el = questEl(def.id);
      expect(el.textContent).toContain(t(def.titleKey));
      expect(el.querySelector('[data-role="quest-giver"]')!.textContent).toContain(t(def.giverKey));
    }
  });

  it('renders one objective row per objective, with its kind', () => {
    panel.update(questSite());
    expect(objectives(T2).map(o => o.dataset['kind']).sort()).toEqual(['clean_blasts', 'explosive_kg']);
    expect(objectives(T3).map(o => o.dataset['kind']).sort()).toEqual(['clean_blasts', 'rock_kg', 'safety_score']);
  });

  it('objectives start unmet with an empty bar', () => {
    panel.update(questSite());
    for (const o of objectives(T2)) {
      expect(o.dataset['met']).toBe('false');
      expect(barWidth(o)).toBe('0%');
    }
  });

  it('shows live progress text with current and needed, and it moves with the counters', () => {
    const s = questSite();
    panel.update(s);
    const before = objective(T2, 'explosive_kg').textContent;
    s.quests!.cleanBlasts = 1;
    s.quests!.explosiveKg = 40;
    panel.update(s);
    expect(objective(T2, 'explosive_kg').textContent).not.toBe(before);
    expect(objective(T2, 'explosive_kg').textContent).toMatch(/40[\s\S]*100/);
    expect(objective(T2, 'clean_blasts').textContent).toMatch(/1[\s\S]*2/);
  });

  it('bar width is min(100, current / needed * 100)% and the met flag follows', () => {
    const s = questSite();
    s.quests!.cleanBlasts = 1;
    s.quests!.explosiveKg = 40;
    panel.update(s);
    expect(barWidth(objective(T2, 'clean_blasts'))).toBe('50%');
    expect(barWidth(objective(T2, 'explosive_kg'))).toBe('40%');
    expect(objective(T2, 'clean_blasts').dataset['met']).toBe('false');
    s.quests!.cleanBlasts = 7;
    s.quests!.explosiveKg = 100;
    panel.update(s);
    expect(barWidth(objective(T2, 'clean_blasts'))).toBe('100%');
    expect(barWidth(objective(T2, 'explosive_kg'))).toBe('100%');
    expect(objective(T2, 'clean_blasts').dataset['met']).toBe('true');
    expect(objective(T2, 'explosive_kg').dataset['met']).toBe('true');
  });

  it('the safety objective follows the live safety score', () => {
    const s = questSite();
    s.scores.safety = 30;
    panel.update(s);
    expect(barWidth(objective(T3, 'safety_score'))).toBe('50%');
    expect(objective(T3, 'safety_score').dataset['met']).toBe('false');
    s.scores.safety = 75;
    panel.update(s);
    expect(objective(T3, 'safety_score').dataset['met']).toBe('true');
  });

  it('names the explosives each quest makes purchasable', () => {
    panel.update(questSite());
    const t2 = questEl(T2).querySelector('[data-role="quest-reward"]')!.textContent!;
    expect(names(2).some(n => t2.includes(n))).toBe(true);
    const t3 = questEl(T3).querySelector('[data-role="quest-reward"]')!.textContent!;
    expect(names(3).some(n => t3.includes(n))).toBe(true);
  });

  it('T3 carries a prerequisite note naming the T2 quest while T2 is open; T2 carries none', () => {
    panel.update(questSite());
    const note = questEl(T3).querySelector('[data-role="quest-requires"]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain(t(getQuest(T2)!.titleKey));
    expect(questEl(T2).querySelector('[data-role="quest-requires"]')).toBeNull();
  });

  it('the prerequisite note goes once T2 is completed', () => {
    const s = questSite();
    panel.update(s);
    completeQuest(s, T2);
    panel.update(s);
    expect(questEl(T3).querySelector('[data-role="quest-requires"]')).toBeNull();
  });

  it('a completed quest reads completed on the next update, the other stays available', () => {
    const s = questSite();
    panel.update(s);
    completeQuest(s, T2);
    panel.update(s);
    expect(questEl(T2).dataset['state']).toBe('completed');
    expect(questEl(T3).dataset['state']).toBe('available');
  });

  it('a completed quest still shows its title and reward', () => {
    const s = questSite();
    completeQuest(s, T2);
    panel.update(s);
    expect(questEl(T2).textContent).toContain(t(getQuest(T2)!.titleKey));
    expect(questEl(T2).querySelector('[data-role="quest-reward"]')).not.toBeNull();
  });

  it('a site without quests shows no quest cards, and still shows the ladder', () => {
    panel.update(progression());
    expect(questEls()).toHaveLength(0);
    expect(gradeEls()).toHaveLength(4);
  });

  it('a state without a ladder or quests shows no quest cards', () => {
    panel.update(createGame({ seed: 1, mineType: 'desert' }));
    expect(questEls()).toHaveLength(0);
  });

  it('refreshLocale re-renders the quest card in French', () => {
    const s = questSite();
    panel.update(s);
    const en = questEl(T2).textContent;
    setLocale('fr');
    panel.refreshLocale();
    expect(questEl(T2).textContent).not.toBe(en);
    expect(questEl(T2).textContent).toContain(t(getQuest(T2)!.titleKey));
  });

  it('re-rendering on every update does not duplicate quest cards', () => {
    const s = questSite();
    panel.update(s);
    panel.update(s);
    panel.update(s);
    expect(questEls()).toHaveLength(getAllQuests().length);
    expect(objectives(T2)).toHaveLength(2);
  });

  describe('building-tier quests (#2283 C9)', () => {
    const B2 = 'quest_building_t2';
    const B3 = 'quest_building_t3';
    const allExplosiveNames = (): string[] => [...names(2), ...names(3)];

    /** Bring the number of standing buildings up to `n`. */
    function standBuildings(s: GameState, n: number): void {
      for (let i = s.buildings.buildings.length; i < n; i++) {
        const type = i === 0 ? 'living_quarters' : 'management_office';
        expect(placeBuilding(s.buildings, type, 4 + i * 8, 20, 128, 128).success).toBe(true);
      }
    }

    it('lists the building quests beside the explosive ones, all available', () => {
      panel.update(questSite());
      expect(questEls().map(e => e.dataset['questId'])).toEqual(expect.arrayContaining([B2, B3, T2, T3]));
      expect(questEl(B2).dataset['state']).toBe('available');
      expect(questEl(B3).dataset['state']).toBe('available');
    });

    it('shows the architect as giver and the quest title', () => {
      panel.update(questSite());
      expect(questEl(B2).querySelector('[data-role="quest-giver"]')!.textContent).toContain(t('quest.giver.architect'));
      expect(questEl(B2).textContent).toContain(t(getQuest(B2)!.titleKey));
    });

    it('renders one objective row per objective, with its kind', () => {
      panel.update(questSite());
      expect(objectives(B2).map(o => o.dataset['kind']).sort()).toEqual(['buildings_built', 'crew_housed']);
      expect(objectives(B3).map(o => o.dataset['kind']).sort()).toEqual(['buildings_built', 'crew_housed', 'safety_score']);
    });

    it('the buildings objective follows the standing buildings: text, bar and met flag', () => {
      const s = questSite();
      panel.update(s);
      expect(objective(B2, 'buildings_built').dataset['met']).toBe('false');
      expect(barWidth(objective(B2, 'buildings_built'))).toBe('0%');
      standBuildings(s, 2);
      panel.update(s);
      expect(barWidth(objective(B2, 'buildings_built'))).toBe('50%');
      expect(objective(B2, 'buildings_built').textContent).toMatch(/2[\s\S]*4/);
      standBuildings(s, 4);
      panel.update(s);
      expect(barWidth(objective(B2, 'buildings_built'))).toBe('100%');
      expect(objective(B2, 'buildings_built').dataset['met']).toBe('true');
    });

    it('the housed-crew objective follows the roster against the beds', () => {
      const s = questSite();
      standBuildings(s, 1);
      panel.update(s);
      expect(objective(B2, 'crew_housed').dataset['met']).toBe('false');
      const pool = createEmployeeState();
      for (let i = 0; i < 2; i++) {
        const { employee } = hireEmployee(pool, 'driller', new Random(10 + i), 0, 0);
        employee.id = 500 + i;
        s.employees.employees.push(employee);
      }
      panel.update(s);
      expect(objective(B2, 'crew_housed').dataset['met']).toBe('true');
      expect(barWidth(objective(B2, 'crew_housed'))).toBe('100%');
    });

    it('the reward line names the building tier, not explosives', () => {
      panel.update(questSite());
      for (const [id, tier] of [[B2, 2], [B3, 3]] as const) {
        const reward = questEl(id).querySelector('[data-role="quest-reward"]')!.textContent!;
        expect(reward, id).toContain(String(tier));
        for (const name of allExplosiveNames()) expect(reward, `${id} ${name}`).not.toContain(name);
        expect(reward).not.toMatch(/\{\w+\}|quest\.|undefined|NaN/);
        expect(reward).not.toBe(questEl(T2).querySelector('[data-role="quest-reward"]')!.textContent);
      }
    });

    it('the explosive quests keep naming their explosives', () => {
      panel.update(questSite());
      const t2 = questEl(T2).querySelector('[data-role="quest-reward"]')!.textContent!;
      expect(names(2).some(n => t2.includes(n))).toBe(true);
    });

    it('the building T3 quest carries a prerequisite note naming the building T2 quest', () => {
      panel.update(questSite());
      const note = questEl(B3).querySelector('[data-role="quest-requires"]');
      expect(note).not.toBeNull();
      expect(note!.textContent).toContain(t(getQuest(B2)!.titleKey));
      expect(questEl(B2).querySelector('[data-role="quest-requires"]')).toBeNull();
    });

    it('a completed building quest reads completed and the other stays available', () => {
      const s = questSite();
      panel.update(s);
      completeQuest(s, B2);
      panel.update(s);
      expect(questEl(B2).dataset['state']).toBe('completed');
      expect(questEl(B3).dataset['state']).toBe('available');
      expect(questEl(T2).dataset['state']).toBe('available');
    });

    it('renders in French without raw keys', () => {
      const s = questSite();
      setLocale('fr');
      panel.refreshLocale();
      panel.update(s);
      expect(questEl(B2).textContent).toContain(t(getQuest(B2)!.titleKey));
      expect(questEl(B2).textContent).not.toMatch(/quest\.|\{\w+\}/);
    });
  });
});
