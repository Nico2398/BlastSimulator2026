// BlastSimulator2026 — Unit tests: replace-pattern confirm modal config (#1345)

import { describe, it, expect, vi } from 'vitest';
import { buildReplacePatternConfirm } from '../../../src/ui/replacePatternConfirm.js';
import { t } from '../../../src/core/i18n/I18n.js';

describe('buildReplacePatternConfirm', () => {
  it('interpolates the loss counts into the localized title, body and confirm label', () => {
    const cfg = buildReplacePatternConfirm({ drilled: 4, charged: 2 }, () => {});
    expect(cfg.title).toBe(t('ui.blast_workshop.drill.replace_confirm_title'));
    expect(cfg.body).toBe(t('ui.blast_workshop.drill.replace_confirm_body', { drilled: 4, charged: 2 }));
    expect(cfg.confirmLabel).toBe(t('ui.blast_workshop.drill.replace_confirm_confirm'));
  });

  it('runs the supplied callback on confirm', () => {
    const onConfirm = vi.fn();
    buildReplacePatternConfirm({ drilled: 1, charged: 0 }, onConfirm).onConfirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
