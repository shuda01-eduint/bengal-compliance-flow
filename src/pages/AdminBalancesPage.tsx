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
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('rm_name', { ascending: true });
      
      if (error) throw error;
      return data;
    },
  });

  const rmList = useMemo(() => {
    if (!clients) return [];
    const rms = [...new Set(clients.map(c => c.rm_name))];
    return rms.sort();
  }, [clients]);

  const rmSummary = useMemo(() => {
    if (!clients) return [];
    
    const summary: Record<string, {
      rm_name: string;
      rm_email: string | null;
      client_count: number;
      total_ledger: number;
      total_equity: number;
      total_market_value: number;
    }> = {};

    clients.forEach(client => {
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
      summary[client.rm_name].total_ledger += Number(client.ledger_balance);
      summary[client.rm_name].total_equity += Number(client.equity);
      summary[client.rm_name].total_market_value += Number(client.market_value);
    });

    return Object.values(summary).sort((a, b) => b.total_equity - a.total_equity);
  }, [clients]);

  const filteredClients = useMemo(() => {
    if (!clients) return [];
    
    return clients.filter((client) => {
      const matchesSearch = 
        client.investor_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        client.inv_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        client.rm_name.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesRM = selectedRM === "all" || client.rm_name === selectedRM;

      return matchesSearch && matchesRM;
    });
  }, [clients, searchQuery, selectedRM]);

  const totals = useMemo(() => {
    return filteredClients.reduce((acc, client) => ({
      ledger: acc.ledger + Number(client.ledger_balance),
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
              <p className="text-sm text-muted-foreground">Ledger Balance</p>
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
                <TableHead className="text-muted-foreground text-right">Total Equity</TableHead>
                <TableHead className="text-muted-foreground text-right">Market Value</TableHead>
                <TableHead className="text-muted-foreground text-right">Ledger Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rmSummary.map((rm) => (
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
              ))}
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
                  <TableHead className="text-muted-foreground text-right">Ledger Balance</TableHead>
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
                      {formatCurrency(Number(client.ledger_balance))}
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
