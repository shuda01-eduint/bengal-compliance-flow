/**
 * Database Service Layer
 * 
 * Centralized data access with consistent patterns for:
 * - Pagination (both offset and cursor-based)
 * - Filtering with type-safe operators
 * - Bulk operations with progress tracking
 * - Caching-friendly responses
 * 
 * Usage:
 * ```typescript
 * import { TradeService, EmployeeService, AgentService, ClientService } from '@/services';
 * 
 * // Get paginated trades
 * const trades = await TradeService.getAdminTrades({
 *   filters: { dateFrom: '2024-01-01', side: 'BUY' },
 *   pagination: { page: 1, pageSize: 50 }
 * });
 * 
 * // Get all employees with progress
 * const employees = await EmployeeService.getAllEmployees({
 *   filters: { department: 'Sales' },
 *   onProgress: (loaded, total) => console.log(`${loaded}/${total}`)
 * });
 * ```
 */

// Re-export types
export * from './types';

// Re-export base service for extension
export { BaseService } from './base.service';

// Trade services
export { 
  TradeService, 
  DepositWithdrawalService, 
  AccountingService 
} from './trade.service';

// Employee service
export { EmployeeService } from './employee.service';

// Agent service
export { AgentService } from './agent.service';

// Client services
export { 
  ClientService, 
  InvestorService, 
  BalanceService, 
  HoldingService 
} from './client.service';
