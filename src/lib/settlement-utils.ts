import { addDays, isWeekend, format } from "date-fns";

/**
 * DSE Settlement Rules:
 * - Z Category: T+3 (trades settle 3 trading days later)
 * - Other Categories: T+2 (trades settle 2 trading days later)
 */

export function getSettlementDays(category: string | null | undefined): number {
  const cat = (category || "").toUpperCase().trim();
  return cat === "Z" ? 3 : 2;
}

/**
 * Calculate the settlement date for a trade, skipping weekends.
 * Does not account for market holidays (would need a holiday table for that).
 */
export function calculateSettlementDate(tradeDate: Date, category: string | null | undefined): Date {
  const settlementDays = getSettlementDays(category);
  let settleDate = new Date(tradeDate);
  let daysAdded = 0;

  while (daysAdded < settlementDays) {
    settleDate = addDays(settleDate, 1);
    // Skip weekends (Saturday = 6, Sunday = 0)
    if (!isWeekend(settleDate)) {
      daysAdded++;
    }
  }

  return settleDate;
}

/**
 * Check if a trade has settled as of a given date.
 */
export function isTradeSettled(
  tradeDate: Date,
  category: string | null | undefined,
  asOfDate: Date
): boolean {
  const settlementDate = calculateSettlementDate(tradeDate, category);
  return asOfDate >= settlementDate;
}

/**
 * Format a date for display in settlement context.
 */
export function formatSettlementDate(date: Date): string {
  return format(date, "dd MMM yyyy");
}

/**
 * Get T+N label for a category.
 */
export function getSettlementLabel(category: string | null | undefined): string {
  const days = getSettlementDays(category);
  return `T+${days}`;
}
