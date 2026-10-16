// BlastSimulator2026 — start-level confirm copy (#1809)
import { describe, it, expect, vi } from 'vitest';
import { buildStartLevelConfirm, liveGameLabel } from '../../../../src/ui/screens/startLevelConfirm.js';
import { t, setLocale, getLocale } from '../../../../src/core/i18n/I18n.js';
import { getLevel } from '../../../../src/core/campaign/Level.js';

const AUTOSAVE = 'Your last autosave was 5 minutes ago.';
const tutorialName = () => t(getLevel('tutorial_pit')!.nameKey);
const dustyName = () => t(getLevel('dusty_hollow')!.nameKey);

describe('liveGameLabel', () => {
  it('labels the sandbox for null', () => {
    expect(liveGameLabel(null)).toBe(t('menu.sandbox'));
  });
  it('labels the sandbox for the "sandbox" id', () => {
    expect(liveGameLabel('sandbox')).toBe(t('menu.sandbox'));
  });
  it('labels a known level by its localized name', () => {
    expect(liveGameLabel('tutorial_pit')).toBe(tutorialName());
    expect(liveGameLabel('dusty_hollow')).toBe(dustyName());
  });
  it('falls back to the raw id for an unknown level without throwing', () => {
    expect(liveGameLabel('no_such_level')).toBe('no_such_level');
  });
});

describe('buildStartLevelConfirm', () => {
  it('uses the restart copy when the live level is the target', () => {
    const cfg = buildStartLevelConfirm(
      { liveLevelId: 'dusty_hollow', targetLevelId: 'dusty_hollow', autosaveText: AUTOSAVE }, vi.fn());
    expect(cfg.title).toBe(t('ui.portfolio.restart_confirm_title'));
    expect(cfg.body).toBe(t('ui.portfolio.restart_confirm_body'));
    expect(cfg.confirmLabel).toBe(t('ui.portfolio.restart_confirm_button'));
    expect(cfg.icon).toBe('blast');
  });

  it('names the sandbox and shows the autosave text when the live game is the sandbox (null)', () => {
    const cfg = buildStartLevelConfirm(
      { liveLevelId: null, targetLevelId: 'dusty_hollow', autosaveText: AUTOSAVE }, vi.fn());
    expect(cfg.title).toContain(t('menu.sandbox'));
    expect(cfg.body).toContain(AUTOSAVE);
    expect(cfg.confirmLabel).toBe(t('ui.portfolio.leave_confirm_button'));
    expect(cfg.icon).toBe('warn');
  });

  it('treats the "sandbox" id like a null live level', () => {
    const cfg = buildStartLevelConfirm(
      { liveLevelId: 'sandbox', targetLevelId: 'dusty_hollow', autosaveText: AUTOSAVE }, vi.fn());
    expect(cfg.title).toContain(t('menu.sandbox'));
    expect(cfg.icon).toBe('warn');
  });

  it('names the tutorial when it is live and another level is targeted', () => {
    const cfg = buildStartLevelConfirm(
      { liveLevelId: 'tutorial_pit', targetLevelId: 'dusty_hollow', autosaveText: AUTOSAVE }, vi.fn());
    expect(cfg.title).toContain(tutorialName());
    expect(cfg.body).toContain(AUTOSAVE);
    expect(cfg.icon).toBe('warn');
  });

  it('names a different live campaign level', () => {
    const cfg = buildStartLevelConfirm(
      { liveLevelId: 'dusty_hollow', targetLevelId: 'grumpstone_ridge', autosaveText: AUTOSAVE }, vi.fn());
    expect(cfg.title).toContain(dustyName());
    expect(cfg.title).not.toContain(t('menu.sandbox'));
  });

  it('does not throw for an unknown live id and names the raw id', () => {
    const cfg = buildStartLevelConfirm(
      { liveLevelId: 'mystery', targetLevelId: 'dusty_hollow', autosaveText: AUTOSAVE }, vi.fn());
    expect(cfg.title).toContain('mystery');
  });

  it('invokes onConfirm only when the config confirm callback runs', () => {
    const onConfirm = vi.fn();
    const cfg = buildStartLevelConfirm(
      { liveLevelId: null, targetLevelId: 'dusty_hollow', autosaveText: AUTOSAVE }, onConfirm);
    expect(onConfirm).not.toHaveBeenCalled();
    cfg.onConfirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('invokes onConfirm on the restart branch too', () => {
    const onConfirm = vi.fn();
    buildStartLevelConfirm(
      { liveLevelId: 'dusty_hollow', targetLevelId: 'dusty_hollow', autosaveText: '' }, onConfirm).onConfirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('leave-confirm i18n keys (#1809)', () => {
  it.each(['en', 'fr'] as const)('exist in %s and interpolate {game}', (locale) => {
    const prev = getLocale();
    setLocale(locale);
    try {
      const title = t('ui.portfolio.leave_confirm_title', { game: 'ZZGAME' });
      expect(title).not.toBe('ui.portfolio.leave_confirm_title');
      expect(title).toContain('ZZGAME');
      expect(t('ui.portfolio.leave_confirm_body', { game: 'ZZGAME' })).not.toBe('ui.portfolio.leave_confirm_body');
      expect(t('ui.portfolio.leave_confirm_button')).not.toBe('ui.portfolio.leave_confirm_button');
    } finally {
      setLocale(prev);
    }
  });
});
