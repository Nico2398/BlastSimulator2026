// BlastSimulator2026 — Tier perks: the small bonus each ladder step adds on top of its caps (#2277)

import { MINE_GRADES, MINE_LAST_NAMED_RUNG, MINE_TIERS_PER_GRADE } from '../config/balance.js';

/** Perks in force at a ladder step, summed over every step reached. */
interface TierPerks {
  /** Percent off the notification fee of the permit limits. */
  notificationFeeDiscountPct: number;
  /** Percent off the processing time of a grade application. */
  processingDiscountPct: number;
  /** Percent off the chance an inspector turns up. */
  inspectionDiscountPct: number;
  /** Contract offers added to every board refresh. */
  extraContractOffers: number;
}

/** Perks of ladder step `rung` (grade x 3 + tier - 1; classes count as the last named step). */
export function tierPerksAt(rung: number): TierPerks {
  const perks: TierPerks = { notificationFeeDiscountPct: 0, processingDiscountPct: 0, inspectionDiscountPct: 0, extraContractOffers: 0 };
  const last = Math.min(Math.floor(rung), MINE_LAST_NAMED_RUNG);
  for (let r = 1; r <= last; r++) {
    const perk = MINE_GRADES[Math.floor(r / MINE_TIERS_PER_GRADE)]?.tiers[r % MINE_TIERS_PER_GRADE]?.perk;
    if (!perk) continue;
    switch (perk.kind) {
      case 'notification_fee_pct': perks.notificationFeeDiscountPct += perk.value; break;
      case 'processing_pct': perks.processingDiscountPct += perk.value; break;
      case 'inspection_pct': perks.inspectionDiscountPct += perk.value; break;
      case 'contract_offers': perks.extraContractOffers += perk.value; break;
    }
  }
  return perks;
}
