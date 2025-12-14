import { z } from 'zod';

// Sanitize string to prevent formula injection
export function sanitizeString(value: string): string {
  if (!value) return value;
  // Remove formula prefixes that could be dangerous in CSV/Excel
  const formulaPrefixes = ['=', '+', '-', '@', '\t', '\r', '\n'];
  let sanitized = value.trim();
  while (formulaPrefixes.some(prefix => sanitized.startsWith(prefix))) {
    sanitized = sanitized.slice(1).trim();
  }
  return sanitized;
}

// Client import schema
export const ClientRecordSchema = z.object({
  inv_code: z.string().min(1, "Investor code is required").max(50, "Investor code too long"),
  investor_name: z.string().min(1, "Investor name is required").max(200, "Investor name too long"),
  ledger_balance: z.number().finite("Ledger balance must be a valid number"),
  accrued_interest: z.number().finite("Accrued interest must be a valid number"),
  current_liabilities: z.number().finite("Current liabilities must be a valid number"),
  market_value: z.number().finite("Market value must be a valid number"),
  equity: z.number().finite("Equity must be a valid number"),
  rm_name: z.string().min(1, "RM name is required").max(100, "RM name too long"),
  status: z.string().min(1, "Status is required").max(50, "Status too long"),
});

export type ClientRecord = z.infer<typeof ClientRecordSchema>;

// Holdings import schema
export const HoldingRecordSchema = z.object({
  trading_code: z.string().min(1, "Trading code is required").max(50, "Trading code too long"),
  investor_code: z.string().min(1, "Investor code is required").max(50, "Investor code too long"),
  boid: z.string().max(50, "BOID too long").nullable().optional(),
  investor_name: z.string().max(200, "Investor name too long").nullable().optional(),
  total_stock: z.number().int("Must be an integer").min(0, "Cannot be negative").nullable().optional(),
  saleable: z.number().int("Must be an integer").min(0, "Cannot be negative").nullable().optional(),
  avg_cost: z.number().finite("Must be a valid number").min(0, "Cannot be negative").nullable().optional(),
  total_cost: z.number().finite("Must be a valid number").nullable().optional(),
  market_value: z.number().finite("Must be a valid number").nullable().optional(),
  ledger_balance: z.number().finite("Must be a valid number").nullable().optional(),
  rm_email: z.string().max(255, "Email too long").nullable().optional(),
});

export type HoldingRecord = z.infer<typeof HoldingRecordSchema>;

// Securities import schema
export const SecurityRecordSchema = z.object({
  trading_code: z.string().min(1, "Trading code is required").max(50, "Trading code too long"),
  close_price: z.number().finite("Must be a valid number").min(0, "Cannot be negative").nullable().optional(),
  volume: z.number().int("Must be an integer").min(0, "Cannot be negative").nullable().optional(),
  category: z.string().max(10, "Category too long").nullable().optional(),
  audited_pe: z.number().finite("Must be a valid number").nullable().optional(),
  eps: z.number().finite("Must be a valid number").nullable().optional(),
  instrument_type: z.string().max(50, "Instrument type too long").nullable().optional(),
  total_securities: z.number().int("Must be an integer").min(0, "Cannot be negative").nullable().optional(),
  director_percent: z.number().finite("Must be a valid number").min(0).max(100).nullable().optional(),
  govt_percent: z.number().finite("Must be a valid number").min(0).max(100).nullable().optional(),
  institute_percent: z.number().finite("Must be a valid number").min(0).max(100).nullable().optional(),
  foreign_percent: z.number().finite("Must be a valid number").min(0).max(100).nullable().optional(),
  public_percent: z.number().finite("Must be a valid number").min(0).max(100).nullable().optional(),
  sector: z.string().max(100, "Sector too long").nullable().optional(),
});

export type SecurityRecord = z.infer<typeof SecurityRecordSchema>;

// Agent codes import schema
export const AgentCodeRecordSchema = z.object({
  investor_code: z.string().min(1, "Investor code is required").max(50, "Investor code too long"),
  agent_id: z.string().min(1, "Agent ID is required").max(50, "Agent ID too long"),
  rm_id: z.string().min(1, "RM ID is required").max(50, "RM ID too long"),
});

export type AgentCodeRecord = z.infer<typeof AgentCodeRecordSchema>;

// Trade history import schema
export const TradeRecordSchema = z.object({
  action: z.string().max(50).nullable().optional(),
  status: z.string().max(50).nullable().optional(),
  isin: z.string().max(50).nullable().optional(),
  asset_class: z.string().max(50).nullable().optional(),
  order_id: z.string().max(100).nullable().optional(),
  ref_order_id: z.string().max(100).nullable().optional(),
  side: z.enum(['BUY', 'SELL']).nullable().optional(),
  boid: z.string().max(50).nullable().optional(),
  security_code: z.string().max(50).nullable().optional(),
  board: z.string().max(50).nullable().optional(),
  trade_date: z.string().max(50).nullable().optional(),
  trade_time: z.string().max(50).nullable().optional(),
  quantity: z.number().int().min(0).nullable().optional(),
  price: z.number().finite().min(0).nullable().optional(),
  value: z.number().finite().nullable().optional(),
  exec_id: z.string().max(100).nullable().optional(),
  session: z.string().max(50).nullable().optional(),
  fill_type: z.string().max(50).nullable().optional(),
  category: z.string().max(50).nullable().optional(),
  compulsory_spot: z.string().max(50).nullable().optional(),
  client_code: z.string().max(50).nullable().optional(),
  trader_dealer_id: z.string().max(100).nullable().optional(),
  owner_dealer_id: z.string().max(100).nullable().optional(),
  trade_report_type: z.string().max(100).nullable().optional(),
  file_name: z.string().max(255).nullable().optional(),
});

export type TradeRecord = z.infer<typeof TradeRecordSchema>;

// Deposits/Withdrawals import schema
export const DepositsWithdrawalsRecordSchema = z.object({
  investor_code: z.string().min(1, "Investor code is required").max(50, "Investor code too long"),
  transaction_type: z.string().min(1, "Transaction type is required").max(50, "Transaction type too long"),
  amount: z.number().finite("Amount must be a valid number").min(0, "Amount cannot be negative"),
  transaction_date: z.string().max(50).optional(),
  investor_name: z.string().max(200).nullable().optional(),
  rm_email: z.string().max(255).nullable().optional(),
  remarks: z.string().max(500).nullable().optional(),
});

export type DepositsWithdrawalsRecord = z.infer<typeof DepositsWithdrawalsRecordSchema>;

// Generic validation function
export function validateRecords<T>(
  records: unknown[],
  schema: z.ZodSchema<T>,
  sanitize: boolean = true
): { valid: T[]; errors: string[] } {
  const valid: T[] = [];
  const errors: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i] as Record<string, unknown>;
    
    // Sanitize string fields if enabled
    if (sanitize) {
      for (const key of Object.keys(record)) {
        if (typeof record[key] === 'string') {
          record[key] = sanitizeString(record[key] as string);
        }
      }
    }

    const result = schema.safeParse(record);
    
    if (result.success) {
      valid.push(result.data);
    } else {
      if (errors.length < 10) { // Limit error messages
        errors.push(`Row ${i + 1}: ${result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
      }
    }
  }

  return { valid, errors };
}
