import { useState, useMemo } from "react";
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
import { Search, Eye, RefreshCw, Users, TrendingUp, Wallet, ArrowUpDown, Calendar } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientDetailSheet } from "./ClientDetailSheet";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";

const STATUS_OPTIONS = [
  { value: "all", label: "All Status" },
  { value: "active", label: "Active" },
  { value: "negative_equity", label: "Negative Equity" },
  { value: "critical", label: "Critical" },
  { value: "suspended", label: "Suspended" },
];

export function ClientAccountsTab() {
  const [searchTerm, setSearchTerm] = useState("");
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>("all");
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["all"]);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<Date | undefined>(subDays(new Date(), 30));
  const [endDate, setEndDate] = useState<Date | undefined>(new Date());

  // Fetch paginated data for the table
  const { data: accounts, isLoading, refetch } = useQuery({
    queryKey: ['margin-client-accounts', selectedStatuses, accountTypeFilter, searchTerm],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_margin_client_accounts', {
        p_search: searchTerm,
        p_account_type: accountTypeFilter,
        p_statuses: selectedStatuses.includes("all") ? ["all"] : selectedStatuses,
        p_limit: 10000,
        p_offset: 0
      });
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch summary metrics (totals across ALL data, not just paginated)
  const { data: summary, isLoading: isSummaryLoading } = useQuery({
    queryKey: ['margin-client-summary', selectedStatuses, accountTypeFilter, searchTerm],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_margin_client_summary', {
        p_search: searchTerm,
        p_account_type: accountTypeFilter,
        p_statuses: selectedStatuses.includes("all") ? ["all"] : selectedStatuses,
      });
      if (error) throw error;
      return data?.[0] || null;
    }
  });

  // Use summary data for metric cards (shows TOTAL counts, not paginated)
  const metrics = useMemo(() => {
    if (!summary) {
      return {
        accountCount: 0,
        totalMarginOutstanding: 0,
        totalEquity: 0,
        loanChange: 0
      };
    }

    return {
      accountCount: Number(summary.total_accounts) || 0,
      totalMarginOutstanding: Number(summary.total_margin_outstanding) || 0,
      totalEquity: Number(summary.total_equity) || 0,
      loanChange: 0 // TODO: Implement with date range query
    };
  }, [summary]);

  const formatCurrency = (value: number) => {
    const absValue = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (absValue >= 10000000) return `${sign}৳${(absValue / 10000000).toFixed(2)} Cr`;
    if (absValue >= 100000) return `${sign}৳${(absValue / 100000).toFixed(2)} L`;
    return `${sign}৳${absValue.toLocaleString()}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'negative_equity':
        return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">Negative Equity</Badge>;
      case 'critical':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Critical</Badge>;
      case 'suspended':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Suspended</Badge>;
      case 'active':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Active</Badge>;
      case 'closed':
        return <Badge className="bg-gray-500/20 text-gray-400 border-gray-500/30">Closed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getUtilizationColor = (utilization: number) => {
    if (utilization >= 90) return "text-red-400";
    if (utilization >= 70) return "text-yellow-400";
    return "text-green-400";
  };

  const handleStatusChange = (status: string, checked: boolean) => {
    if (status === "all") {
      setSelectedStatuses(checked ? ["all"] : []);
    } else {
      let newStatuses = selectedStatuses.filter(s => s !== "all");
      if (checked) {
        newStatuses.push(status);
      } else {
        newStatuses = newStatuses.filter(s => s !== status);
      }
      // If no specific statuses selected, default to "all"
      setSelectedStatuses(newStatuses.length === 0 ? ["all"] : newStatuses);
    }
  };

  const getSelectedStatusLabel = () => {
    if (selectedStatuses.includes("all") || selectedStatuses.length === 0) {
      return "All Status";
    }
    if (selectedStatuses.length === 1) {
      return STATUS_OPTIONS.find(s => s.value === selectedStatuses[0])?.label || "1 selected";
    }
    return `${selectedStatuses.length} selected`;
  };

  return (
    <div className="space-y-4">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2 bg-primary/10">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">No. of Accounts</p>
                <p className="text-2xl font-semibold">{metrics.accountCount.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2 bg-destructive/10">
                <TrendingUp className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Margin Outstanding</p>
                <p className="text-2xl font-semibold">{formatCurrency(metrics.totalMarginOutstanding)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className={cn("rounded-lg p-2", metrics.totalEquity >= 0 ? "bg-green-500/10" : "bg-red-500/10")}>
                <Wallet className={cn("h-5 w-5", metrics.totalEquity >= 0 ? "text-green-500" : "text-red-500")} />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Equity</p>
                <p className={cn("text-2xl font-semibold", metrics.totalEquity < 0 && "text-red-400")}>
                  {formatCurrency(metrics.totalEquity)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2 bg-blue-500/10">
                <ArrowUpDown className="h-5 w-5 text-blue-500" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">Loan Change (Period)</p>
                <div className="flex items-center gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 text-xs">
                        <Calendar className="h-3 w-3 mr-1" />
                        {startDate ? format(startDate, "MMM d") : "Start"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={startDate}
                        onSelect={setStartDate}
                        initialFocus
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                  <span className="text-xs text-muted-foreground">to</span>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 text-xs">
                        <Calendar className="h-3 w-3 mr-1" />
                        {endDate ? format(endDate, "MMM d") : "End"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={endDate}
                        onSelect={setEndDate}
                        initialFocus
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <p className="text-lg font-semibold text-muted-foreground mt-1">
                  {formatCurrency(metrics.loanChange)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

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
            
            {/* Multi-select Status Filter */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-[180px] justify-between">
                  {getSelectedStatusLabel()}
                  <span className="ml-2 text-xs text-muted-foreground">▼</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[200px] p-2" align="start">
                <div className="space-y-2">
                  {STATUS_OPTIONS.map((option) => (
                    <div key={option.value} className="flex items-center space-x-2">
                      <Checkbox
                        id={`status-${option.value}`}
                        checked={
                          option.value === "all" 
                            ? selectedStatuses.includes("all") 
                            : selectedStatuses.includes(option.value)
                        }
                        onCheckedChange={(checked) => 
                          handleStatusChange(option.value, checked as boolean)
                        }
                      />
                      <label 
                        htmlFor={`status-${option.value}`}
                        className="text-sm cursor-pointer flex-1"
                      >
                        {option.label}
                      </label>
                    </div>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

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
                    <TableHead>Investor Name</TableHead>
                    <TableHead>RM Name</TableHead>
                    <TableHead className="text-right">Margin Loan</TableHead>
                    <TableHead className="text-right">Accrued Interest</TableHead>
                    <TableHead className="text-right">Portfolio Value</TableHead>
                    <TableHead className="text-right">Equity</TableHead>
                    <TableHead className="text-right">Margin Ratio %</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts && accounts.length > 0 ? accounts.map((account: any) => (
                    <TableRow key={account.investor_code}>
                      <TableCell className="font-mono font-medium">
                        {account.investor_code}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {account.investor_name || '-'}
                      </TableCell>
                      <TableCell className="max-w-[150px] truncate">
                        {account.rm_name || '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(account.current_exposure || 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(account.accrued_interest || 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(account.portfolio_value || 0)}
                      </TableCell>
                      <TableCell className={`text-right font-medium ${(account.equity || 0) < 0 ? 'text-red-400' : ''}`}>
                        {formatCurrency(account.equity || 0)}
                      </TableCell>
                      <TableCell className={`text-right font-medium ${getUtilizationColor(Math.abs(account.margin_ratio || 0))}`}>
                        {(account.margin_ratio || 0).toFixed(2)}%
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
                  )) : (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                        No margin accounts found
                      </TableCell>
                    </TableRow>
                  )}
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
