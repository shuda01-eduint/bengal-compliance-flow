import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Search, Filter, Eye, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDetailSheet } from "./ClientDetailSheet";

export function ClientAccountsTab() {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>("all");
  const [selectedClient, setSelectedClient] = useState<string | null>(null);

  const { data: accounts, isLoading, refetch } = useQuery({
    queryKey: ['margin-accounts', statusFilter, accountTypeFilter, searchTerm],
    queryFn: async () => {
      let query = supabase
        .from('margin_accounts')
        .select('*')
        .order('current_exposure', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }
      if (accountTypeFilter !== 'all') {
        query = query.eq('account_type', accountTypeFilter);
      }
      if (searchTerm) {
        query = query.ilike('investor_code', `%${searchTerm}%`);
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data || [];
    }
  });

  const formatCurrency = (value: number) => {
    if (value >= 10000000) return `৳${(value / 10000000).toFixed(2)} Cr`;
    if (value >= 100000) return `৳${(value / 100000).toFixed(2)} L`;
    return `৳${value.toLocaleString()}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-500/20 text-green-400">Active</Badge>;
      case 'suspended':
        return <Badge className="bg-yellow-500/20 text-yellow-400">Suspended</Badge>;
      case 'closed':
        return <Badge className="bg-gray-500/20 text-gray-400">Closed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getUtilizationColor = (utilization: number) => {
    if (utilization >= 90) return "text-red-400";
    if (utilization >= 70) return "text-yellow-400";
    return "text-green-400";
  };

  // Mock data for demonstration
  const mockAccounts = [
    { investor_code: "INV001", account_type: "margin", approved_limit: 30000000, current_exposure: 25000000, margin_utilization: 83.33, status: "active" },
    { investor_code: "INV002", account_type: "margin", approved_limit: 25000000, current_exposure: 18500000, margin_utilization: 74.00, status: "active" },
    { investor_code: "INV003", account_type: "margin", approved_limit: 20000000, current_exposure: 19000000, margin_utilization: 95.00, status: "active" },
    { investor_code: "INV004", account_type: "margin", approved_limit: 15000000, current_exposure: 12800000, margin_utilization: 85.33, status: "suspended" },
    { investor_code: "INV005", account_type: "cash", approved_limit: 12000000, current_exposure: 10500000, margin_utilization: 87.50, status: "active" },
  ];

  const displayData = accounts && accounts.length > 0 ? accounts : mockAccounts;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="bg-card border-border">
        <CardContent className="pt-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by investor code..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={accountTypeFilter} onValueChange={setAccountTypeFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Account Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="margin">Margin</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg">Client Margin Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Investor Code</TableHead>
                    <TableHead>Account Type</TableHead>
                    <TableHead className="text-right">Approved Limit</TableHead>
                    <TableHead className="text-right">Current Exposure</TableHead>
                    <TableHead className="text-right">Utilization %</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayData.map((account) => (
                    <TableRow key={account.investor_code}>
                      <TableCell className="font-mono font-medium">
                        {account.investor_code}
                      </TableCell>
                      <TableCell className="capitalize">{account.account_type}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(account.approved_limit || 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(account.current_exposure || 0)}
                      </TableCell>
                      <TableCell className={`text-right font-medium ${getUtilizationColor(account.margin_utilization || 0)}`}>
                        {(account.margin_utilization || 0).toFixed(2)}%
                      </TableCell>
                      <TableCell>{getStatusBadge(account.status || 'active')}</TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedClient(account.investor_code)}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Client Detail Sheet */}
      <ClientDetailSheet
        investorCode={selectedClient}
        open={!!selectedClient}
        onOpenChange={(open) => !open && setSelectedClient(null)}
      />
    </div>
  );
}
