import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { ViolationRecord } from "@/components/violations/ViolationsTable";

interface NegativeBalanceAllResult {
  event_date: string;
  client_code: string;
  client_name: string;
  rm_name: string;
  closing_balance: number;
  days_negative: number;
  department: string;
}

interface NegativeBalanceNewResult extends NegativeBalanceAllResult {
  previous_balance: number;
}

// Helper to fetch all rows from get_all_negative_cash_balances with pagination
async function fetchPaginatedAllNegativeCashBalances(
  targetDate: string,
  pageSize = 1000,
  maxPages = 20
): Promise<NegativeBalanceAllResult[]> {
  const allData: NegativeBalanceAllResult[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore && page < maxPages) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    
    const { data, error } = await supabase
      .rpc("get_all_negative_cash_balances", { p_target_date: targetDate })
      .range(from, to);

    if (error) throw error;
    if (data) allData.push(...(data as NegativeBalanceAllResult[]));
    hasMore = (data?.length ?? 0) === pageSize;
    page++;
  }

  return allData;
}

// Helper to fetch all rows from get_negative_balance_codes with pagination
async function fetchPaginatedNegativeBalanceCodes(
  fromDate: string | null,
  toDate: string | null,
  lookbackDays: number,
  pageSize = 1000,
  maxPages = 20
): Promise<NegativeBalanceNewResult[]> {
  const allData: NegativeBalanceNewResult[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore && page < maxPages) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    
    const { data, error } = await supabase
      .rpc("get_negative_balance_codes", {
        p_from_date: fromDate,
        p_to_date: toDate,
        p_search: "",
        p_lookback_days: lookbackDays,
      })
      .range(from, to);

    if (error) throw error;
    if (data) allData.push(...(data as NegativeBalanceNewResult[]));
    hasMore = (data?.length ?? 0) === pageSize;
    page++;
  }

  return allData;
}

export type ViolationType = "all" | "negative_balance" | "over_buy" | "z_group_adjustment" | "non_margin_buy";

interface ViolationSummary {
  negative_balance: { count: number; amount: number };
  over_buy: { count: number; amount: number };
  z_group_adjustment: { count: number; amount: number };
  non_margin_buy: { count: number; amount: number };
}

interface TradeRecord {
  trade_date: string;
  investor_code: string;
  instrument: string;
  side: string;
  trade_value: number;
}

interface ClientInfo {
  inv_code: string;
  investor_name: string;
  rm_name: string;
}

export type NegativeBalanceMode = "all" | "new_only";

