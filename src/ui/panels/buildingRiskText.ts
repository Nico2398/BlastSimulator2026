// BlastSimulator2026 — Player-facing text for a building at risk of a planned blast (#2021)

import { t } from '../../core/i18n/I18n.js';
import type { BuildingAtRisk } from '../../core/mining/BlastPlan.js';

export function buildingRiskText(b: BuildingAtRisk): string {
  const building = t(`building.${b.type}.name`);
  return t('ui.blast_workshop.preflight.warn_building', { building });
}
