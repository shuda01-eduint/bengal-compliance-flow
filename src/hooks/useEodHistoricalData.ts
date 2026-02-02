import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

export interface EodHistoricalData {
  run_date: string;
  clients_captured: number;
  trade_files_count: number;
  gross_buy: number;
  gross_sell: number;
  total_commission: number;
  total_deposits: number;
  total_withdrawals: number;
  total_ledger_balance: number;
  status: string;
  run_at: string;
  run_by_email: string | null;
}

export function useEodHistoricalData(selectedDate: Date | undefined) {
  const dateStr = selectedDate ? format(selectedDate, "yyyy-MM-dd") : null;

  return useQuery({
    queryKey: ["eod-historical-data", dateStr],
    queryFn: async (): Promise<EodHistoricalData | null> => {
      if (!dateStr) return null;

      const { data, error } = await supabase
        .from("eod_run_history")
        .select("*")
        .eq("run_date", dateStr)
        .order("run_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!dateStr,
    staleTime: 30000, // 30 seconds
  });
}