export function useViolations(
  fromDate: Date | undefined,
  toDate: Date | undefined,
  searchTerm: string,
  negativeBalanceThreshold: number | null = null,
  negativeBalanceLookbackDays: number = 7,
  negativeBalanceMode: NegativeBalanceMode = "all"
) {
  const [activeFilter, setActiveFilter] = useState<ViolationType>("all");

  // Fetch client info for name lookups
  const { data: clientsData } = useQuery({
    queryKey: ["clients-for-violations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("inv_code, investor_name, rm_name");
      if (error) throw error;
      return data as ClientInfo[];
    },
    staleTime: 5 * 60 * 1000,
  });

  // Create stable client lookup map
  const clientMap = useMemo(() => {
    const map = new Map<string, ClientInfo>();
    (clientsData || []).forEach(c => map.set(c.inv_code, c));
    return map;
  }, [clientsData]);

  // Fetch negative balance violations - supports both "all" and "new_only" modes
  const { data: negativeBalanceData, isLoading: isLoadingNegative, refetch: refetchNegative } = useQuery({
    queryKey: ["negative-balance-violations", fromDate, toDate, negativeBalanceThreshold, negativeBalanceLookbackDays, negativeBalanceMode],
    queryFn: async () => {
      if (negativeBalanceMode === "new_only") {
        // Use paginated RPC for new negative balances only
        const allData = await fetchPaginatedNegativeBalanceCodes(
          fromDate ? format(fromDate, "yyyy-MM-dd") : null,
          toDate ? format(toDate, "yyyy-MM-dd") : null,
          negativeBalanceLookbackDays
        );
        
        let results = allData;
        
        // Apply threshold filter if set
        if (negativeBalanceThreshold !== null) {
          results = results.filter(r => r.closing_balance < negativeBalanceThreshold);
        }
        
        return results;
      } else {
        // "all" mode - use paginated RPC that properly joins with investors table for cash account filtering
        const targetDate = toDate ? format(toDate, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd");
        
        const allData = await fetchPaginatedAllNegativeCashBalances(targetDate);
        
        // Map to include previous_balance for consistency
        let mappedResults = allData.map(r => ({
          ...r,
          previous_balance: 0,
        }));
        
        // Apply threshold filter if set
        if (negativeBalanceThreshold !== null) {
          mappedResults = mappedResults.filter(r => r.closing_balance < negativeBalanceThreshold);
        }
        
        return mappedResults;
      }
    },
  });

  // Fetch over buy violations using RPC function
  const { data: overBuyData, isLoading: isLoadingOverBuy, refetch: refetchOverBuy } = useQuery({
    queryKey: ["over-buy-violations", fromDate, toDate],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_over_buy_margin_codes", {
        p_from_date: fromDate ? format(fromDate, "yyyy-MM-dd") : null,
        p_to_date: toDate ? format(toDate, "yyyy-MM-dd") : null,
      });
      if (error) throw error;
      return (data || []) as Array<{
        client_code: string;
        client_name: string;
        rm_name: string;
        opening_balance: number;
        closing_balance: number;
        loan_increase: number;
        first_date: string;
        last_date: string;
      }>;
    },
  });

  // Fetch Z group adjustment violations
  const { data: zGroupData, isLoading: isLoadingZGroup, refetch: refetchZGroup } = useQuery({
    queryKey: ["z-group-violations", fromDate, toDate],
    queryFn: async () => {
      let query = supabase
        .from("trades")
        .select("trade_date, investor_code, instrument, side, trade_value")
        .eq("side", "SELL");

      if (fromDate) {
        query = query.gte("trade_date", format(fromDate, "yyyy-MM-dd"));
      }
      if (toDate) {
        query = query.lte("trade_date", format(toDate, "yyyy-MM-dd"));
      }

      const { data: trades, error: tradesError } = await query;
      if (tradesError) throw tradesError;

      const { data: zInstruments, error: instrError } = await supabase
        .from("instrument")
        .select("trading_code")
        .eq("category", "Z");
      
      if (instrError) throw instrError;
      
      const zCodes = new Set((zInstruments || []).map(i => i.trading_code));
      const typedTrades = (trades || []) as TradeRecord[];
      const zSells = typedTrades.filter(t => zCodes.has(t.instrument));
      
      const grouped = new Map<string, { event_date: string; client_code: string; amount: number }>();
      zSells.forEach(trade => {
        const key = `${trade.investor_code}-${trade.trade_date}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            event_date: trade.trade_date,
            client_code: trade.investor_code,
            amount: 0,
          });
        }
        const record = grouped.get(key)!;
        record.amount += trade.trade_value || 0;
      });

      return Array.from(grouped.values());
    },
  });

  // Fetch non-margin buy violations
  const { data: nonMarginBuyData, isLoading: isLoadingNonMargin, refetch: refetchNonMargin } = useQuery({
    queryKey: ["non-margin-buy-violations", fromDate, toDate],
    queryFn: async () => {
      const { data: nonMarginInstruments, error: instrError } = await supabase
        .from("instrument")
        .select("trading_code")
        .eq("is_marginable", false);
      
      if (instrError) throw instrError;
      
      const nonMarginCodes = new Set((nonMarginInstruments || []).map(i => i.trading_code));
      
      if (nonMarginCodes.size === 0) return [];

      let query = supabase
        .from("trades")
        .select("trade_date, investor_code, instrument, side, trade_value")
        .eq("side", "BUY")
        .gt("trade_value", 0);

      if (fromDate) {
        query = query.gte("trade_date", format(fromDate, "yyyy-MM-dd"));
      }
      if (toDate) {
        query = query.lte("trade_date", format(toDate, "yyyy-MM-dd"));
      }

      const { data: trades, error: tradesError } = await query;
      if (tradesError) throw tradesError;

      const { data: marginAccounts, error: marginError } = await supabase
        .from("margin_accounts")
        .select("investor_code");
      
      if (marginError) throw marginError;
      
      const marginAccountCodes = new Set((marginAccounts || []).map(a => a.investor_code));

      const typedTrades = (trades || []) as TradeRecord[];
      const violations = typedTrades.filter(t => 
        marginAccountCodes.has(t.investor_code) && nonMarginCodes.has(t.instrument)
      );

      const grouped = new Map<string, { event_date: string; client_code: string; amount: number }>();
      violations.forEach(trade => {
        const key = `${trade.investor_code}-${trade.trade_date}`;
        if (!grouped.has(key)) {
          grouped.set(key, {
            event_date: trade.trade_date,
            client_code: trade.investor_code,
            amount: 0,
          });
        }
        const record = grouped.get(key)!;
        record.amount += trade.trade_value || 0;
      });

      return Array.from(grouped.values());
    },
  });

  // Calculate summary
  const summary: ViolationSummary = useMemo(() => {
    const negativeBalanceRecords = negativeBalanceData || [];
    const overBuyRecords = overBuyData || [];
    const zGroupRecords = zGroupData || [];
    const nonMarginRecords = nonMarginBuyData || [];

    return {
      negative_balance: {
        count: new Set(negativeBalanceRecords.map(r => r.client_code)).size,
        amount: negativeBalanceRecords.reduce((sum, r) => sum + (r.closing_balance || 0), 0),
      },
      over_buy: {
        count: new Set(overBuyRecords.map(r => r.client_code)).size,
        amount: overBuyRecords.reduce((sum, r) => sum + (r.loan_increase || 0), 0),
      },
      z_group_adjustment: {
        count: new Set(zGroupRecords.map(r => r.client_code)).size,
        amount: zGroupRecords.reduce((sum, r) => sum + (r.amount || 0), 0),
      },
      non_margin_buy: {
        count: new Set(nonMarginRecords.map(r => r.client_code)).size,
        amount: nonMarginRecords.reduce((sum, r) => sum + (r.amount || 0), 0),
      },
    };
  }, [negativeBalanceData, overBuyData, zGroupData, nonMarginBuyData]);

  // Combine all violations into records - use clientMap directly instead of function
  const allRecords: ViolationRecord[] = useMemo(() => {
    const records: ViolationRecord[] = [];

    // Add negative balance records
    (negativeBalanceData || []).forEach(r => {
      records.push({
        event_date: r.event_date,
        client_code: r.client_code,
        client_name: r.client_name,
        violation_type: "negative_balance",
        amount: r.closing_balance,
        rm_name: r.rm_name,
        previous_balance: r.previous_balance,
        closing_balance: r.closing_balance,
        days_negative: r.days_negative,
        department: r.department,
      });
    });

    // Add over buy records with additional fields
    (overBuyData || []).forEach(r => {
      records.push({
        event_date: r.first_date,
        client_code: r.client_code,
        client_name: r.client_name,
        violation_type: "over_buy",
        amount: r.loan_increase,
        rm_name: r.rm_name,
        opening_balance: r.opening_balance,
        closing_balance: r.closing_balance,
        loan_increase: r.loan_increase,
      });
    });

    // Add Z group records - lookup client info from map
    (zGroupData || []).forEach(r => {
      const client = clientMap.get(r.client_code);
      records.push({
        event_date: r.event_date,
        client_code: r.client_code,
        client_name: client?.investor_name || '',
        violation_type: "z_group_adjustment",
        amount: r.amount,
        rm_name: client?.rm_name || '',
      });
    });

    // Add non-margin buy records - lookup client info from map
    (nonMarginBuyData || []).forEach(r => {
      const client = clientMap.get(r.client_code);
      records.push({
        event_date: r.event_date,
        client_code: r.client_code,
        client_name: client?.investor_name || '',
        violation_type: "non_margin_buy",
        amount: r.amount,
        rm_name: client?.rm_name || '',
      });
    });

    return records;
  }, [negativeBalanceData, overBuyData, zGroupData, nonMarginBuyData, clientMap]);

  // Filter records based on active filter and search
  const filteredRecords = useMemo(() => {
    let records = allRecords;

    if (activeFilter !== "all") {
      records = records.filter(r => r.violation_type === activeFilter);
    }

    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      records = records.filter(r =>
        r.client_code.toLowerCase().includes(search) ||
        r.client_name.toLowerCase().includes(search) ||
        r.rm_name.toLowerCase().includes(search)
      );
    }

    return records.sort((a, b) => 
      new Date(b.event_date).getTime() - new Date(a.event_date).getTime()
    );
  }, [allRecords, activeFilter, searchTerm]);

  const isLoading = isLoadingNegative || isLoadingOverBuy || isLoadingZGroup || isLoadingNonMargin;

  const refetchAll = useCallback(async () => {
    await Promise.all([
      refetchNegative(),
      refetchOverBuy(),
      refetchZGroup(),
      refetchNonMargin(),
    ]);
  }, [refetchNegative, refetchOverBuy, refetchZGroup, refetchNonMargin]);

  return {
    summary,
    records: filteredRecords,
    isLoading,
    activeFilter,
    setActiveFilter,
    refetchAll,
  };
}
