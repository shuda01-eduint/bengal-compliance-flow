import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

export interface EodStagingSummary {
  totalDeposits: number;
  totalWithdrawals: number;
  depositCount: number;
  withdrawalCount: number;
}

/**
 * Hook to fetch current staging totals from cash_ledger_txn for a selected date.
 * This provides real-time data from the staging table, which may differ from
 * the historical EOD data if imports occurred after the last EOD run.
 */
export function useEodStagingSummary(selectedDate: Date | undefined) {
  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;

  return useQuery({
    queryKey: ["eod-staging-summary", dateStr],
    queryFn: async (): Promise<EodStagingSummary | null> => {
      if (!dateStr) return null;

      // Fetch aggregated totals from cash_ledger_txn for the selected date
      const { data, error } = await supabase
        .from("cash_ledger_txn")
        .select("type, amount")
        .eq("txn_date", dateStr);

      if (error) throw error;

      if (!data || data.length === 0) {
        return {
          totalDeposits: 0,
          totalWithdrawals: 0,
          depositCount: 0,
          withdrawalCount: 0,
        };
      }

      // Aggregate by type
      const summary = data.reduce(
        (acc, row) => {
          const type = (row.type || "").toUpperCase();
          const amount = Number(row.amount) || 0;

          if (type === "DEPOSIT" || type === "RECEIPT") {
            acc.totalDeposits += amount;
            acc.depositCount += 1;
          } else if (type === "WITHDRAW" || type === "PAID" || type === "WITHDRAWAL") {
            acc.totalWithdrawals += amount;
            acc.withdrawalCount += 1;
          }

          return acc;
        },
        { totalDeposits: 0, totalWithdrawals: 0, depositCount: 0, withdrawalCount: 0 }
      );

      return summary;
    },
    enabled: !!dateStr,
    staleTime: 10000, // 10 seconds - refresh more frequently to catch new imports
  });
}
