import { MainLayout } from "@/components/layout/MainLayout";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Users, TrendingUp, Wallet, AlertCircle } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ImportClientsDialog } from "@/components/admin/ImportClientsDialog";
import { useAgentCodes, getAgentCodesGroupedByRM } from "@/hooks/useAgentCodes";
import { employees } from "@/data/employees";

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('en-BD', {
    style: 'currency',
    currency: 'BDT',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const AdminBalancesPage = () => {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRM, setSelectedRM] = useState("all");

  const { data: clients, isLoading, error } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      // Fetch all clients - using range to bypass 1000 limit
      type Client = {
        id: string;
        inv_code: string;
        investor_name: string;
        ledger_balance: number;
        accrued_interest: number;
        current_liabilities: number;
        market_value: number;
        equity: number;
        rm_name: string;
        rm_email: string | null;
        status: string;
        created_at: string;
        updated_at: string;
      };
      
      let allClients: Client[] = [];
      let from = 0;
      const batchSize = 1000;
      
      while (true) {
        const { data, error } = await supabase
          .from('clients')
          .select('*')
          .order('rm_name', { ascending: true })
          .range(from, from + batchSize - 1);
        
        if (error) throw error;
        if (!data || data.length === 0) break;
        
        allClients = [...allClients, ...data];
        if (data.length < batchSize) break;
        from += batchSize;
      }
      
      return allClients;
    },
  });

  // Fetch deposits/withdrawals grouped by investor_code
  const { data: depositsWithdrawals } = useQuery({
    queryKey: ['deposits-withdrawals-summary'],
    queryFn: async () => {
      let allData: { investor_code: string; transaction_type: string; amount: number }[] = [];
      let from = 0;
      const batchSize = 1000;
      
      while (true) {
        const { data, error } = await supabase
          .from('deposits_withdrawals')
          .select('investor_code, transaction_type, amount')
          .range(from, from + batchSize - 1);
        
        if (error) throw error;
        if (!data || data.length === 0) break;
        
        allData = [...allData, ...data];
        if (data.length < batchSize) break;
        from += batchSize;
      }
      
      // Group by investor_code
      const grouped: Record<string, { deposits: number; withdrawals: number }> = {};
      allData.forEach(item => {
        if (!grouped[item.investor_code]) {
          grouped[item.investor_code] = { deposits: 0, withdrawals: 0 };
        }
        if (item.transaction_type === 'Deposit') {
          grouped[item.investor_code].deposits += Number(item.amount) || 0;
        } else if (item.transaction_type === 'Withdrawal') {
          grouped[item.investor_code].withdrawals += Number(item.amount) || 0;
        }
      });
      
      return grouped;
    },
  });

  // Fetch trade data to calculate net sell per client
  const { data: tradeSummary } = useQuery({
    queryKey: ['trade-summary'],
    queryFn: async () => {
      let allTrades: { client_code: string | null; side: string | null; value: number | null }[] = [];
      let from = 0;
      const batchSize = 1000;
      
      while (true) {
        const { data, error } = await supabase
          .from('trade_history')
          .select('client_code, side, value')
          .range(from, from + batchSize - 1);
        
        if (error) throw error;
        if (!data || data.length === 0) break;
        
        allTrades = [...allTrades, ...data];
        if (data.length < batchSize) break;
        from += batchSize;
      }
      
      // Group by client_code and calculate net sell
      const grouped: Record<string, { buyValue: number; sellValue: number; netSell: number }> = {};
      allTrades.forEach(trade => {
        if (!trade.client_code) return;
        if (!grouped[trade.client_code]) {
          grouped[trade.client_code] = { buyValue: 0, sellValue: 0, netSell: 0 };
        }
        const value = Number(trade.value) || 0;
        if (trade.side === 'BUY') {
          grouped[trade.client_code].buyValue += value;
        } else if (trade.side === 'SELL') {
          grouped[trade.client_code].sellValue += value;
        }
      });
      
      // Calculate net sell for each client
      Object.keys(grouped).forEach(code => {
        grouped[code].netSell = grouped[code].sellValue - grouped[code].buyValue;
      });
      
      return grouped;
    },
  });

  // Calculate dynamic ledger for each client
  const clientsWithDynamicLedger = useMemo(() => {
    if (!clients) return [];
    
    return clients.map(client => {
      const dw = depositsWithdrawals?.[client.inv_code] || { deposits: 0, withdrawals: 0 };
      const trade = tradeSummary?.[client.inv_code] || { netSell: 0 };
      
      // Dynamic ledger = base ledger + deposits - withdrawals + net sell
      const dynamicLedger = Number(client.ledger_balance) + dw.deposits - dw.withdrawals + trade.netSell;
      
      return {
        ...client,
        dynamic_ledger: dynamicLedger,
        total_deposits: dw.deposits,
        total_withdrawals: dw.withdrawals,
        net_sell: trade.netSell,
      };
    });
  }, [clients, depositsWithdrawals, tradeSummary]);

  const rmList = useMemo(() => {
    if (!clientsWithDynamicLedger) return [];
    const rms = [...new Set(clientsWithDynamicLedger.map(c => c.rm_name))];
    return rms.sort();
  }, [clientsWithDynamicLedger]);

  const { data: agentCodes } = useAgentCodes();
  
  const agentCodesByRM = useMemo(() => {
    if (!agentCodes) return {};
    return getAgentCodesGroupedByRM(agentCodes);
  }, [agentCodes]);

  // Map employee names to their IDs for agent code lookup
  const employeeNameToId = useMemo(() => {
    const map: Record<string, string> = {};
    employees.forEach(emp => {
      map[emp.name] = emp.id;
    });
    return map;
  }, []);

  const rmSummary = useMemo(() => {
    if (!clientsWithDynamicLedger) return [];
    
    const summary: Record<string, {
      rm_name: string;
      rm_email: string | null;
      client_count: number;
      total_ledger: number;
      total_equity: number;
      total_market_value: number;
    }> = {};

    clientsWithDynamicLedger.forEach(client => {
      if (!summary[client.rm_name]) {
        summary[client.rm_name] = {
          rm_name: client.rm_name,
          rm_email: client.rm_email,
          client_count: 0,
          total_ledger: 0,
          total_equity: 0,
          total_market_value: 0,
        };
      }
      summary[client.rm_name].client_count++;
      summary[client.rm_name].total_ledger += client.dynamic_ledger;
      summary[client.rm_name].total_equity += Number(client.equity);
      summary[client.rm_name].total_market_value += Number(client.market_value);
    });

    return Object.values(summary).sort((a, b) => b.total_equity - a.total_equity);
  }, [clientsWithDynamicLedger]);

  const filteredClients = useMemo(() => {
    if (!clientsWithDynamicLedger) return [];
    
    return clientsWithDynamicLedger.filter((client) => {
      const matchesSearch = 
        client.investor_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        client.inv_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        client.rm_name.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesRM = selectedRM === "all" || client.rm_name === selectedRM;

      return matchesSearch && matchesRM;
    });
  }, [clientsWithDynamicLedger, searchQuery, selectedRM]);

  const totals = useMemo(() => {
    return filteredClients.reduce((acc, client) => ({
      ledger: acc.ledger + client.dynamic_ledger,
      equity: acc.equity + Number(client.equity),
      marketValue: acc.marketValue + Number(client.market_value),
      liabilities: acc.liabilities + Number(client.current_liabilities),
    }), { ledger: 0, equity: 0, marketValue: 0, liabilities: 0 });
  }, [filteredClients]);

  if (error) {
    return (
      <MainLayout title="Admin Balances" subtitle="Client portfolio overview">
        <div className="glass-card rounded-xl p-12 text-center">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
          <h3 className="text-lg font-medium text-foreground mb-2">Error loading data</h3>
          <p className="text-sm text-muted-foreground">{error.message}</p>
        </div>
      </MainLayout>
    );
  }

  const handleImportComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['clients'] });
  };

  return (
    <MainLayout 
      title="Admin Balances" 
      subtitle="Client portfolio overview by Relationship Manager"
    >
      {/* Header with Import Button */}
      <div className="flex justify-end mb-6">
        <ImportClientsDialog onImportComplete={handleImportComplete} />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Clients</p>
              <p className="text-2xl font-semibold text-foreground mt-1">
                {filteredClients.length}
              </p>
            </div>
            <div className="h-10 w-10 rounded-lg bg-primary/20 flex items-center justify-center">
              <Users className="h-5 w-5 text-primary" />
            </div>
          </div>
        </div>

        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Total Equity</p>
              <p className="text-2xl font-semibold text-foreground mt-1">
                {formatCurrency(totals.equity)}
              </p>
            </div>
            <div className="h-10 w-10 rounded-lg bg-success/20 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-success" />
            </div>
          </div>
        </div>

        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Market Value</p>
              <p className="text-2xl font-semibold text-foreground mt-1">
                {formatCurrency(totals.marketValue)}
              </p>
            </div>
            <div className="h-10 w-10 rounded-lg bg-accent/20 flex items-center justify-center">
              <Wallet className="h-5 w-5 text-accent" />
            </div>
          </div>
        </div>

        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Dynamic Ledger</p>
              <p className="text-2xl font-semibold text-foreground mt-1">
                {formatCurrency(totals.ledger)}
              </p>
            </div>
            <div className="h-10 w-10 rounded-lg bg-warning/20 flex items-center justify-center">
              <Wallet className="h-5 w-5 text-warning" />
            </div>
          </div>
        </div>
      </div>

      {/* RM Summary Table */}
      <div className="glass-card rounded-xl p-5 mb-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">RM Portfolio Summary</h2>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Relationship Manager</TableHead>
                <TableHead className="text-muted-foreground text-right">Clients</TableHead>
                <TableHead className="text-muted-foreground text-right">Agent Codes</TableHead>
                <TableHead className="text-muted-foreground text-right">Total Equity</TableHead>
                <TableHead className="text-muted-foreground text-right">Market Value</TableHead>
                <TableHead className="text-muted-foreground text-right">Dynamic Ledger</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rmSummary.map((rm) => {
                const rmEmployeeId = employeeNameToId[rm.rm_name];
                const rmAgentData = rmEmployeeId ? agentCodesByRM[rmEmployeeId] : null;
                const agentCount = rmAgentData ? Object.keys(rmAgentData.agents).length : 0;
                const investorCount = rmAgentData ? rmAgentData.totalInvestors : 0;

                return (
                  <TableRow key={rm.rm_name} className="border-border hover:bg-secondary/30">
                    <TableCell>
                      <div>
                        <p className="font-medium text-foreground">{rm.rm_name}</p>
                        {rm.rm_email && (
                          <p className="text-xs text-muted-foreground">{rm.rm_email}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="secondary">{rm.client_count}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {agentCount > 0 ? (
                        <Badge variant="outline" className="text-xs">
                          {agentCount} agents · {investorCount} codes
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-success font-medium">
                      {formatCurrency(rm.total_equity)}
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {formatCurrency(rm.total_market_value)}
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {formatCurrency(rm.total_ledger)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by client name, code, or RM..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-secondary border-border"
          />
        </div>
        <Select value={selectedRM} onValueChange={setSelectedRM}>
          <SelectTrigger className="w-full sm:w-[220px] bg-secondary border-border">
            <SelectValue placeholder="Filter by RM" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Relationship Managers</SelectItem>
            {rmList.map((rm) => (
              <SelectItem key={rm} value={rm}>{rm}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Client Details Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-muted-foreground">Loading client data...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border bg-secondary/50 hover:bg-secondary/50">
                  <TableHead className="text-muted-foreground">Client Code</TableHead>
                  <TableHead className="text-muted-foreground">Investor Name</TableHead>
                  <TableHead className="text-muted-foreground">RM</TableHead>
                  <TableHead className="text-muted-foreground text-right">Dynamic Ledger</TableHead>
                  <TableHead className="text-muted-foreground text-right">Market Value</TableHead>
                  <TableHead className="text-muted-foreground text-right">Equity</TableHead>
                  <TableHead className="text-muted-foreground">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.map((client) => (
                  <TableRow key={client.id} className="border-border hover:bg-secondary/30">
                    <TableCell className="font-mono text-primary">{client.inv_code}</TableCell>
                    <TableCell className="font-medium text-foreground">{client.investor_name}</TableCell>
                    <TableCell className="text-muted-foreground">{client.rm_name}</TableCell>
                    <TableCell className="text-right text-foreground">
                      {formatCurrency(client.dynamic_ledger)}
                    </TableCell>
                    <TableCell className="text-right text-foreground">
                      {formatCurrency(Number(client.market_value))}
                    </TableCell>
                    <TableCell className="text-right text-success font-medium">
                      {formatCurrency(Number(client.equity))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={client.status === 'Active' ? 'default' : 'secondary'}>
                        {client.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {!isLoading && filteredClients.length === 0 && (
          <div className="p-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">No clients found</h3>
            <p className="text-sm text-muted-foreground">Try adjusting your search or filter criteria</p>
          </div>
        )}
      </div>
    </MainLayout>
  );
};

export default AdminBalancesPage;
