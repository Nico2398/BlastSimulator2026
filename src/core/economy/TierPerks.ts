// BlastSimulator2026 — Tier perks: the small bonus each ladder step adds on top of its caps (#2277)

/** Perks in force at a ladder step, summed over every step reached. */
export interface TierPerks {
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
export function tierPerksAt(_rung: number): TierPerks {
  throw new Error('not implemented');
}
