// BlastSimulator2026 — Money formatting for player-facing messages
// Cash is a float; printing it raw leaks the accumulated rounding error
// ("have $-5839.852589446586") into messages the player reads.

/**
 * Format a cash amount for a message: whole dollars, thousands separators, and
 * the sign in front of the amount.
 *
 * @param amount - Dollar value, possibly fractional and possibly negative.
 * @returns Rounded, grouped string with no currency symbol (callers add `$`).
 */
export function formatMoney(amount: number): string {
  const rounded = Math.round(amount);
  const magnitude = Math.abs(rounded).toLocaleString('en-US');
  return rounded < 0 ? `-${magnitude}` : magnitude;
}
