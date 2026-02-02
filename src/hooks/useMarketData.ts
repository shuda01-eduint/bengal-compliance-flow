import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface StockDaily {
  code: string;
  name: string | null;
  sector: string | null;
  category: string | null;
  market: string | null;
  date: string | null;
  close_price: number | null;
  prev_close: number | null;
  change: number | null;
  change_pct: number | null;
  market_cap: number | null;
  pe_ratio: number | null;
  eps: number | null;
  is_marginable: boolean | null;
  haircut_pct: number | null;
}

export interface StockHistorical {
  code: string;
  name: string | null;
  date: string;
  close_price: number | null;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  volume: number | null;
  trade_count: number | null;
  value_mn: number | null;
}

export interface StockFundamentals {
  code: string;
  name: string | null;
  isin: string | null;
  sector: string | null;
  category: string | null;
  market: string | null;
  instrument_type: string | null;
  face_value: number | null;
  lot_size: number | null;
  market_cap: number | null;
  free_float_mcap: number | null;
  eps: number | null;
  pe_ratio: number | null;
  nav: number | null;
  week_52_high: number | null;
  week_52_low: number | null;
  listing_year: number | null;
  last_agm_date: string | null;
  authorized_cap: number | null;
  paid_up_cap: number | null;
  total_shares: number | null;
  is_marginable: boolean | null;
  haircut_pct: number | null;
  is_active: boolean | null;
  last_synced_at: string | null;
  updated_at: string | null;
}

interface StockDailyParams {
  trade_date?: string;
  sector_filter?: string;
  code_filter?: string;
}

interface StockHistoricalParams {
  code_filter: string;
  start_date?: string;
  end_date?: string;
  page_number?: number;
  page_size?: number;
}

interface StockFundamentalsParams {
  code_filter?: string;
}

export function useStockDaily(params: StockDailyParams = {}) {
  return useQuery({
    queryKey: ['stock-daily', params],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_stock_daily', {
        _date: params.trade_date || undefined,
        _sector: params.sector_filter || undefined,
        _code: params.code_filter || undefined,
      });
      
      if (error) throw error;
      return (data || []) as StockDaily[];
    },
  });
}

export function useStockHistorical(params: StockHistoricalParams) {
  return useQuery({
    queryKey: ['stock-historical', params],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_stock_historical', {
        _code: params.code_filter,
        _from_date: params.start_date || undefined,
        _to_date: params.end_date || undefined,
        _limit: params.page_size || 100,
        _offset: ((params.page_number || 1) - 1) * (params.page_size || 100),
      });
      
      if (error) throw error;
      return (data || []) as StockHistorical[];
    },
    enabled: !!params.code_filter,
  });
}

export function useStockFundamentals(params: StockFundamentalsParams = {}) {
  return useQuery({
    queryKey: ['stock-fundamentals', params],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_stock_fundamentals', {
        _code: params.code_filter || '',
      });
      
      if (error) throw error;
      return (data || []) as StockFundamentals[];
    },
    enabled: !!params.code_filter,
  });
}

export function useSectors() {
  return useQuery({
    queryKey: ['sectors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('instrument')
        .select('sector')
        .not('sector', 'is', null)
        .order('sector');
      
      if (error) throw error;
      
      const uniqueSectors = [...new Set(data?.map(d => d.sector).filter(Boolean))];
      return uniqueSectors as string[];
    },
  });
}

export function useLatestTradeDate() {
  return useQuery({
    queryKey: ['latest-trade-date'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('instrument_prices_eod')
        .select('trade_date')
        .order('trade_date', { ascending: false })
        .limit(1)
        .single();
      
      if (error) return null;
      return data?.trade_date as string | null;
    },
  });
}
