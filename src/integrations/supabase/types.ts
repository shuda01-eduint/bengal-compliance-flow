export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      clients: {
        Row: {
          accrued_interest: number
          created_at: string
          current_liabilities: number
          equity: number
          id: string
          inv_code: string
          investor_name: string
          ledger_balance: number
          market_value: number
          rm_email: string | null
          rm_name: string
          status: string
          updated_at: string
        }
        Insert: {
          accrued_interest?: number
          created_at?: string
          current_liabilities?: number
          equity?: number
          id?: string
          inv_code: string
          investor_name: string
          ledger_balance?: number
          market_value?: number
          rm_email?: string | null
          rm_name: string
          status?: string
          updated_at?: string
        }
        Update: {
          accrued_interest?: number
          created_at?: string
          current_liabilities?: number
          equity?: number
          id?: string
          inv_code?: string
          investor_name?: string
          ledger_balance?: number
          market_value?: number
          rm_email?: string | null
          rm_name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      trade_history: {
        Row: {
          action: string | null
          asset_class: string | null
          board: string | null
          boid: string | null
          category: string | null
          client_code: string | null
          compulsory_spot: string | null
          created_at: string
          exec_id: string | null
          file_name: string | null
          fill_type: string | null
          id: string
          isin: string | null
          order_id: string | null
          owner_dealer_id: string | null
          price: number | null
          quantity: number | null
          ref_order_id: string | null
          security_code: string | null
          session: string | null
          side: string | null
          status: string | null
          trade_date: string | null
          trade_report_type: string | null
          trade_time: string | null
          trader_dealer_id: string | null
          uploaded_at: string
          value: number | null
        }
        Insert: {
          action?: string | null
          asset_class?: string | null
          board?: string | null
          boid?: string | null
          category?: string | null
          client_code?: string | null
          compulsory_spot?: string | null
          created_at?: string
          exec_id?: string | null
          file_name?: string | null
          fill_type?: string | null
          id?: string
          isin?: string | null
          order_id?: string | null
          owner_dealer_id?: string | null
          price?: number | null
          quantity?: number | null
          ref_order_id?: string | null
          security_code?: string | null
          session?: string | null
          side?: string | null
          status?: string | null
          trade_date?: string | null
          trade_report_type?: string | null
          trade_time?: string | null
          trader_dealer_id?: string | null
          uploaded_at?: string
          value?: number | null
        }
        Update: {
          action?: string | null
          asset_class?: string | null
          board?: string | null
          boid?: string | null
          category?: string | null
          client_code?: string | null
          compulsory_spot?: string | null
          created_at?: string
          exec_id?: string | null
          file_name?: string | null
          fill_type?: string | null
          id?: string
          isin?: string | null
          order_id?: string | null
          owner_dealer_id?: string | null
          price?: number | null
          quantity?: number | null
          ref_order_id?: string | null
          security_code?: string | null
          session?: string | null
          side?: string | null
          status?: string | null
          trade_date?: string | null
          trade_report_type?: string | null
          trade_time?: string | null
          trader_dealer_id?: string | null
          uploaded_at?: string
          value?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
