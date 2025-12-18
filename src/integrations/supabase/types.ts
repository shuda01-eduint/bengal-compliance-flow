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
          created_at: string
          date_of_birth: string | null
          email: string | null
          father_spouse_name: string | null
          home_address: string | null
          id: string
          interest_rate: number | null
          investor_code: string
          investor_name: string
          investor_type: string | null
          mother_name: string | null
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
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          father_spouse_name?: string | null
          home_address?: string | null
          id?: string
          interest_rate?: number | null
          investor_code: string
          investor_name: string
          investor_type?: string | null
          mother_name?: string | null
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
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          father_spouse_name?: string | null
          home_address?: string | null
          id?: string
          interest_rate?: number | null
          investor_code?: string
          investor_name?: string
          investor_type?: string | null
          mother_name?: string | null
          status?: string | null
          trader?: string | null
          updated_at?: string
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
      securities: {
        Row: {
          audited_pe: number | null
          category: string | null
          close_price: number | null
          created_at: string
          director_percent: number | null
          eps: number | null
          foreign_percent: number | null
          govt_percent: number | null
          id: string
          institute_percent: number | null
          instrument_type: string | null
          public_percent: number | null
          sector: string | null
          total_securities: number | null
          trading_code: string
          updated_at: string
          volume: number | null
        }
        Insert: {
          audited_pe?: number | null
          category?: string | null
          close_price?: number | null
          created_at?: string
          director_percent?: number | null
          eps?: number | null
          foreign_percent?: number | null
          govt_percent?: number | null
          id?: string
          institute_percent?: number | null
          instrument_type?: string | null
          public_percent?: number | null
          sector?: string | null
          total_securities?: number | null
          trading_code: string
          updated_at?: string
          volume?: number | null
        }
        Update: {
          audited_pe?: number | null
          category?: string | null
          close_price?: number | null
          created_at?: string
          director_percent?: number | null
          eps?: number | null
          foreign_percent?: number | null
          govt_percent?: number | null
          id?: string
          institute_percent?: number | null
          instrument_type?: string | null
          public_percent?: number | null
          sector?: string | null
          total_securities?: number | null
          trading_code?: string
          updated_at?: string
          volume?: number | null
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
      [_ in never]: never
    }
    Functions: {
      get_accounting_data: {
        Args: {
          _from_trade_date?: string
          _from_tx_date?: string
          _page_offset?: number
          _page_size?: number
          _search_term?: string
          _to_trade_date?: string
          _to_tx_date?: string
        }
        Returns: {
          account_type: string
          accrued_interest: number
          adjusted_ledger: number
          brokerage_amount: number
          brokerage_commission: number
          final_balance: number
          gross_buy: number
          gross_sell: number
          interest_rate: number
          investor_code: string
          investor_name: string
          ledger_balance: number
          net_sell: number
          payable: number
          receivable: number
          total_count: number
          total_deposits: number
          total_withdrawals: number
        }[]
      }
      get_accounting_summary: {
        Args: {
          _from_trade_date?: string
          _from_tx_date?: string
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
      get_employee_id_for_user: { Args: never; Returns: string }
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_department_head_of_rm: {
        Args: { _rm_email: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "rm" | "user" | "agent"
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
      app_role: ["admin", "rm", "user", "agent"],
    },
  },
} as const
