import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

export interface UnmatchedStagingSummary {
  unmatched_trade_count: number;
  unmatched_trade_value: number;
  unmatched_deposit_count: number;
  unmatched_deposit_value: number;
  unmatched_withdrawal_count: number;
  unmatched_withdrawal_value: number;
  sample_codes: string[] | null;
}

/**
 * Hook to fetch unmatched staging data summary for a given date.
 * Returns stats about investor codes in staging tables (trade_file, cash_ledger_txn)
 * that don't have corresponding records in the investors master table.
 */
export function useUnmatchedStagingData(selectedDate: Date | undefined) {
  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;

  return useQuery({
    queryKey: ["unmatched-staging-data", dateStr],
    queryFn: async (): Promise<UnmatchedStagingSummary | null> => {
      if (!dateStr) return null;

      const { data, error } = await supabase.rpc("get_unmatched_staging_summary" as any, {
        p_trade_date: dateStr,
      });

      if (error) {
        console.error("[useUnmatchedStagingData] Error:", error.message);
        throw error;
      }

      // RPC returns an array with one row
      if (!data || data.length === 0) {
        return {
          unmatched_trade_count: 0,
          unmatched_trade_value: 0,
          unmatched_deposit_count: 0,
          unmatched_deposit_value: 0,
          unmatched_withdrawal_count: 0,
          unmatched_withdrawal_value: 0,
          sample_codes: null,
        };
      }

      const row = data[0];
      return {
        unmatched_trade_count: Number(row.unmatched_trade_count) || 0,
        unmatched_trade_value: Number(row.unmatched_trade_value) || 0,
        unmatched_deposit_count: Number(row.unmatched_deposit_count) || 0,
        unmatched_deposit_value: Number(row.unmatched_deposit_value) || 0,
        unmatched_withdrawal_count: Number(row.unmatched_withdrawal_count) || 0,
        unmatched_withdrawal_value: Number(row.unmatched_withdrawal_value) || 0,
        sample_codes: row.sample_codes || null,
      };
    },
    enabled: !!dateStr,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Check if there's significant unmatched data that warrants a warning
 */
export function hasSignificantUnmatchedData(summary: UnmatchedStagingSummary | null | undefined): boolean {
  if (!summary) return false;
  return (
    summary.unmatched_trade_count > 0 ||
    summary.unmatched_deposit_count > 0 ||
    summary.unmatched_withdrawal_count > 0
  );
}
