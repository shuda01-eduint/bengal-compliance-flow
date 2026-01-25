import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

interface ClientDetailSheetProps {
  investorCode: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CATEGORY_COLORS: Record<string, string> = {
  A: "#10b981",
  B: "#3b82f6",
  Z: "#f59e0b",
  N: "#ef4444",
  Cash: "#8b5cf6"
};

export function ClientDetailSheet({ investorCode, open, onOpenChange }: ClientDetailSheetProps) {
  // Fetch investor details
  const { data: investor, isLoading: loadingInvestor } = useQuery({
    queryKey: ['investor-detail', investorCode],
    queryFn: async () => {
      if (!investorCode) return null;
      const { data, error } = await supabase
        .from('investors')
        .select('*')
        .eq('investor_code', investorCode)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!investorCode
  });

  // Fetch margin account
  const { data: marginAccount, isLoading: loadingAccount } = useQuery({
    queryKey: ['margin-account-detail', investorCode],
    queryFn: async () => {
      if (!investorCode) return null;
      const { data, error } = await supabase
        .from('margin_accounts')
        .select('*')
        .eq('investor_code', investorCode)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!investorCode
  });

  // Fetch collateral holdings
  const { data: collateral, isLoading: loadingCollateral } = useQuery({
    queryKey: ['margin-collateral', investorCode],
    queryFn: async () => {
      if (!investorCode) return [];
      const { data, error } = await supabase
        .from('margin_collateral')
        .select('*')
        .eq('investor_code', investorCode)
        .order('collateral_value', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!investorCode
  });

  // Fetch transactions
  const { data: transactions, isLoading: loadingTx } = useQuery({
    queryKey: ['margin-transactions', investorCode],
    queryFn: async () => {
      if (!investorCode) return [];
      const { data, error } = await supabase
        .from('margin_transactions')
        .select('*')
        .eq('investor_code', investorCode)
        .order('transaction_date', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!investorCode
  });

  // Fetch agreement
  const { data: agreement, isLoading: loadingAgreement } = useQuery({
    queryKey: ['margin-agreement', investorCode],
    queryFn: async () => {
      if (!investorCode) return null;
      const { data, error } = await supabase
        .from('margin_agreements')
        .select('*')
        .eq('investor_code', investorCode)
        .eq('status', 'active')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!investorCode
  });

  const formatCurrency = (value: number) => {
    if (value >= 10000000) return `৳${(value / 10000000).toFixed(2)} Cr`;
    if (value >= 100000) return `৳${(value / 100000).toFixed(2)} L`;
    return `৳${value?.toLocaleString() || 0}`;
  };

  // Mock portfolio composition for chart
  const mockPortfolioData = [
    { name: "Category A", value: 45, color: CATEGORY_COLORS.A },
    { name: "Category B", value: 30, color: CATEGORY_COLORS.B },
    { name: "Category Z", value: 15, color: CATEGORY_COLORS.Z },
    { name: "Cash", value: 10, color: CATEGORY_COLORS.Cash }
  ];

  const isLoading = loadingInvestor || loadingAccount;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Client Details
            {investorCode && (
              <Badge variant="outline" className="font-mono">
                {investorCode}
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            {investor?.investor_name || "Loading..."}
          </SheetDescription>
        </SheetHeader>

        {isLoading ? (
          <div className="space-y-4 mt-6">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <Tabs defaultValue="summary" className="mt-6">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="portfolio">Portfolio</TabsTrigger>
              <TabsTrigger value="collateral">Collateral</TabsTrigger>
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
              <TabsTrigger value="agreement">Agreement</TabsTrigger>
            </TabsList>

            <TabsContent value="summary" className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    <p className="text-sm text-muted-foreground">Approved Limit</p>
                    <p className="text-xl font-bold">
                      {formatCurrency(marginAccount?.approved_limit || 0)}
                    </p>
                  </CardContent>
                </Card>
                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    <p className="text-sm text-muted-foreground">Current Exposure</p>
                    <p className="text-xl font-bold">
                      {formatCurrency(marginAccount?.current_exposure || 0)}
                    </p>
                  </CardContent>
                </Card>
                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    <p className="text-sm text-muted-foreground">Utilization</p>
                    <p className="text-xl font-bold">
                      {marginAccount?.margin_utilization?.toFixed(2) || 0}%
                    </p>
                  </CardContent>
                </Card>
                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    <p className="text-sm text-muted-foreground">Status</p>
                    <Badge className={
                      marginAccount?.status === 'active' 
                        ? "bg-green-500/20 text-green-400 mt-1" 
                        : "bg-yellow-500/20 text-yellow-400 mt-1"
                    }>
                      {marginAccount?.status || 'N/A'}
                    </Badge>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Investor Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Account Type</span>
                    <span className="capitalize">{investor?.account_type || 'Margin'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Interest Rate</span>
                    <span>{investor?.interest_rate || 15}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">RM Name</span>
                    <span>{investor?.rm_name || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Email</span>
                    <span>{investor?.email || 'N/A'}</span>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="portfolio" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Portfolio Composition</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[250px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={mockPortfolioData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {mockPortfolioData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="collateral" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Collateral Holdings</CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingCollateral ? (
                    <Skeleton className="h-32 w-full" />
                  ) : collateral && collateral.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Security</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Value</TableHead>
                          <TableHead className="text-right">Haircut</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {collateral.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-mono">{item.trading_code}</TableCell>
                            <TableCell className="text-right">{item.quantity}</TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(item.collateral_value || 0)}
                            </TableCell>
                            <TableCell className="text-right">{item.haircut_percentage}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">
                      No collateral holdings found
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="transactions" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Transaction History</CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingTx ? (
                    <Skeleton className="h-32 w-full" />
                  ) : transactions && transactions.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {transactions.map((tx) => (
                          <TableRow key={tx.id}>
                            <TableCell>
                              {format(new Date(tx.transaction_date), 'dd MMM yyyy')}
                            </TableCell>
                            <TableCell className="capitalize">
                              <Badge variant={
                                tx.transaction_type === 'disbursement' 
                                  ? 'default' 
                                  : tx.transaction_type === 'repayment' 
                                    ? 'outline' 
                                    : 'secondary'
                              }>
                                {tx.transaction_type}
                              </Badge>
                            </TableCell>
                            <TableCell className={`text-right ${
                              tx.transaction_type === 'repayment' ? 'text-green-400' : ''
                            }`}>
                              {formatCurrency(tx.amount)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(tx.outstanding_balance || 0)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">
                      No transactions found
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="agreement" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Agreement Details</CardTitle>
                </CardHeader>
                <CardContent>
                  {loadingAgreement ? (
                    <Skeleton className="h-32 w-full" />
                  ) : agreement ? (
                    <div className="space-y-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Agreement Number</span>
                        <span className="font-mono">{agreement.agreement_number}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Agreement Date</span>
                        <span>{format(new Date(agreement.agreement_date), 'dd MMM yyyy')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Approved Limit</span>
                        <span>{formatCurrency(agreement.approved_limit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Interest Rate</span>
                        <span>{agreement.interest_rate}%</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Tenure</span>
                        <span>{agreement.tenure_months} months</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Status</span>
                        <Badge className="bg-green-500/20 text-green-400">
                          {agreement.status}
                        </Badge>
                      </div>
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-8">
                      No active agreement found
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
