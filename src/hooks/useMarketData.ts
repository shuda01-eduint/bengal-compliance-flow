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
  volume: number | null;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  trade_count: number | null;
  value: number | null;
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

// Fetch directly from the securities table that receives real DSE data
export function useStockDaily(params: StockDailyParams = {}) {
  return useQuery({
    queryKey: ['stock-daily-securities', params],
    queryFn: async () => {
      let query = supabase
        .from('securities')
        .select('*')
        .order('trading_code');

      if (params.sector_filter) {
        query = query.eq('sector', params.sector_filter);
      }

      if (params.code_filter) {
        query = query.ilike('trading_code', `%${params.code_filter}%`);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Transform securities data to match StockDaily interface
      return (data || []).map((s: any) => {
        const closePrice = Number(s.close_price) || 0;
        const openPrice = Number(s.open_price) || 0;
        const highPrice = Number(s.high_price) || 0;
        const lowPrice = Number(s.low_price) || 0;
        
        // Use change values from database if available (synced from external API)
        let change = s.change !== null && s.change !== undefined ? Number(s.change) : null;
        let changePct = s.change_percent !== null && s.change_percent !== undefined ? Number(s.change_percent) : null;
        
        // Fallback calculation if DB values not available
        if (change === null && openPrice && closePrice) {
          change = closePrice - openPrice;
          changePct = openPrice !== 0 ? (change / openPrice) * 100 : null;
        }

        return {
          code: s.trading_code,
          name: s.trading_code,
          sector: s.sector,
          category: s.category,
          market: null,
          date: s.last_synced_at ? new Date(s.last_synced_at).toISOString().split('T')[0] : null,
          close_price: closePrice,
          prev_close: openPrice || null,
          change,
          change_pct: changePct,
          market_cap: Number(s.market_cap) || null,
          pe_ratio: Number(s.audited_pe || s.trailing_pe) || null,
          eps: Number(s.eps) || null,
          is_marginable: s.is_marginable,
          haircut_pct: Number(s.haircut_percentage) || null,
          volume: Number(s.volume) || null,
          open_price: openPrice || null,
          high_price: highPrice || null,
          low_price: lowPrice || null,
          trade_count: Number(s.trade_count) || null,
          value: Number(s.value) || null,
        };
      }) as StockDaily[];
    },
  });
}

// Keep the RPC-based historical for detailed stock views (if views exist)
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

// Fetch fundamentals from securities table directly
export function useStockFundamentals(params: StockFundamentalsParams = {}) {
  return useQuery({
    queryKey: ['stock-fundamentals-securities', params],
    queryFn: async () => {
      let query = supabase
        .from('securities')
        .select('*');

      if (params.code_filter) {
        query = query.eq('trading_code', params.code_filter);
      }

      const { data, error } = await query;

      if (error) throw error;

      return (data || []).map((s: any) => ({
        code: s.trading_code,
        name: s.trading_code,
        isin: null,
        sector: s.sector,
        category: s.category,
        market: null,
        instrument_type: s.instrument_type,
        face_value: null,
        lot_size: null,
        market_cap: s.market_cap,
        free_float_mcap: s.free_float_mcap,
        eps: s.eps,
        pe_ratio: s.audited_pe || s.trailing_pe,
        nav: null,
        week_52_high: s.week_52_high,
        week_52_low: s.week_52_low,
        listing_year: null,
        last_agm_date: null,
        authorized_cap: null,
        paid_up_cap: null,
        total_shares: s.total_securities,
        is_marginable: s.is_marginable,
        haircut_pct: s.haircut_percentage,
        is_active: true,
        last_synced_at: s.last_synced_at,
        updated_at: s.updated_at,
      })) as StockFundamentals[];
    },
    enabled: !!params.code_filter,
  });
}

export function useSectors() {
  return useQuery({
    queryKey: ['sectors-securities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('securities')
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
    queryKey: ['latest-trade-date-securities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('securities')
        .select('last_synced_at')
        .not('last_synced_at', 'is', null)
        .order('last_synced_at', { ascending: false })
        .limit(1)
        .single();
      
      if (error) return null;
      return data?.last_synced_at 
        ? new Date(data.last_synced_at).toISOString().split('T')[0] 
        : null;
    },
  });
}

// New hook to get market summary stats
export function useMarketSummary() {
  return useQuery({
    queryKey: ['market-summary-securities'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('securities')
        .select('close_price, open_price, volume, market_cap');
      
      if (error) throw error;

      const stocks = data || [];
      const totalStocks = stocks.length;
      const totalVolume = stocks.reduce((sum, s) => sum + (Number(s.volume) || 0), 0);
      const totalMarketCap = stocks.reduce((sum, s) => sum + (Number(s.market_cap) || 0), 0);
      
      const advancers = stocks.filter(s => {
        const close = Number(s.close_price) || 0;
        const open = Number(s.open_price) || 0;
        return close > open;
      }).length;
      
      const decliners = stocks.filter(s => {
        const close = Number(s.close_price) || 0;
        const open = Number(s.open_price) || 0;
        return close < open;
      }).length;

      return {
        totalStocks,
        totalVolume,
        totalMarketCap,
        advancers,
        decliners,
        unchanged: totalStocks - advancers - decliners,
      };
    },
  });
}
