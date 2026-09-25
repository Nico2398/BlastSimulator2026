// BlastSimulator2026 — interaction-mode actions never call
// window.__placement.paintRect directly
//
// TODO: implement (issue #1209). `pickTile`/`dragTiles` in
// scripts/shared/interaction-executor.ts's executeActionOnPage switch
// currently call __placement.paintRect(...) straight from page.evaluate,
// bypassing real mouse input the way NoBareSelectorClick.test.ts's PRIMITIVE
// bypasses page.click(). Once the fix folds both cases into the existing
// 'set'/'clickLabel'/.../'clickEntity' branch that forwards through
// runAction (interaction-driver.ts), only command-mode's own paintRect
// caller should remain — mirror NoBareSelectorClick.test.ts's
// listTsFiles/bareClickLines-style scan (same file, scripts/shared/
// click-retry.ts's ROOT/SCANNED_DIR/ALLOWLIST pattern) for
// `__placement.paintRect(` call sites here.

import { describe, it } from 'vitest';
import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '../../..');
export const SCANNED_DIR = 'scripts';

/** Files allowed to call `__placement.paintRect` directly, each with the reason. */
export const ALLOWLIST: Readonly<Record<string, string>> = {
  // TODO: implement — populate with any command-mode-only caller exempt from
  // this rule, matching NoBareSelectorClick.test.ts's ALLOWLIST shape.
};

describe('repo-wide — interaction actions never call __placement.paintRect directly (issue #1209)', () => {
  it.todo('no interaction-executor action file calls __placement.paintRect() directly');

  it.todo('every allowlist entry still calls __placement.paintRect() — a stale entry is removed, not kept');
});
