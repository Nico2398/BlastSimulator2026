// @vitest-environment jsdom
// BlastSimulator2026 — autosaveLossText (#1809)
import { describe, it, expect, vi } from 'vitest';
import { autosaveLossText, relativeTime, AUTO_SAVE_SLOT, TUTORIAL_AUTO_SAVE_SLOT } from '../../../src/ui/panels/SavesModal.js';
import { t } from '../../../src/core/i18n/I18n.js';
import type { SaveBackend, SaveMeta } from '../../../src/core/state/SaveBackend.js';

function meta(slotId: string, timestamp: number): SaveMeta {
  return { slotId, name: slotId, timestamp, version: 1, campaignSummary: '', levelId: null };
}
function backendWith(list: () => Promise<SaveMeta[]>): SaveBackend {
  return { save: vi.fn(), load: vi.fn(), list: vi.fn(list), delete: vi.fn() } as unknown as SaveBackend;
}

describe('autosaveLossText', () => {
  const none = () => t('ui.settings.return_confirm_body_none');

  it('returns the none text without a backend', async () => {
    expect(await autosaveLossText(null, 'dusty_hollow')).toBe(none());
  });

  it('returns the none text when list throws', async () => {
    const b = backendWith(async () => { throw new Error('boom'); });
    expect(await autosaveLossText(b, 'dusty_hollow')).toBe(none());
  });

  it('reports the age of the level auto slot', async () => {
    const ts = Date.now() - 5 * 60000;
    const b = backendWith(async () => [meta(AUTO_SAVE_SLOT, ts)]);
    expect(await autosaveLossText(b, 'dusty_hollow'))
      .toBe(t('ui.settings.return_confirm_body', { time: relativeTime(ts) }));
  });

  it('uses the sandbox/null level auto slot', async () => {
    const ts = Date.now() - 3 * 3600000;
    const b = backendWith(async () => [meta(AUTO_SAVE_SLOT, ts)]);
    expect(await autosaveLossText(b, null)).toBe(t('ui.settings.return_confirm_body', { time: relativeTime(ts) }));
    expect(await autosaveLossText(b, undefined)).toBe(t('ui.settings.return_confirm_body', { time: relativeTime(ts) }));
  });

  it('looks at the tutorial slot for the tutorial level', async () => {
    const ts = Date.now() - 2 * 86400000;
    const b = backendWith(async () => [meta(AUTO_SAVE_SLOT, Date.now()), meta(TUTORIAL_AUTO_SAVE_SLOT, ts)]);
    expect(await autosaveLossText(b, 'tutorial_pit'))
      .toBe(t('ui.settings.return_confirm_body', { time: relativeTime(ts) }));
  });

  it('returns the none text when only other slots exist', async () => {
    const b = backendWith(async () => [meta('slot_1', Date.now()), meta(TUTORIAL_AUTO_SAVE_SLOT, Date.now())]);
    expect(await autosaveLossText(b, 'dusty_hollow')).toBe(none());
  });

  it('returns the none text for an empty list', async () => {
    expect(await autosaveLossText(backendWith(async () => []), 'dusty_hollow')).toBe(none());
  });
});
