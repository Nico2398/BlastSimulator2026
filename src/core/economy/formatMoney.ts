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

/**
 * Format a per-kilogram price: two decimals normally, three when the price is
 * under $1 — a contract offer generator produces raw floats like
 * "$0.6273750268155709/kg" for cheap rubble-disposal contracts, and two
 * decimals alone rounds those down to a misleading "$0.00/kg".
 *
 * @param price - Dollars per kg, possibly fractional.
 * @returns Grouped string with no currency symbol (callers add `$`).
 */
export function formatPricePerKg(price: number): string {
  const decimals = price < 1 ? 3 : 2;
  return price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
