// BlastSimulator2026 — Player-facing text for a predicted wall slump (#1943)

import { t } from '../../core/i18n/I18n.js';
import { getRock } from '../../core/world/RockCatalog.js';
import type { PredictedFace } from '../../core/mining/WallStability.js';

/** "This shot leaves a 22 m face in molite (safe: 15 m). It may slump." The preflight row passes its own key. */
export function wallWarningText(w: PredictedFace, key = 'ui.blast_workshop.preview.wall_warning'): string {
  const rock = getRock(w.rockId);
  return t(key, {
    height: Math.round(w.face.heightM),
    rock: rock ? t(rock.nameKey) : w.rockId,
    safe: Math.round(w.face.safeM),
  });
}
