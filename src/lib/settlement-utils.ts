import { addDays, format } from "date-fns";

/**
 * DSE Settlement Rules:
 * - Z Category: T+3 (trades settle 3 trading days later)
 * - Other Categories: T+2 (trades settle 2 trading days later)
 * 
 * Bangladesh Stock Exchange uses Friday/Saturday as weekends (not Saturday/Sunday).
 */

// Bangladesh Bank Holidays (2024-2026)
// These can be updated annually or moved to database for easier management
export const BANGLADESH_BANK_HOLIDAYS: string[] = [
  // 2024 Holidays
  "2024-02-21", // Shaheed Day
  "2024-03-17", // Sheikh Mujibur Rahman's Birthday
  "2024-03-26", // Independence Day
  "2024-04-14", // Bengali New Year
  "2024-05-01", // May Day
  "2024-08-15", // National Mourning Day
  "2024-12-16", // Victory Day
  "2024-12-25", // Christmas Day
  // 2025 Holidays
  "2025-01-01", // New Year's Day
  "2025-02-21", // Shaheed Day
  "2025-03-17", // Sheikh Mujibur Rahman's Birthday
  "2025-03-26", // Independence Day
  "2025-03-31", // Eid ul-Fitr
  "2025-04-01", // Eid ul-Fitr (2nd day)
  "2025-04-02", // Eid ul-Fitr (3rd day)
  "2025-04-14", // Bengali New Year
  "2025-05-01", // May Day
  "2025-06-07", // Eid ul-Adha
  "2025-06-08", // Eid ul-Adha (2nd day)
  "2025-06-09", // Eid ul-Adha (3rd day)
  "2025-07-06", // Ashura
  "2025-08-15", // National Mourning Day
  "2025-09-05", // Eid-e-Miladunnabi
  "2025-10-02", // Durga Puja
  "2025-12-16", // Victory Day
  "2025-12-25", // Christmas Day
  // 2026 Holidays (estimated - Islamic dates vary)
  "2026-01-01", // New Year's Day
  "2026-02-21", // Shaheed Day
  "2026-03-17", // Sheikh Mujibur Rahman's Birthday
  "2026-03-20", // Eid ul-Fitr (estimated)
  "2026-03-21", // Eid ul-Fitr (2nd day)
  "2026-03-22", // Eid ul-Fitr (3rd day)
  "2026-03-26", // Independence Day
  "2026-04-14", // Bengali New Year
  "2026-05-01", // May Day
  "2026-05-27", // Eid ul-Adha (estimated)
  "2026-05-28", // Eid ul-Adha (2nd day)
  "2026-05-29", // Eid ul-Adha (3rd day)
  "2026-06-25", // Ashura (estimated)
  "2026-08-15", // National Mourning Day
  "2026-08-25", // Eid-e-Miladunnabi (estimated)
  "2026-10-21", // Durga Puja (estimated)
  "2026-12-16", // Victory Day
  "2026-12-25", // Christmas Day
];

export function getSettlementDays(category: string | null | undefined): number {
  const cat = (category || "").toUpperCase().trim();
  return cat === "Z" ? 3 : 2;
}

/**
 * Check if a date is a Bangladesh weekend (Friday or Saturday).
 * Bangladesh Stock Exchange is closed on Friday and Saturday.
 */
export function isBangladeshWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 5 || day === 6; // Friday=5, Saturday=6
}

/**
 * Check if a date is a Bangladesh bank holiday.
 */
export function isBankHoliday(date: Date): boolean {
  const dateStr = format(date, 'yyyy-MM-dd');
  return BANGLADESH_BANK_HOLIDAYS.includes(dateStr);
}

/**
 * Check if a date is a non-trading day (weekend or holiday).
 */
export function isNonTradingDay(date: Date): boolean {
  return isBangladeshWeekend(date) || isBankHoliday(date);
}

/**
 * Calculate the settlement date for a trade, skipping Bangladesh weekends and holidays.
 * 
 * @param tradeDate - The trade execution date
 * @param category - The security category (Z = T+3, others = T+2)
 * @returns The settlement date
 */
export function calculateSettlementDate(tradeDate: Date, category: string | null | undefined): Date {
  const settlementDays = getSettlementDays(category);
  let settleDate = new Date(tradeDate);
  let daysAdded = 0;

  while (daysAdded < settlementDays) {
    settleDate = addDays(settleDate, 1);
    // Skip Bangladesh weekends (Fri/Sat) and bank holidays
    if (!isNonTradingDay(settleDate)) {
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

/**
 * Format time from HHMMSS to HH:MM:SS for display.
 */
export function formatTimeForDisplay(hhmmss: string): string {
  if (hhmmss && hhmmss.length === 6 && /^\d{6}$/.test(hhmmss)) {
    return `${hhmmss.slice(0, 2)}:${hhmmss.slice(2, 4)}:${hhmmss.slice(4, 6)}`;
  }
  return hhmmss;
}

/**
 * Format date from YYYYMMDD to YYYY-MM-DD for display.
 */
export function formatDateForDisplay(yyyymmdd: string): string {
  if (yyyymmdd && yyyymmdd.length === 8 && /^\d{8}$/.test(yyyymmdd)) {
    return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
  }
  return yyyymmdd;
}
