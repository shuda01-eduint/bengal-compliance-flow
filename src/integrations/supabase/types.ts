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
      agent_codes: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          investor_code: string
          rm_id: string
        }
        Insert: {
          agent_id: string
          created_at?: string
          id?: string
          investor_code: string
          rm_id: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          investor_code?: string
          rm_id?: string
        }
        Relationships: []
      }
      agent_trade_details: {
        Row: {
          agent_id: string
          ait: number | null
          cdbl_charge: number | null
          comm_associates_portion: number | null
          commission_rate: number | null
          comp_portion_gross_comm: number | null
          company_profit: number | null
          created_at: string
          gross_commission: number | null
          id: string
          investor_code: string
          laga_howla: number | null
          net_commission: number | null
          net_commission_without_ait_cdbl: number | null
          rm_id: string
          rm_name: string | null
          turnover: number | null
          upload_month: string | null
          uploaded_at: string
        }
        Insert: {
          agent_id: string
          ait?: number | null
          cdbl_charge?: number | null
          comm_associates_portion?: number | null
          commission_rate?: number | null
          comp_portion_gross_comm?: number | null
          company_profit?: number | null
          created_at?: string
          gross_commission?: number | null
          id?: string
          investor_code: string
          laga_howla?: number | null
          net_commission?: number | null
          net_commission_without_ait_cdbl?: number | null
          rm_id: string
          rm_name?: string | null
          turnover?: number | null
          upload_month?: string | null
          uploaded_at?: string
        }
        Update: {
          agent_id?: string
          ait?: number | null
          cdbl_charge?: number | null
          comm_associates_portion?: number | null
          commission_rate?: number | null
          comp_portion_gross_comm?: number | null
          company_profit?: number | null
          created_at?: string
          gross_commission?: number | null
          id?: string
          investor_code?: string
          laga_howla?: number | null
          net_commission?: number | null
          net_commission_without_ait_cdbl?: number | null
          rm_id?: string
          rm_name?: string | null
          turnover?: number | null
          upload_month?: string | null
          uploaded_at?: string
        }
        Relationships: []
      }
      agents: {
        Row: {
          agent_id: string
          bank_account: string | null
          bank_name: string | null
          commission_rate: number | null
          created_at: string
          id: string
          name: string
          nid_number: string | null
          remarks: string | null
          rm_id: string
          rm_name: string | null
          routing_number: string | null
          status: string | null
          tin_number: string | null
          updated_at: string
        }
        Insert: {
          agent_id: string
          bank_account?: string | null
          bank_name?: string | null
          commission_rate?: number | null
          created_at?: string
          id?: string
          name: string
          nid_number?: string | null
          remarks?: string | null
          rm_id: string
          rm_name?: string | null
          routing_number?: string | null
          status?: string | null
          tin_number?: string | null
          updated_at?: string
        }
        Update: {
          agent_id?: string
          bank_account?: string | null
          bank_name?: string | null
          commission_rate?: number | null
          created_at?: string
          id?: string
          name?: string
          nid_number?: string | null
          remarks?: string | null
          rm_id?: string
          rm_name?: string | null
          routing_number?: string | null
          status?: string | null
          tin_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      assignment_change_requests: {
        Row: {
          admin_approved_at: string | null
          admin_approved_by: string | null
          admin_notes: string | null
          change_type: string
          created_at: string
          current_assignments: Json | null
          id: string
          investor_code: string
          investor_name: string | null
          manager_approved_at: string | null
          manager_approved_by: string | null
          manager_notes: string | null
          reason: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          requested_assignments: Json
          requested_at: string | null
          requested_by: string
          requested_by_email: string
          status: string
          updated_at: string
        }
        Insert: {
          admin_approved_at?: string | null
          admin_approved_by?: string | null
          admin_notes?: string | null
          change_type: string
          created_at?: string
          current_assignments?: Json | null
          id?: string
          investor_code: string
          investor_name?: string | null
          manager_approved_at?: string | null
          manager_approved_by?: string | null
          manager_notes?: string | null
          reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requested_assignments: Json
          requested_at?: string | null
          requested_by: string
          requested_by_email: string
          status?: string
          updated_at?: string
        }
        Update: {
          admin_approved_at?: string | null
          admin_approved_by?: string | null
          admin_notes?: string | null
          change_type?: string
          created_at?: string
          current_assignments?: Json | null
          id?: string
          investor_code?: string
          investor_name?: string | null
          manager_approved_at?: string | null
          manager_approved_by?: string | null
          manager_notes?: string | null
          reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requested_assignments?: Json
          requested_at?: string | null
          requested_by?: string
          requested_by_email?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      balances_raw: {
        Row: {
          as_of_date: string
          avg_cost: number | null
          cq_in_transit: number | null
          created_at: string
          id: string
          instrument: string | null
          investor_code: string
          ledger_balance: number | null
          matured_balance: number | null
          receivable_sale: number | null
          rm_email: string | null
          rm_id: string | null
          rm_name: string | null
          saleable: number | null
          total_cost: number | null
          total_mv: number | null
          total_stock: number | null
          updated_at: string
        }
        Insert: {
          as_of_date?: string
          avg_cost?: number | null
          cq_in_transit?: number | null
          created_at?: string
          id?: string
          instrument?: string | null
          investor_code: string
          ledger_balance?: number | null
          matured_balance?: number | null
          receivable_sale?: number | null
          rm_email?: string | null
          rm_id?: string | null
          rm_name?: string | null
          saleable?: number | null
          total_cost?: number | null
          total_mv?: number | null
          total_stock?: number | null
          updated_at?: string
        }
        Update: {
          as_of_date?: string
          avg_cost?: number | null
          cq_in_transit?: number | null
          created_at?: string
          id?: string
          instrument?: string | null
          investor_code?: string
          ledger_balance?: number | null
          matured_balance?: number | null
          receivable_sale?: number | null
          rm_email?: string | null
          rm_id?: string | null
          rm_name?: string | null
          saleable?: number | null
          total_cost?: number | null
          total_mv?: number | null
          total_stock?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      branch_codes: {
        Row: {
          branch_name: string
          branch_type: string | null
          created_at: string | null
          description: string | null
          id: string
          prefix: string
          updated_at: string | null
        }
        Insert: {
          branch_name: string
          branch_type?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          prefix: string
          updated_at?: string | null
        }
        Update: {
          branch_name?: string
          branch_type?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          prefix?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      cash_ledger: {
        Row: {
          balance: number | null
          created_at: string | null
          credit: number | null
          debit: number | null
          description: string | null
          id: string
          investor_code: string
          reference: string | null
          source_id: string | null
          source_table: string | null
          txn_date: string
          txn_type: string
          value_date: string | null
        }
        Insert: {
          balance?: number | null
          created_at?: string | null
          credit?: number | null
          debit?: number | null
          description?: string | null
          id?: string
          investor_code: string
          reference?: string | null
          source_id?: string | null
          source_table?: string | null
          txn_date: string
          txn_type: string
          value_date?: string | null
        }
        Update: {
          balance?: number | null
          created_at?: string | null
          credit?: number | null
          debit?: number | null
          description?: string | null
          id?: string
          investor_code?: string
          reference?: string | null
          source_id?: string | null
          source_table?: string | null
          txn_date?: string
          txn_type?: string
          value_date?: string | null
        }
        Relationships: []
      }
      cash_ledger_txn: {
        Row: {
          amount: number
          created_at: string | null
          description: string | null
          investor_code: string
          reference: string | null
          txn_date: string
          txn_id: number
          type: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          description?: string | null
          investor_code: string
          reference?: string | null
          txn_date: string
          txn_id?: number
          type?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          description?: string | null
          investor_code?: string
          reference?: string | null
          txn_date?: string
          txn_id?: number
          type?: string | null
        }
        Relationships: []
      }
      ceo_dashboard_thresholds: {
        Row: {
          created_at: string | null
          critical_threshold: number | null
          id: string
          is_enabled: boolean | null
          metric_type: string
          mom_critical_threshold: number | null
          mom_warning_threshold: number | null
          threshold_direction: string
          tile_key: string
          tile_name: string
          updated_at: string | null
          updated_by: string | null
          warning_threshold: number | null
          wow_critical_threshold: number | null
          wow_warning_threshold: number | null
        }
        Insert: {
          created_at?: string | null
          critical_threshold?: number | null
          id?: string
          is_enabled?: boolean | null
          metric_type?: string
          mom_critical_threshold?: number | null
          mom_warning_threshold?: number | null
          threshold_direction?: string
          tile_key: string
          tile_name: string
          updated_at?: string | null
          updated_by?: string | null
          warning_threshold?: number | null
          wow_critical_threshold?: number | null
          wow_warning_threshold?: number | null
        }
        Update: {
          created_at?: string | null
          critical_threshold?: number | null
          id?: string
          is_enabled?: boolean | null
          metric_type?: string
          mom_critical_threshold?: number | null
          mom_warning_threshold?: number | null
          threshold_direction?: string
          tile_key?: string
          tile_name?: string
          updated_at?: string | null
          updated_by?: string | null
          warning_threshold?: number | null
          wow_critical_threshold?: number | null
          wow_warning_threshold?: number | null
        }
        Relationships: []
      }
      charge_rate_scheme: {
        Row: {
          basis: string | null
          charge_code: string
          charge_type: string
          created_at: string
          created_by: string | null
          description: string | null
          effective_from: string
          effective_to: string | null
          id: string
          investor_group: string | null
          is_active: boolean
          max_base_amount: number | null
          max_charge: number | null
          min_base_amount: number | null
          min_charge: number | null
          rate: number
        }
        Insert: {
          basis?: string | null
          charge_code: string
          charge_type: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          investor_group?: string | null
          is_active?: boolean
          max_base_amount?: number | null
          max_charge?: number | null
          min_base_amount?: number | null
          min_charge?: number | null
          rate: number
        }
        Update: {
          basis?: string | null
          charge_code?: string
          charge_type?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          investor_group?: string | null
          is_active?: boolean
          max_base_amount?: number | null
          max_charge?: number | null
          min_base_amount?: number | null
          min_charge?: number | null
          rate?: number
        }
        Relationships: []
      }
      cheque_in_hand: {
        Row: {
          amount: number
          cheque_date: string
          created_at: string | null
          id: number
          investor_code: string
          status: string | null
        }
        Insert: {
          amount: number
          cheque_date: string
          created_at?: string | null
          id?: number
          investor_code: string
          status?: string | null
        }
        Update: {
          amount?: number
          cheque_date?: string
          created_at?: string | null
          id?: number
          investor_code?: string
          status?: string | null
        }
        Relationships: []
      }
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
      commission_change_requests: {
        Row: {
          admin_approved_at: string | null
          admin_approved_by: string | null
          admin_notes: string | null
          created_at: string
          current_commission: number | null
          id: string
          investor_code: string
          investor_name: string | null
          manager_approved_at: string | null
          manager_approved_by: string | null
          manager_notes: string | null
          reason: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          requested_at: string | null
          requested_by: string
          requested_by_email: string
          requested_commission: number
          status: string
          updated_at: string
        }
        Insert: {
          admin_approved_at?: string | null
          admin_approved_by?: string | null
          admin_notes?: string | null
          created_at?: string
          current_commission?: number | null
          id?: string
          investor_code: string
          investor_name?: string | null
          manager_approved_at?: string | null
          manager_approved_by?: string | null
          manager_notes?: string | null
          reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requested_at?: string | null
          requested_by: string
          requested_by_email: string
          requested_commission: number
          status?: string
          updated_at?: string
        }
        Update: {
          admin_approved_at?: string | null
          admin_approved_by?: string | null
          admin_notes?: string | null
          created_at?: string
          current_commission?: number | null
          id?: string
          investor_code?: string
          investor_name?: string | null
          manager_approved_at?: string | null
          manager_approved_by?: string | null
          manager_notes?: string | null
          reason?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          requested_at?: string | null
          requested_by?: string
          requested_by_email?: string
          requested_commission?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      commission_rate_scheme: {
        Row: {
          commission_rate: number
          commission_type: string
          created_at: string
          created_by: string | null
          description: string | null
          effective_from: string
          effective_to: string | null
          id: string
          instrument_group: string | null
          investor_group: string | null
          is_active: boolean
          max_commission: number | null
          max_trade_value: number | null
          min_commission: number | null
          min_trade_value: number | null
          rm_id: string | null
          scheme_code: string
        }
        Insert: {
          commission_rate: number
          commission_type: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          effective_from: string
          effective_to?: string | null
          id?: string
          instrument_group?: string | null
          investor_group?: string | null
          is_active?: boolean
          max_commission?: number | null
          max_trade_value?: number | null
          min_commission?: number | null
          min_trade_value?: number | null
          rm_id?: string | null
          scheme_code: string
        }
        Update: {
          commission_rate?: number
          commission_type?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          effective_from?: string
          effective_to?: string | null
          id?: string
          instrument_group?: string | null
          investor_group?: string | null
          is_active?: boolean
          max_commission?: number | null
          max_trade_value?: number | null
          min_commission?: number | null
          min_trade_value?: number | null
          rm_id?: string | null
          scheme_code?: string
        }
        Relationships: []
      }
      departments: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      deposits_withdrawals: {
        Row: {
          amount: number
          created_at: string
          id: string
          investor_code: string
          investor_name: string | null
          remarks: string | null
          rm_email: string | null
          transaction_date: string
          transaction_type: string
          uploaded_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          investor_code: string
          investor_name?: string | null
          remarks?: string | null
          rm_email?: string | null
          transaction_date?: string
          transaction_type: string
          uploaded_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          investor_code?: string
          investor_name?: string | null
          remarks?: string | null
          rm_email?: string | null
          transaction_date?: string
          transaction_type?: string
          uploaded_at?: string
        }
        Relationships: []
      }
      employee_salaries: {
        Row: {
          bank_account: string | null
          basic_salary: number | null
          created_at: string
          effective_from: string | null
          effective_to: string | null
          employee_id: string
          gross_salary: number | null
          house_rent: number | null
          id: string
          is_current: boolean | null
          medical_allowance: number | null
          net_salary: number | null
          other_allowance: number | null
          other_deduction: number | null
          payment_method: string | null
          pf_deduction: number | null
          tax_deduction: number | null
          transport_allowance: number | null
          updated_at: string
        }
        Insert: {
          bank_account?: string | null
          basic_salary?: number | null
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          employee_id: string
          gross_salary?: number | null
          house_rent?: number | null
          id?: string
          is_current?: boolean | null
          medical_allowance?: number | null
          net_salary?: number | null
          other_allowance?: number | null
          other_deduction?: number | null
          payment_method?: string | null
          pf_deduction?: number | null
          tax_deduction?: number | null
          transport_allowance?: number | null
          updated_at?: string
        }
        Update: {
          bank_account?: string | null
          basic_salary?: number | null
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          employee_id?: string
          gross_salary?: number | null
          house_rent?: number | null
          id?: string
          is_current?: boolean | null
          medical_allowance?: number | null
          net_salary?: number | null
          other_allowance?: number | null
          other_deduction?: number | null
          payment_method?: string | null
          pf_deduction?: number | null
          tax_deduction?: number | null
          transport_allowance?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_salaries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["employee_id"]
          },
        ]
      }
      employees: {
        Row: {
          bank_account: string | null
          blood_group: string | null
          branch: string
          category: string | null
          corporate_phone: string | null
          created_at: string
          date_of_birth: string | null
          date_of_confirmation: string | null
          date_of_promotion: string | null
          department: string
          designation: string
          email: string
          employee_id: string
          employment_category: string | null
          employment_status: string | null
          father_name: string | null
          functional_designation: string | null
          gender: string | null
          highest_degree: string | null
          id: string
          increment_date: string | null
          joining_date: string
          manager: string | null
          marital_status: string | null
          mother_name: string | null
          name: string
          nationality: string | null
          nid_number: string | null
          old_email: string | null
          passport_number: string | null
          performance_2019: string | null
          performance_2020: string | null
          permanent_address: string | null
          personal_phone: string | null
          present_address: string | null
          release_date: string | null
          religion: string | null
          serial_number: number | null
          service_date: number | null
          service_month: number | null
          service_year: number | null
          spouse_name: string | null
          status: string
          tin_number: string | null
          upay_number: string | null
          updated_at: string
        }
        Insert: {
          bank_account?: string | null
          blood_group?: string | null
          branch: string
          category?: string | null
          corporate_phone?: string | null
          created_at?: string
          date_of_birth?: string | null
          date_of_confirmation?: string | null
          date_of_promotion?: string | null
          department: string
          designation: string
          email: string
          employee_id: string
          employment_category?: string | null
          employment_status?: string | null
          father_name?: string | null
          functional_designation?: string | null
          gender?: string | null
          highest_degree?: string | null
          id?: string
          increment_date?: string | null
          joining_date: string
          manager?: string | null
          marital_status?: string | null
          mother_name?: string | null
          name: string
          nationality?: string | null
          nid_number?: string | null
          old_email?: string | null
          passport_number?: string | null
          performance_2019?: string | null
          performance_2020?: string | null
          permanent_address?: string | null
          personal_phone?: string | null
          present_address?: string | null
          release_date?: string | null
          religion?: string | null
          serial_number?: number | null
          service_date?: number | null
          service_month?: number | null
          service_year?: number | null
          spouse_name?: string | null
          status?: string
          tin_number?: string | null
          upay_number?: string | null
          updated_at?: string
        }
        Update: {
          bank_account?: string | null
          blood_group?: string | null
          branch?: string
          category?: string | null
          corporate_phone?: string | null
          created_at?: string
          date_of_birth?: string | null
          date_of_confirmation?: string | null
          date_of_promotion?: string | null
          department?: string
          designation?: string
          email?: string
          employee_id?: string
          employment_category?: string | null
          employment_status?: string | null
          father_name?: string | null
          functional_designation?: string | null
          gender?: string | null
          highest_degree?: string | null
          id?: string
          increment_date?: string | null
          joining_date?: string
          manager?: string | null
          marital_status?: string | null
          mother_name?: string | null
          name?: string
          nationality?: string | null
          nid_number?: string | null
          old_email?: string | null
          passport_number?: string | null
          performance_2019?: string | null
          performance_2020?: string | null
          permanent_address?: string | null
          personal_phone?: string | null
          present_address?: string | null
          release_date?: string | null
          religion?: string | null
          serial_number?: number | null
          service_date?: number | null
          service_month?: number | null
          service_year?: number | null
          spouse_name?: string | null
          status?: string
          tin_number?: string | null
          upay_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      eod_holding_snapshots: {
        Row: {
          avg_cost: number | null
          created_at: string | null
          eod_date: string
          id: string
          investor_code: string
          market_value: number | null
          security_code: string
          total_cost: number | null
          total_qty: number | null
          total_qty_saleable: number | null
        }
        Insert: {
          avg_cost?: number | null
          created_at?: string | null
          eod_date: string
          id?: string
          investor_code: string
          market_value?: number | null
          security_code: string
          total_cost?: number | null
          total_qty?: number | null
          total_qty_saleable?: number | null
        }
        Update: {
          avg_cost?: number | null
          created_at?: string | null
          eod_date?: string
          id?: string
          investor_code?: string
          market_value?: number | null
          security_code?: string
          total_cost?: number | null
          total_qty?: number | null
          total_qty_saleable?: number | null
        }
        Relationships: []
      }
      eod_instrument_position: {
        Row: {
          avg_cost: number
          instrument: string
          investor_code: string
          saleable: number
          total_cost: number
          total_market_value: number
          total_stock: number
          trade_date: string
        }
        Insert: {
          avg_cost: number
          instrument: string
          investor_code: string
          saleable: number
          total_cost: number
          total_market_value: number
          total_stock: number
          trade_date: string
        }
        Update: {
          avg_cost?: number
          instrument?: string
          investor_code?: string
          saleable?: number
          total_cost?: number
          total_market_value?: number
          total_stock?: number
          trade_date?: string
        }
        Relationships: []
      }
      eod_investor_balance: {
        Row: {
          accrued_int: number
          boid: string | null
          cheque_in_tran_hand: number
          closing_ledger_balance: number
          d_e_rate: number | null
          equity: number
          investor_code: string
          matured_balance: number
          opening_ledger_balance: number
          receivable_sales: number
          rm_id: string | null
          trade_date: string
        }
        Insert: {
          accrued_int?: number
          boid?: string | null
          cheque_in_tran_hand?: number
          closing_ledger_balance?: number
          d_e_rate?: number | null
          equity?: number
          investor_code: string
          matured_balance?: number
          opening_ledger_balance?: number
          receivable_sales?: number
          rm_id?: string | null
          trade_date: string
        }
        Update: {
          accrued_int?: number
          boid?: string | null
          cheque_in_tran_hand?: number
          closing_ledger_balance?: number
          d_e_rate?: number | null
          equity?: number
          investor_code?: string
          matured_balance?: number
          opening_ledger_balance?: number
          receivable_sales?: number
          rm_id?: string | null
          trade_date?: string
        }
        Relationships: []
      }
      eod_ledger_snapshots: {
        Row: {
          account_type: string | null
          accrued_interest: number | null
          avg_cost: number | null
          brokerage_rate: number | null
          closing_balance: number | null
          cq_in_transit: number | null
          created_at: string
          created_by: string | null
          cumulative_interest: number | null
          department: string | null
          eod_date: string
          gross_buy: number | null
          gross_sell: number | null
          id: string
          interest_rate: number | null
          investor_code: string
          investor_name: string | null
          ledger_balance: number
          ledger_balance_snapshot: number | null
          matured_balance: number | null
          net_trade_value: number | null
          opening_balance: number | null
          pending_buy: number | null
          pending_sell: number | null
          receivable_sale: number | null
          rm_email: string | null
          rm_id: string | null
          rm_name: string | null
          saleable: number | null
          total_commission: number | null
          total_cost: number | null
          total_deposits: number | null
          total_mv: number | null
          total_stock: number | null
          total_withdrawals: number | null
          unrealized_pnl: number | null
        }
        Insert: {
          account_type?: string | null
          accrued_interest?: number | null
          avg_cost?: number | null
          brokerage_rate?: number | null
          closing_balance?: number | null
          cq_in_transit?: number | null
          created_at?: string
          created_by?: string | null
          cumulative_interest?: number | null
          department?: string | null
          eod_date: string
          gross_buy?: number | null
          gross_sell?: number | null
          id?: string
          interest_rate?: number | null
          investor_code: string
          investor_name?: string | null
          ledger_balance?: number
          ledger_balance_snapshot?: number | null
          matured_balance?: number | null
          net_trade_value?: number | null
          opening_balance?: number | null
          pending_buy?: number | null
          pending_sell?: number | null
          receivable_sale?: number | null
          rm_email?: string | null
          rm_id?: string | null
          rm_name?: string | null
          saleable?: number | null
          total_commission?: number | null
          total_cost?: number | null
          total_deposits?: number | null
          total_mv?: number | null
          total_stock?: number | null
          total_withdrawals?: number | null
          unrealized_pnl?: number | null
        }
        Update: {
          account_type?: string | null
          accrued_interest?: number | null
          avg_cost?: number | null
          brokerage_rate?: number | null
          closing_balance?: number | null
          cq_in_transit?: number | null
          created_at?: string
          created_by?: string | null
          cumulative_interest?: number | null
          department?: string | null
          eod_date?: string
          gross_buy?: number | null
          gross_sell?: number | null
          id?: string
          interest_rate?: number | null
          investor_code?: string
          investor_name?: string | null
          ledger_balance?: number
          ledger_balance_snapshot?: number | null
          matured_balance?: number | null
          net_trade_value?: number | null
          opening_balance?: number | null
          pending_buy?: number | null
          pending_sell?: number | null
          receivable_sale?: number | null
          rm_email?: string | null
          rm_id?: string | null
          rm_name?: string | null
          saleable?: number | null
          total_commission?: number | null
          total_cost?: number | null
          total_deposits?: number | null
          total_mv?: number | null
          total_stock?: number | null
          total_withdrawals?: number | null
          unrealized_pnl?: number | null
        }
        Relationships: []
      }
      eod_run_history: {
        Row: {
          clients_captured: number
          deposit_records_count: number | null
          gross_buy: number | null
          gross_sell: number | null
          id: string
          notes: string | null
          run_at: string
          run_by: string | null
          run_by_email: string | null
          run_date: string
          status: string
          total_commission: number | null
          total_deposits: number | null
          total_ledger_balance: number
          total_withdrawals: number | null
          trade_files_count: number | null
        }
        Insert: {
          clients_captured?: number
          deposit_records_count?: number | null
          gross_buy?: number | null
          gross_sell?: number | null
          id?: string
          notes?: string | null
          run_at?: string
          run_by?: string | null
          run_by_email?: string | null
          run_date: string
          status?: string
          total_commission?: number | null
          total_deposits?: number | null
          total_ledger_balance?: number
          total_withdrawals?: number | null
          trade_files_count?: number | null
        }
        Update: {
          clients_captured?: number
          deposit_records_count?: number | null
          gross_buy?: number | null
          gross_sell?: number | null
          id?: string
          notes?: string | null
          run_at?: string
          run_by?: string | null
          run_by_email?: string | null
          run_date?: string
          status?: string
          total_commission?: number | null
          total_deposits?: number | null
          total_ledger_balance?: number
          total_withdrawals?: number | null
          trade_files_count?: number | null
        }
        Relationships: []
      }
      files: {
        Row: {
          created_at: string | null
          error_count: number | null
          error_details: Json | null
          file_name: string
          file_size: number | null
          file_type: string | null
          id: string
          mime_type: string | null
          processed_at: string | null
          records_count: number | null
          status: string | null
          storage_path: string | null
          success_count: number | null
          upload_date: string | null
          uploaded_by: string | null
          uploaded_by_email: string | null
        }
        Insert: {
          created_at?: string | null
          error_count?: number | null
          error_details?: Json | null
          file_name: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          mime_type?: string | null
          processed_at?: string | null
          records_count?: number | null
          status?: string | null
          storage_path?: string | null
          success_count?: number | null
          upload_date?: string | null
          uploaded_by?: string | null
          uploaded_by_email?: string | null
        }
        Update: {
          created_at?: string | null
          error_count?: number | null
          error_details?: Json | null
          file_name?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          mime_type?: string | null
          processed_at?: string | null
          records_count?: number | null
          status?: string | null
          storage_path?: string | null
          success_count?: number | null
          upload_date?: string | null
          uploaded_by?: string | null
          uploaded_by_email?: string | null
        }
        Relationships: []
      }
      forced_liquidations: {
        Row: {
          approved_by: string | null
          created_at: string | null
          id: string
          investor_code: string
          liquidation_date: string
          margin_call_id: string | null
          quantity_sold: number
          reason: string | null
          sale_price: number
          total_proceeds: number
          trading_code: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string | null
          id?: string
          investor_code: string
          liquidation_date: string
          margin_call_id?: string | null
          quantity_sold: number
          reason?: string | null
          sale_price: number
          total_proceeds: number
          trading_code: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string | null
          id?: string
          investor_code?: string
          liquidation_date?: string
          margin_call_id?: string | null
          quantity_sold?: number
          reason?: string | null
          sale_price?: number
          total_proceeds?: number
          trading_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "forced_liquidations_margin_call_id_fkey"
            columns: ["margin_call_id"]
            isOneToOne: false
            referencedRelation: "margin_calls"
            referencedColumns: ["id"]
          },
        ]
      }
      holdings: {
        Row: {
          avg_cost: number | null
          boid: string | null
          created_at: string
          id: string
          investor_code: string
          investor_name: string | null
          ledger_balance: number | null
          market_value: number | null
          rm_email: string | null
          saleable: number | null
          total_cost: number | null
          total_stock: number | null
          trading_code: string
          updated_at: string
        }
        Insert: {
          avg_cost?: number | null
          boid?: string | null
          created_at?: string
          id?: string
          investor_code: string
          investor_name?: string | null
          ledger_balance?: number | null
          market_value?: number | null
          rm_email?: string | null
          saleable?: number | null
          total_cost?: number | null
          total_stock?: number | null
          trading_code: string
          updated_at?: string
        }
        Update: {
          avg_cost?: number | null
          boid?: string | null
          created_at?: string
          id?: string
          investor_code?: string
          investor_name?: string | null
          ledger_balance?: number | null
          market_value?: number | null
          rm_email?: string | null
          saleable?: number | null
          total_cost?: number | null
          total_stock?: number | null
          trading_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      instrument: {
        Row: {
          authorized_cap: number | null
          category: string | null
          created_at: string | null
          eps: number | null
          face_value: number | null
          free_float_mcap: number | null
          full_name: string | null
          haircut_pct: number | null
          id: string
          instrument_type: string | null
          is_active: boolean | null
          is_marginable: boolean | null
          isin: string | null
          last_agm_date: string | null
          last_synced_at: string | null
          listing_year: number | null
          lot_size: number | null
          market: string | null
          market_cap: number | null
          nav: number | null
          paid_up_cap: number | null
          pe_ratio: number | null
          sector: string | null
          total_shares: number | null
          trading_code: string
          updated_at: string | null
          week_52_high: number | null
          week_52_low: number | null
        }
        Insert: {
          authorized_cap?: number | null
          category?: string | null
          created_at?: string | null
          eps?: number | null
          face_value?: number | null
          free_float_mcap?: number | null
          full_name?: string | null
          haircut_pct?: number | null
          id?: string
          instrument_type?: string | null
          is_active?: boolean | null
          is_marginable?: boolean | null
          isin?: string | null
          last_agm_date?: string | null
          last_synced_at?: string | null
          listing_year?: number | null
          lot_size?: number | null
          market?: string | null
          market_cap?: number | null
          nav?: number | null
          paid_up_cap?: number | null
          pe_ratio?: number | null
          sector?: string | null
          total_shares?: number | null
          trading_code: string
          updated_at?: string | null
          week_52_high?: number | null
          week_52_low?: number | null
        }
        Update: {
          authorized_cap?: number | null
          category?: string | null
          created_at?: string | null
          eps?: number | null
          face_value?: number | null
          free_float_mcap?: number | null
          full_name?: string | null
          haircut_pct?: number | null
          id?: string
          instrument_type?: string | null
          is_active?: boolean | null
          is_marginable?: boolean | null
          isin?: string | null
          last_agm_date?: string | null
          last_synced_at?: string | null
          listing_year?: number | null
          lot_size?: number | null
          market?: string | null
          market_cap?: number | null
          nav?: number | null
          paid_up_cap?: number | null
          pe_ratio?: number | null
          sector?: string | null
          total_shares?: number | null
          trading_code?: string
          updated_at?: string | null
          week_52_high?: number | null
          week_52_low?: number | null
        }
        Relationships: []
      }
      instrument_prices_eod: {
        Row: {
          eod_price: number
          instrument: string
          trade_date: string
        }
        Insert: {
          eod_price: number
          instrument: string
          trade_date: string
        }
        Update: {
          eod_price?: number
          instrument?: string
          trade_date?: string
        }
        Relationships: []
      }
      investor_agent_assignments: {
        Row: {
          agent_id: string
          agent_name: string | null
          created_at: string
          id: string
          investor_code: string
          percentage: number
          updated_at: string
        }
        Insert: {
          agent_id: string
          agent_name?: string | null
          created_at?: string
          id?: string
          investor_code: string
          percentage?: number
          updated_at?: string
        }
        Update: {
          agent_id?: string
          agent_name?: string | null
          created_at?: string
          id?: string
          investor_code?: string
          percentage?: number
          updated_at?: string
        }
        Relationships: []
      }
      investor_change_logs: {
        Row: {
          approval_status: string | null
          approved_at: string | null
          approved_by: string | null
          changed_at: string | null
          changed_by: string
          field_name: string
          id: number
          investor_code: string
          new_value: string | null
          old_value: string | null
        }
        Insert: {
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          changed_at?: string | null
          changed_by: string
          field_name: string
          id?: number
          investor_code: string
          new_value?: string | null
          old_value?: string | null
        }
        Update: {
          approval_status?: string | null
          approved_at?: string | null
          approved_by?: string | null
          changed_at?: string | null
          changed_by?: string
          field_name?: string
          id?: number
          investor_code?: string
          new_value?: string | null
          old_value?: string | null
        }
        Relationships: []
      }
      investor_charge_config: {
        Row: {
          charge_rate: number
          commission_rate: number
          created_at: string | null
          d_e_limit: number | null
          effective_from: string
          effective_to: string | null
          id: number
          investor_code: string
        }
        Insert: {
          charge_rate: number
          commission_rate: number
          created_at?: string | null
          d_e_limit?: number | null
          effective_from: string
          effective_to?: string | null
          id?: number
          investor_code: string
        }
        Update: {
          charge_rate?: number
          commission_rate?: number
          created_at?: string | null
          d_e_limit?: number | null
          effective_from?: string
          effective_to?: string | null
          id?: number
          investor_code?: string
        }
        Relationships: []
      }
      investor_rm_assignments: {
        Row: {
          created_at: string
          department: string | null
          id: string
          investor_code: string
          percentage: number
          rm_email: string
          rm_name: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          department?: string | null
          id?: string
          investor_code: string
          percentage?: number
          rm_email: string
          rm_name?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          department?: string | null
          id?: string
          investor_code?: string
          percentage?: number
          rm_email?: string
          rm_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      investor_rm_mapping_v2: {
        Row: {
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          investor_code: string
          rm_id: string
        }
        Insert: {
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id?: string
          investor_code: string
          rm_id: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          investor_code?: string
          rm_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investor_rm_mapping_v2_rm_id_fkey"
            columns: ["rm_id"]
            isOneToOne: false
            referencedRelation: "relationship_manager"
            referencedColumns: ["id"]
          },
        ]
      }
      investors: {
        Row: {
          account_open_date: string | null
          account_type: string | null
          bank_account_no: string | null
          bank_branch: string | null
          bank_name: string | null
          bo_id: string | null
          brokerage_commission: number | null
          cell_no: string | null
          commission_effective_date: string | null
          commission_notes: string | null
          commission_updated_by: string | null
          created_at: string
          date_of_birth: string | null
          department: string | null
          email: string | null
          father_spouse_name: string | null
          home_address: string | null
          id: string
          interest_rate: number | null
          investor_code: string
          investor_name: string
          investor_type: string | null
          ledger_balance: number | null
          mother_name: string | null
          rm_id: string | null
          rm_name: string | null
          status: string | null
          trader: string | null
          updated_at: string
        }
        Insert: {
          account_open_date?: string | null
          account_type?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          bo_id?: string | null
          brokerage_commission?: number | null
          cell_no?: string | null
          commission_effective_date?: string | null
          commission_notes?: string | null
          commission_updated_by?: string | null
          created_at?: string
          date_of_birth?: string | null
          department?: string | null
          email?: string | null
          father_spouse_name?: string | null
          home_address?: string | null
          id?: string
          interest_rate?: number | null
          investor_code: string
          investor_name: string
          investor_type?: string | null
          ledger_balance?: number | null
          mother_name?: string | null
          rm_id?: string | null
          rm_name?: string | null
          status?: string | null
          trader?: string | null
          updated_at?: string
        }
        Update: {
          account_open_date?: string | null
          account_type?: string | null
          bank_account_no?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          bo_id?: string | null
          brokerage_commission?: number | null
          cell_no?: string | null
          commission_effective_date?: string | null
          commission_notes?: string | null
          commission_updated_by?: string | null
          created_at?: string
          date_of_birth?: string | null
          department?: string | null
          email?: string | null
          father_spouse_name?: string | null
          home_address?: string | null
          id?: string
          interest_rate?: number | null
          investor_code?: string
          investor_name?: string
          investor_type?: string | null
          ledger_balance?: number | null
          mother_name?: string | null
          rm_id?: string | null
          rm_name?: string | null
          status?: string | null
          trader?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      margin_accounts: {
        Row: {
          account_type: string | null
          agreement_date: string | null
          approved_limit: number | null
          created_at: string | null
          current_exposure: number | null
          excess_shortfall: number | null
          id: string
          investor_code: string
          maintenance_margin_required: number | null
          margin_utilization: number | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          account_type?: string | null
          agreement_date?: string | null
          approved_limit?: number | null
          created_at?: string | null
          current_exposure?: number | null
          excess_shortfall?: number | null
          id?: string
          investor_code: string
          maintenance_margin_required?: number | null
          margin_utilization?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          account_type?: string | null
          agreement_date?: string | null
          approved_limit?: number | null
          created_at?: string | null
          current_exposure?: number | null
          excess_shortfall?: number | null
          id?: string
          investor_code?: string
          maintenance_margin_required?: number | null
          margin_utilization?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      margin_agreements: {
        Row: {
          agreement_date: string
          agreement_number: string
          approved_limit: number
          collateral_requirements: Json | null
          created_at: string | null
          document_url: string | null
          id: string
          interest_rate: number | null
          investor_code: string
          signed_by: string | null
          status: string | null
          tenure_months: number | null
          terms_accepted: boolean | null
        }
        Insert: {
          agreement_date: string
          agreement_number: string
          approved_limit: number
          collateral_requirements?: Json | null
          created_at?: string | null
          document_url?: string | null
          id?: string
          interest_rate?: number | null
          investor_code: string
          signed_by?: string | null
          status?: string | null
          tenure_months?: number | null
          terms_accepted?: boolean | null
        }
        Update: {
          agreement_date?: string
          agreement_number?: string
          approved_limit?: number
          collateral_requirements?: Json | null
          created_at?: string | null
          document_url?: string | null
          id?: string
          interest_rate?: number | null
          investor_code?: string
          signed_by?: string | null
          status?: string | null
          tenure_months?: number | null
          terms_accepted?: boolean | null
        }
        Relationships: []
      }
      margin_calls: {
        Row: {
          call_date: string
          created_at: string | null
          created_by: string | null
          current_margin: number
          due_date: string | null
          email_sent: boolean | null
          email_sent_at: string | null
          id: string
          investor_code: string
          loan_outstanding: number | null
          margin_ratio: number | null
          margin_required: number
          notes: string | null
          portfolio_value: number | null
          resolved_at: string | null
          shortfall_amount: number
          sms_sent: boolean | null
          sms_sent_at: string | null
          status: string | null
        }
        Insert: {
          call_date?: string
          created_at?: string | null
          created_by?: string | null
          current_margin: number
          due_date?: string | null
          email_sent?: boolean | null
          email_sent_at?: string | null
          id?: string
          investor_code: string
          loan_outstanding?: number | null
          margin_ratio?: number | null
          margin_required: number
          notes?: string | null
          portfolio_value?: number | null
          resolved_at?: string | null
          shortfall_amount: number
          sms_sent?: boolean | null
          sms_sent_at?: string | null
          status?: string | null
        }
        Update: {
          call_date?: string
          created_at?: string | null
          created_by?: string | null
          current_margin?: number
          due_date?: string | null
          email_sent?: boolean | null
          email_sent_at?: string | null
          id?: string
          investor_code?: string
          loan_outstanding?: number | null
          margin_ratio?: number | null
          margin_required?: number
          notes?: string | null
          portfolio_value?: number | null
          resolved_at?: string | null
          shortfall_amount?: number
          sms_sent?: boolean | null
          sms_sent_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      margin_collateral: {
        Row: {
          as_of_date: string | null
          average_price: number | null
          collateral_value: number | null
          created_at: string | null
          current_price: number | null
          haircut_percentage: number | null
          id: string
          investor_code: string
          lien_marked: boolean | null
          market_value: number | null
          quantity: number
          trading_code: string
          updated_at: string | null
        }
        Insert: {
          as_of_date?: string | null
          average_price?: number | null
          collateral_value?: number | null
          created_at?: string | null
          current_price?: number | null
          haircut_percentage?: number | null
          id?: string
          investor_code: string
          lien_marked?: boolean | null
          market_value?: number | null
          quantity: number
          trading_code: string
          updated_at?: string | null
        }
        Update: {
          as_of_date?: string | null
          average_price?: number | null
          collateral_value?: number | null
          created_at?: string | null
          current_price?: number | null
          haircut_percentage?: number | null
          id?: string
          investor_code?: string
          lien_marked?: boolean | null
          market_value?: number | null
          quantity?: number
          trading_code?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      margin_transactions: {
        Row: {
          amount: number
          created_at: string | null
          created_by: string | null
          id: string
          interest_amount: number | null
          interest_rate: number | null
          investor_code: string
          notes: string | null
          outstanding_balance: number | null
          principal_amount: number | null
          reference_number: string | null
          transaction_date: string | null
          transaction_type: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          created_by?: string | null
          id?: string
          interest_amount?: number | null
          interest_rate?: number | null
          investor_code: string
          notes?: string | null
          outstanding_balance?: number | null
          principal_amount?: number | null
          reference_number?: string | null
          transaction_date?: string | null
          transaction_type: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          created_by?: string | null
          id?: string
          interest_amount?: number | null
          interest_rate?: number | null
          investor_code?: string
          notes?: string | null
          outstanding_balance?: number | null
          principal_amount?: number | null
          reference_number?: string | null
          transaction_date?: string | null
          transaction_type?: string
        }
        Relationships: []
      }
      merchant_banks: {
        Row: {
          bank_name: string
          created_at: string
          description: string | null
          id: string
          prefix: string
          updated_at: string
        }
        Insert: {
          bank_name: string
          created_at?: string
          description?: string | null
          id?: string
          prefix: string
          updated_at?: string
        }
        Update: {
          bank_name?: string
          created_at?: string
          description?: string | null
          id?: string
          prefix?: string
          updated_at?: string
        }
        Relationships: []
      }
      outlet_managers: {
        Row: {
          created_at: string
          id: string
          manager_email: string | null
          manager_id: string | null
          manager_name: string | null
          mancom_email: string
          mancom_id: string
          mancom_name: string | null
          outlet_name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          manager_email?: string | null
          manager_id?: string | null
          manager_name?: string | null
          mancom_email: string
          mancom_id: string
          mancom_name?: string | null
          outlet_name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          manager_email?: string | null
          manager_id?: string | null
          manager_name?: string | null
          mancom_email?: string
          mancom_id?: string
          mancom_name?: string | null
          outlet_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      portfolio_custom_fields: {
        Row: {
          created_at: string
          field_name: string
          field_type: string
          id: string
          options: Json | null
        }
        Insert: {
          created_at?: string
          field_name: string
          field_type?: string
          id?: string
          options?: Json | null
        }
        Update: {
          created_at?: string
          field_name?: string
          field_type?: string
          id?: string
          options?: Json | null
        }
        Relationships: []
      }
      portfolio_field_values: {
        Row: {
          created_at: string
          field_id: string
          id: string
          portfolio_id: string
          value: string | null
        }
        Insert: {
          created_at?: string
          field_id: string
          id?: string
          portfolio_id: string
          value?: string | null
        }
        Update: {
          created_at?: string
          field_id?: string
          id?: string
          portfolio_id?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_field_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "portfolio_custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portfolio_field_values_portfolio_id_fkey"
            columns: ["portfolio_id"]
            isOneToOne: false
            referencedRelation: "portfolios"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolios: {
        Row: {
          created_at: string
          description: string | null
          id: string
          investor_code: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          investor_code: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          investor_code?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          department_id: string | null
          email: string
          full_name: string | null
          id: string
          is_approved: boolean
          is_department_head: boolean
          is_mancom: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          email: string
          full_name?: string | null
          id: string
          is_approved?: boolean
          is_department_head?: boolean
          is_mancom?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          department_id?: string | null
          email?: string
          full_name?: string | null
          id?: string
          is_approved?: boolean
          is_department_head?: boolean
          is_mancom?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      reconciliation_results: {
        Row: {
          created_at: string
          current_ledger_balance: number | null
          id: string
          inv_code: string
          investor_name: string | null
          issues: string[] | null
          net_value: number | null
          processed_at: string
          processed_by: string | null
          reconciliation_date: string
          rm_name: string | null
          status: string
          total_buy_value: number | null
          total_sell_value: number | null
        }
        Insert: {
          created_at?: string
          current_ledger_balance?: number | null
          id?: string
          inv_code: string
          investor_name?: string | null
          issues?: string[] | null
          net_value?: number | null
          processed_at?: string
          processed_by?: string | null
          reconciliation_date?: string
          rm_name?: string | null
          status: string
          total_buy_value?: number | null
          total_sell_value?: number | null
        }
        Update: {
          created_at?: string
          current_ledger_balance?: number | null
          id?: string
          inv_code?: string
          investor_name?: string | null
          issues?: string[] | null
          net_value?: number | null
          processed_at?: string
          processed_by?: string | null
          reconciliation_date?: string
          rm_name?: string | null
          status?: string
          total_buy_value?: number | null
          total_sell_value?: number | null
        }
        Relationships: []
      }
      relationship_manager: {
        Row: {
          branch_code: string | null
          created_at: string
          default_commission_scheme_code: string | null
          department: string | null
          hire_date: string | null
          id: string
          resign_date: string | null
          rm_code: string
          rm_email: string | null
          rm_name: string
          status: string
          updated_at: string
        }
        Insert: {
          branch_code?: string | null
          created_at?: string
          default_commission_scheme_code?: string | null
          department?: string | null
          hire_date?: string | null
          id?: string
          resign_date?: string | null
          rm_code: string
          rm_email?: string | null
          rm_name: string
          status?: string
          updated_at?: string
        }
        Update: {
          branch_code?: string | null
          created_at?: string
          default_commission_scheme_code?: string | null
          department?: string | null
          hire_date?: string | null
          id?: string
          resign_date?: string | null
          rm_code?: string
          rm_email?: string | null
          rm_name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      securities: {
        Row: {
          audited_pe: number | null
          category: string | null
          close_price: number | null
          created_at: string
          director_percent: number | null
          eps: number | null
          foreign_percent: number | null
          free_float_mcap: number | null
          govt_percent: number | null
          haircut_percentage: number | null
          high_price: number | null
          id: string
          institute_percent: number | null
          instrument_type: string | null
          is_marginable: boolean | null
          last_synced_at: string | null
          low_price: number | null
          margin_category: string | null
          market_cap: number | null
          open_price: number | null
          public_percent: number | null
          sector: string | null
          total_securities: number | null
          trade_count: number | null
          trading_code: string
          trailing_pe: number | null
          updated_at: string
          value: number | null
          volume: number | null
          week_52_high: number | null
          week_52_low: number | null
        }
        Insert: {
          audited_pe?: number | null
          category?: string | null
          close_price?: number | null
          created_at?: string
          director_percent?: number | null
          eps?: number | null
          foreign_percent?: number | null
          free_float_mcap?: number | null
          govt_percent?: number | null
          haircut_percentage?: number | null
          high_price?: number | null
          id?: string
          institute_percent?: number | null
          instrument_type?: string | null
          is_marginable?: boolean | null
          last_synced_at?: string | null
          low_price?: number | null
          margin_category?: string | null
          market_cap?: number | null
          open_price?: number | null
          public_percent?: number | null
          sector?: string | null
          total_securities?: number | null
          trade_count?: number | null
          trading_code: string
          trailing_pe?: number | null
          updated_at?: string
          value?: number | null
          volume?: number | null
          week_52_high?: number | null
          week_52_low?: number | null
        }
        Update: {
          audited_pe?: number | null
          category?: string | null
          close_price?: number | null
          created_at?: string
          director_percent?: number | null
          eps?: number | null
          foreign_percent?: number | null
          free_float_mcap?: number | null
          govt_percent?: number | null
          haircut_percentage?: number | null
          high_price?: number | null
          id?: string
          institute_percent?: number | null
          instrument_type?: string | null
          is_marginable?: boolean | null
          last_synced_at?: string | null
          low_price?: number | null
          margin_category?: string | null
          market_cap?: number | null
          open_price?: number | null
          public_percent?: number | null
          sector?: string | null
          total_securities?: number | null
          trade_count?: number | null
          trading_code?: string
          trailing_pe?: number | null
          updated_at?: string
          value?: number | null
          volume?: number | null
          week_52_high?: number | null
          week_52_low?: number | null
        }
        Relationships: []
      }
      security_margin_categories: {
        Row: {
          category: string
          eligibility_notes: string | null
          free_float_market_cap: number | null
          haircut_percentage: number | null
          id: string
          is_marginable: boolean | null
          last_eligibility_check: string | null
          trading_code: string
          trailing_pe_ratio: number | null
          updated_at: string | null
        }
        Insert: {
          category: string
          eligibility_notes?: string | null
          free_float_market_cap?: number | null
          haircut_percentage?: number | null
          id?: string
          is_marginable?: boolean | null
          last_eligibility_check?: string | null
          trading_code: string
          trailing_pe_ratio?: number | null
          updated_at?: string | null
        }
        Update: {
          category?: string
          eligibility_notes?: string | null
          free_float_market_cap?: number | null
          haircut_percentage?: number | null
          id?: string
          is_marginable?: boolean | null
          last_eligibility_check?: string | null
          trading_code?: string
          trailing_pe_ratio?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      stg_deposit_withdrawal: {
        Row: {
          amount: number
          bank_name: string | null
          cheque_no: string | null
          created_at: string | null
          description: string | null
          file_id: string | null
          id: string
          investor_code: string
          processed_at: string | null
          reference: string | null
          status: string | null
          txn_date: string
          txn_type: string
        }
        Insert: {
          amount: number
          bank_name?: string | null
          cheque_no?: string | null
          created_at?: string | null
          description?: string | null
          file_id?: string | null
          id?: string
          investor_code: string
          processed_at?: string | null
          reference?: string | null
          status?: string | null
          txn_date: string
          txn_type: string
        }
        Update: {
          amount?: number
          bank_name?: string | null
          cheque_no?: string | null
          created_at?: string | null
          description?: string | null
          file_id?: string | null
          id?: string
          investor_code?: string
          processed_at?: string | null
          reference?: string | null
          status?: string | null
          txn_date?: string
          txn_type?: string
        }
        Relationships: []
      }
      stg_trade_xml: {
        Row: {
          created_at: string | null
          error_message: string | null
          exchange_code: string | null
          file_name: string | null
          id: string
          parsed_data: Json | null
          processed_at: string | null
          raw_xml: string | null
          status: string | null
          trade_date: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          exchange_code?: string | null
          file_name?: string | null
          id?: string
          parsed_data?: Json | null
          processed_at?: string | null
          raw_xml?: string | null
          status?: string | null
          trade_date?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          exchange_code?: string | null
          file_name?: string | null
          id?: string
          parsed_data?: Json | null
          processed_at?: string | null
          raw_xml?: string | null
          status?: string | null
          trade_date?: string | null
        }
        Relationships: []
      }
      trade_file: {
        Row: {
          category: string | null
          commission: number | null
          created_at: string | null
          exchange_code: string | null
          fill_type: string | null
          instrument: string
          investor_code: string
          price: number
          qty: number
          settlement_date: string
          side: string | null
          trade_date: string
          trade_id: number
        }
        Insert: {
          category?: string | null
          commission?: number | null
          created_at?: string | null
          exchange_code?: string | null
          fill_type?: string | null
          instrument: string
          investor_code: string
          price: number
          qty: number
          settlement_date: string
          side?: string | null
          trade_date: string
          trade_id?: number
        }
        Update: {
          category?: string | null
          commission?: number | null
          created_at?: string | null
          exchange_code?: string | null
          fill_type?: string | null
          instrument?: string
          investor_code?: string
          price?: number
          qty?: number
          settlement_date?: string
          side?: string | null
          trade_date?: string
          trade_id?: number
        }
        Relationships: []
      }
      trade_history: {
        Row: {
          account_type: string | null
          action: string | null
          agent_id: string | null
          asset_class: string | null
          board: string | null
          boid: string | null
          brokerage_commission: number | null
          category: string | null
          client_code: string | null
          compulsory_spot: string | null
          created_at: string
          department: string | null
          exec_id: string | null
          file_name: string | null
          fill_type: string | null
          id: string
          interest_rate: number | null
          investor_type: string | null
          isin: string | null
          ledger_balance_snapshot: number | null
          net_deposit: number | null
          order_id: string | null
          owner_dealer_id: string | null
          price: number | null
          quantity: number | null
          ref_order_id: string | null
          rm_id: string | null
          rm_name: string | null
          security_code: string | null
          session: string | null
          side: string | null
          status: string | null
          total_deposits: number | null
          total_withdrawals: number | null
          trade_date: string | null
          trade_report_type: string | null
          trade_time: string | null
          trader_dealer_id: string | null
          uploaded_at: string
          value: number | null
        }
        Insert: {
          account_type?: string | null
          action?: string | null
          agent_id?: string | null
          asset_class?: string | null
          board?: string | null
          boid?: string | null
          brokerage_commission?: number | null
          category?: string | null
          client_code?: string | null
          compulsory_spot?: string | null
          created_at?: string
          department?: string | null
          exec_id?: string | null
          file_name?: string | null
          fill_type?: string | null
          id?: string
          interest_rate?: number | null
          investor_type?: string | null
          isin?: string | null
          ledger_balance_snapshot?: number | null
          net_deposit?: number | null
          order_id?: string | null
          owner_dealer_id?: string | null
          price?: number | null
          quantity?: number | null
          ref_order_id?: string | null
          rm_id?: string | null
          rm_name?: string | null
          security_code?: string | null
          session?: string | null
          side?: string | null
          status?: string | null
          total_deposits?: number | null
          total_withdrawals?: number | null
          trade_date?: string | null
          trade_report_type?: string | null
          trade_time?: string | null
          trader_dealer_id?: string | null
          uploaded_at?: string
          value?: number | null
        }
        Update: {
          account_type?: string | null
          action?: string | null
          agent_id?: string | null
          asset_class?: string | null
          board?: string | null
          boid?: string | null
          brokerage_commission?: number | null
          category?: string | null
          client_code?: string | null
          compulsory_spot?: string | null
          created_at?: string
          department?: string | null
          exec_id?: string | null
          file_name?: string | null
          fill_type?: string | null
          id?: string
          interest_rate?: number | null
          investor_type?: string | null
          isin?: string | null
          ledger_balance_snapshot?: number | null
          net_deposit?: number | null
          order_id?: string | null
          owner_dealer_id?: string | null
          price?: number | null
          quantity?: number | null
          ref_order_id?: string | null
          rm_id?: string | null
          rm_name?: string | null
          security_code?: string | null
          session?: string | null
          side?: string | null
          status?: string | null
          total_deposits?: number | null
          total_withdrawals?: number | null
          trade_date?: string | null
          trade_report_type?: string | null
          trade_time?: string | null
          trader_dealer_id?: string | null
          uploaded_at?: string
          value?: number | null
        }
        Relationships: []
      }
      trades: {
        Row: {
          commission: number | null
          created_at: string | null
          exchange_code: string | null
          id: string
          instrument: string
          investor_code: string
          net_value: number
          order_id: string | null
          other_charges: number | null
          price: number
          quantity: number
          settlement_date: string | null
          side: string
          status: string | null
          trade_date: string
          trade_id: string | null
          trade_value: number
        }
        Insert: {
          commission?: number | null
          created_at?: string | null
          exchange_code?: string | null
          id?: string
          instrument: string
          investor_code: string
          net_value: number
          order_id?: string | null
          other_charges?: number | null
          price: number
          quantity: number
          settlement_date?: string | null
          side: string
          status?: string | null
          trade_date: string
          trade_id?: string | null
          trade_value: number
        }
        Update: {
          commission?: number | null
          created_at?: string | null
          exchange_code?: string | null
          id?: string
          instrument?: string
          investor_code?: string
          net_value?: number
          order_id?: string | null
          other_charges?: number | null
          price?: number
          quantity?: number
          settlement_date?: string | null
          side?: string
          status?: string | null
          trade_date?: string
          trade_id?: string | null
          trade_value?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      margin_equity_snapshots: {
        Row: {
          accrued_interest: number | null
          department_name: string | null
          eod_date: string | null
          equity: number | null
          investor_code: string | null
          ledger_closing_balance: number | null
          margin_interest_rate: number | null
          marginable_after_haircut: number | null
          non_marginable_holdings: number | null
          previous_day_balance: number | null
          rm_name: string | null
          total_portfolio_value: number | null
        }
        Relationships: []
      }
      vw_api_stock_daily: {
        Row: {
          category: string | null
          change: number | null
          change_pct: number | null
          close_price: number | null
          code: string | null
          date: string | null
          eps: number | null
          haircut_pct: number | null
          is_marginable: boolean | null
          market: string | null
          market_cap: number | null
          name: string | null
          pe_ratio: number | null
          prev_close: number | null
          sector: string | null
        }
        Relationships: []
      }
      vw_api_stock_fundamentals: {
        Row: {
          authorized_cap: number | null
          category: string | null
          code: string | null
          eps: number | null
          face_value: number | null
          free_float_mcap: number | null
          haircut_pct: number | null
          instrument_type: string | null
          is_active: boolean | null
          is_marginable: boolean | null
          isin: string | null
          last_agm_date: string | null
          last_synced_at: string | null
          listing_year: number | null
          lot_size: number | null
          market: string | null
          market_cap: number | null
          name: string | null
          nav: number | null
          paid_up_cap: number | null
          pe_ratio: number | null
          sector: string | null
          total_shares: number | null
          updated_at: string | null
          week_52_high: number | null
          week_52_low: number | null
        }
        Insert: {
          authorized_cap?: number | null
          category?: string | null
          code?: string | null
          eps?: number | null
          face_value?: number | null
          free_float_mcap?: number | null
          haircut_pct?: number | null
          instrument_type?: string | null
          is_active?: boolean | null
          is_marginable?: boolean | null
          isin?: string | null
          last_agm_date?: string | null
          last_synced_at?: string | null
          listing_year?: number | null
          lot_size?: number | null
          market?: string | null
          market_cap?: number | null
          name?: string | null
          nav?: number | null
          paid_up_cap?: number | null
          pe_ratio?: number | null
          sector?: string | null
          total_shares?: number | null
          updated_at?: string | null
          week_52_high?: number | null
          week_52_low?: number | null
        }
        Update: {
          authorized_cap?: number | null
          category?: string | null
          code?: string | null
          eps?: number | null
          face_value?: number | null
          free_float_mcap?: number | null
          haircut_pct?: number | null
          instrument_type?: string | null
          is_active?: boolean | null
          is_marginable?: boolean | null
          isin?: string | null
          last_agm_date?: string | null
          last_synced_at?: string | null
          listing_year?: number | null
          lot_size?: number | null
          market?: string | null
          market_cap?: number | null
          name?: string | null
          nav?: number | null
          paid_up_cap?: number | null
          pe_ratio?: number | null
          sector?: string | null
          total_shares?: number | null
          updated_at?: string | null
          week_52_high?: number | null
          week_52_low?: number | null
        }
        Relationships: []
      }
      vw_api_stock_historical: {
        Row: {
          close_price: number | null
          code: string | null
          date: string | null
          high_price: number | null
          low_price: number | null
          name: string | null
          open_price: number | null
          trade_count: number | null
          value_mn: number | null
          volume: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      auto_create_missing_investors: {
        Args: { p_trade_date: string }
        Returns: Json
      }
      bulk_assign_department_heads: {
        Args: { head_emails: string[] }
        Returns: Json
      }
      bulk_assign_mancom_managers: { Args: { managers: Json }; Returns: Json }
      clear_all_eod_data: { Args: never; Returns: Json }
      clear_eod_by_date_range: {
        Args: { p_from_date: string; p_to_date: string }
        Returns: Json
      }
      copy_balances_batch: {
        Args: {
          p_batch_size?: number
          p_offset?: number
          p_source_date: string
          p_target_date: string
        }
        Returns: Json
      }
      copy_balances_to_date: {
        Args: { p_source_date: string; p_target_date: string }
        Returns: Json
      }
      delete_all_holdings: { Args: never; Returns: number }
      get_accounting_data_v2: {
        Args: {
          _account_type_filter: string
          _from_trade_date: string
          _from_tx_date: string
          _has_activity_filter: string
          _limit: number
          _offset: number
          _search: string
          _to_trade_date: string
          _to_tx_date: string
        }
        Returns: {
          account_type: string
          closing_balance: number
          department: string
          deposits: number
          gross_buy: number
          gross_sell: number
          investor_code: string
          investor_name: string
          opening_balance: number
          rm: string
          withdrawals: number
        }[]
      }
      get_accounting_data_v3:
        | {
            Args: {
              _account_type_filter?: string
              _has_activity_filter?: string
              _limit?: number
              _offset?: number
              _opening_date: string
              _search?: string
              _tx_date: string
            }
            Returns: {
              account_type: string
              brokerage: number
              closing_balance: number
              department: string
              deposits: number
              gross_buy: number
              gross_sell: number
              investor_code: string
              investor_name: string
              opening_balance: number
              rm_name: string
              total_count: number
              withdrawals: number
            }[]
          }
        | {
            Args: {
              _account_type_filter?: string
              _from_trade_date?: string
              _from_tx_date?: string
              _has_activity_filter?: string
              _limit?: number
              _offset?: number
              _search?: string
              _to_trade_date?: string
              _to_tx_date?: string
            }
            Returns: {
              acc_type: string
              accrued_interest: number
              closing_balance: number
              department: string
              investor_code: string
              investor_name: string
              opening_balance: number
              rm_id: string
              rm_name: string
              total_brokerage: number
              total_buy: number
              total_count: number
              total_deposit: number
              total_sell: number
              total_withdrawal: number
            }[]
          }
        | {
            Args: {
              _account_type_filter?: string
              _end_date: string
              _is_admin?: boolean
              _is_dept_head?: boolean
              _is_mancom?: boolean
              _page_number?: number
              _page_size?: number
              _start_date: string
              _user_email?: string
            }
            Returns: {
              acc_type: string
              accrued_interest: number
              brokerage: number
              buy_amount: number
              closing_balance: number
              department: string
              deposits: number
              investor_code: string
              investor_name: string
              opening_balance: number
              rm_id: string
              rm_name: string
              sell_amount: number
              total_count: number
              withdrawals: number
            }[]
          }
      get_accounting_summary: {
        Args: {
          _account_type_filter?: string
          _from_trade_date?: string
          _from_tx_date?: string
          _has_trades_filter?: string
          _search_term?: string
          _to_trade_date?: string
          _to_tx_date?: string
        }
        Returns: {
          margin_accounts: number
          total_accounts: number
          total_accrued_interest: number
          total_buy: number
          total_margin_loan: number
          total_payable: number
          total_receivable: number
          total_sell: number
          total_trade_value: number
        }[]
      }
      get_accounting_trade_sums: {
        Args: { _from_trade_date: string; _to_trade_date: string }
        Returns: {
          buy_sum: number
          client_code: string
          sell_sum: number
        }[]
      }
      get_accounting_turnover_by_department: {
        Args: { _from_tx_date?: string; _to_tx_date?: string }
        Returns: {
          department: string
          total_buy: number
          total_sell: number
          turnover: number
        }[]
      }
      get_admin_balances_enriched: {
        Args: {
          p_cursor_id?: string
          p_date: string
          p_limit?: number
          p_rm_email?: string
        }
        Returns: {
          account_type: string
          accrued_interest: number
          adjusted_ledger: number
          as_of_date: string
          avg_cost: number
          brokerage_amount: number
          brokerage_commission_rate: number
          cq_in_transit: number
          deposits: number
          gross_buy: number
          gross_sell: number
          id: string
          instrument: string
          interest_rate: number
          investor_code: string
          ledger_balance: number
          matured_balance: number
          net_available: number
          net_buy: number
          net_sell: number
          pnl_pct: number
          receivable_payable: number
          receivable_sale: number
          risk_flag: string
          rm_email: string
          rm_id: string
          rm_name: string
          saleable: number
          total_cost: number
          total_mv: number
          total_stock: number
          unrealized_pnl: number
          withdrawals: number
        }[]
      }
      get_admin_balances_summary: {
        Args: { p_date: string; p_rm_email?: string }
        Returns: {
          cq_sum: number
          negative_ledger_count: number
          receivable_sum: number
          total_accrued_interest: number
          total_brokerage: number
          total_clients: number
          total_cost_sum: number
          total_margin_loan: number
          total_mv_sum: number
          unrealized_pnl_sum: number
        }[]
      }
      get_admin_trade_file_stats: {
        Args: never
        Returns: {
          file_name: string
          first_upload: string
          last_upload: string
          record_count: number
          total_value: number
          unique_clients: number
        }[]
      }
      get_admin_trades: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_file_name?: string
          p_hide_zero_values?: boolean
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_side?: string
          p_sort_column?: string
          p_sort_direction?: string
          p_status?: string
        }
        Returns: {
          account_type: string
          action: string
          agent_id: string
          board: string
          boid: string
          brokerage_commission: number
          category: string
          client_code: string
          department: string
          exec_id: string
          file_name: string
          fill_type: string
          id: string
          interest_rate: number
          investor_type: string
          isin: string
          ledger_balance_snapshot: number
          net_deposit: number
          order_id: string
          owner_dealer_id: string
          price: number
          quantity: number
          rm_id: string
          rm_name: string
          security_code: string
          session: string
          side: string
          status: string
          total_count: number
          total_deposits: number
          total_withdrawals: number
          trade_date: string
          trade_time: string
          trader_dealer_id: string
          uploaded_at: string
          value: number
        }[]
      }
      get_balance_dates: {
        Args: never
        Returns: {
          as_of_date: string
        }[]
      }
      get_balance_rms: {
        Args: never
        Returns: {
          rm_email: string
          rm_name: string
        }[]
      }
      get_balances_for_ceo_dashboard: {
        Args: { target_date: string }
        Returns: {
          as_of_date: string
          avg_cost: number
          cq_in_transit: number
          id: string
          instrument: string
          investor_code: string
          ledger_balance: number
          matured_balance: number
          receivable_sale: number
          rm_email: string
          rm_id: string
          rm_name: string
          saleable: number
          total_cost: number
          total_mv: number
          total_stock: number
        }[]
      }
      get_charge_rate: {
        Args: {
          p_as_of_date?: string
          p_base_amount?: number
          p_charge_code: string
          p_investor_group?: string
        }
        Returns: {
          basis: string
          charge_code: string
          charge_type: string
          max_charge: number
          min_charge: number
          rate: number
        }[]
      }
      get_commission_by_department: {
        Args: { _from_tx_date?: string; _to_tx_date?: string }
        Returns: {
          department: string
          total_commission: number
          total_turnover: number
          trade_count: number
        }[]
      }
      get_commission_rate: {
        Args: {
          p_instrument_group?: string
          p_investor_group?: string
          p_rm_id?: string
          p_trade_date: string
          p_trade_value?: number
        }
        Returns: {
          commission_rate: number
          commission_type: string
          max_commission: number
          min_commission: number
          scheme_code: string
        }[]
      }
      get_deposit_import_stats: {
        Args: never
        Returns: {
          deposit_count: number
          first_upload: string
          last_upload: string
          total_deposits: number
          total_withdrawals: number
          transaction_date: string
          withdrawal_count: number
        }[]
      }
      get_deposit_withdrawal_counts: {
        Args: { p_date: string }
        Returns: {
          amount: number
          count: number
          investor_code: string
          transaction_type: string
        }[]
      }
      get_employee_id_for_user: { Args: never; Returns: string }
      get_investor_filter_options: {
        Args: never
        Returns: {
          account_types: string[]
          investor_types: string[]
          statuses: string[]
        }[]
      }
      get_investor_rm: {
        Args: { p_as_of_date?: string; p_investor_code: string }
        Returns: {
          default_commission_scheme_code: string
          department: string
          rm_code: string
          rm_email: string
          rm_id: string
          rm_name: string
        }[]
      }
      get_margin_client_accounts: {
        Args: {
          p_account_type?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_statuses?: string[]
        }
        Returns: {
          account_type: string
          accrued_interest: number
          current_exposure: number
          equity: number
          investor_code: string
          investor_name: string
          margin_ratio: number
          portfolio_value: number
          rm_name: string
          status: string
        }[]
      }
      get_margin_client_summary: {
        Args: {
          p_account_type?: string
          p_search?: string
          p_statuses?: string[]
        }
        Returns: {
          total_accounts: number
          total_accrued_interest: number
          total_equity: number
          total_margin_outstanding: number
          total_portfolio_value: number
        }[]
      }
      get_margin_composition_by_department: {
        Args: { p_from_date?: string; p_to_date?: string }
        Returns: {
          actual_from_date: string
          actual_to_date: string
          beginning_loan: number
          change_percent: number
          client_count: number
          department: string
          ending_loan: number
          loan_change: number
        }[]
      }
      get_margin_dashboard_summary: {
        Args: { p_eod_date?: string }
        Returns: Json
      }
      get_margin_treemap_data: {
        Args: never
        Returns: {
          client_count: number
          department_name: string
          margin_outstanding: number
          margin_ratio: number
          portfolio_value: number
          rm_id: string
          rm_name: string
        }[]
      }
      get_negative_balance_codes: {
        Args: { p_from_date?: string; p_search?: string; p_to_date?: string }
        Returns: {
          client_code: string
          client_name: string
          closing_balance: number
          event_date: string
          rm_name: string
        }[]
      }
      get_stock_daily: {
        Args: {
          _code?: string
          _date?: string
          _limit?: number
          _offset?: number
          _sector?: string
        }
        Returns: {
          category: string
          change: number
          change_pct: number
          close_price: number
          code: string
          date: string
          eps: number
          haircut_pct: number
          is_marginable: boolean
          market: string
          market_cap: number
          name: string
          pe_ratio: number
          prev_close: number
          sector: string
        }[]
      }
      get_stock_fundamentals: {
        Args: { _code: string }
        Returns: {
          authorized_cap: number
          category: string
          code: string
          eps: number
          face_value: number
          free_float_mcap: number
          haircut_pct: number
          instrument_type: string
          is_active: boolean
          is_marginable: boolean
          isin: string
          last_agm_date: string
          last_synced_at: string
          listing_year: number
          lot_size: number
          market: string
          market_cap: number
          name: string
          nav: number
          paid_up_cap: number
          pe_ratio: number
          sector: string
          total_shares: number
          updated_at: string
          week_52_high: number
          week_52_low: number
        }[]
      }
      get_stock_historical: {
        Args: {
          _code: string
          _from_date?: string
          _limit?: number
          _offset?: number
          _to_date?: string
        }
        Returns: {
          close_price: number
          code: string
          date: string
          high_price: number
          low_price: number
          name: string
          open_price: number
          trade_count: number
          value_mn: number
          volume: number
        }[]
      }
      get_top_margin_clients: {
        Args: { p_eod_date?: string; p_limit?: number }
        Returns: {
          department_name: string
          equity: number
          exposure: number
          investor_code: string
          margin_ratio: number
          portfolio_value: number
          rm_name: string
        }[]
      }
      get_trade_file_stats: {
        Args: never
        Returns: {
          file_name: string
          first_upload: string
          last_upload: string
          record_count: number
          total_value: number
          unique_clients: number
        }[]
      }
      get_unmatched_staging_summary: {
        Args: { p_trade_date: string }
        Returns: {
          sample_codes: string[]
          unmatched_deposit_count: number
          unmatched_deposit_value: number
          unmatched_trade_count: number
          unmatched_trade_value: number
          unmatched_withdrawal_count: number
          unmatched_withdrawal_value: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      init_copy_balances: {
        Args: { p_source_date: string; p_target_date: string }
        Returns: Json
      }
      is_department_head_of_rm: {
        Args: { _rm_email: string }
        Returns: boolean
      }
      is_hr_or_ceo: { Args: never; Returns: boolean }
      is_mancom_of_rm: { Args: { _rm_email: string }; Returns: boolean }
      is_settlement_department: { Args: never; Returns: boolean }
      process_staged_trades: { Args: { p_trade_date: string }; Returns: Json }
      run_batch_eod: {
        Args: { p_eod_date: string; p_skip_existing?: boolean }
        Returns: Json
      }
      sync_departments_from_employees: { Args: never; Returns: Json }
      update_investor_balances_bulk: {
        Args: { updates: Json }
        Returns: number
      }
      update_investor_commissions_bulk: {
        Args: { updates: Json }
        Returns: number
      }
    }
    Enums: {
      app_role: "admin" | "rm" | "user" | "agent" | "mancom" | "branch_manager"
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
    Enums: {
      app_role: ["admin", "rm", "user", "agent", "mancom", "branch_manager"],
    },
  },
} as const
