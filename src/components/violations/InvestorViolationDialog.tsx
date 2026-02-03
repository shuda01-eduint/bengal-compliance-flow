import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { User, Building2, Wallet, Phone, Mail, History } from "lucide-react";
import { format } from "date-fns";

interface InvestorViolationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientCode: string | null;
}

export function InvestorViolationDialog({
  open,
  onOpenChange,
  clientCode,
}: InvestorViolationDialogProps) {
  // Fetch client details
  const { data: clientData, isLoading: isLoadingClient } = useQuery({
    queryKey: ["client-detail", clientCode],
    queryFn: async () => {
      if (!clientCode) return null;
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("inv_code", clientCode)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!clientCode && open,
  });

  // Fetch latest ledger snapshot for account type
  const { data: snapshotData, isLoading: isLoadingSnapshot } = useQuery({
    queryKey: ["client-snapshot", clientCode],
    queryFn: async () => {
      if (!clientCode) return null;
      const { data, error } = await supabase
        .from("eod_ledger_snapshots")
        .select("*")
        .eq("investor_code", clientCode)
        .order("eod_date", { ascending: false })
        .limit(1)
        .single();
      if (error && error.code !== "PGRST116") throw error;
      return data;
    },
    enabled: !!clientCode && open,
  });

  // Fetch recent violations history
  const { data: recentViolations, isLoading: isLoadingHistory } = useQuery({
    queryKey: ["client-violations-history", clientCode],
    queryFn: async () => {
      if (!clientCode) return [];
      const { data, error } = await supabase
        .from("eod_ledger_snapshots")
        .select("eod_date, ledger_balance, account_type")
        .eq("investor_code", clientCode)
        .lt("ledger_balance", 0)
        .order("eod_date", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
    enabled: !!clientCode && open,
  });

  const formatCurrency = (value: number | null) => {
    if (value === null) return "N/A";
    return new Intl.NumberFormat("en-BD", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const isLoading = isLoadingClient || isLoadingSnapshot;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            Investor Details
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : clientData ? (
          <div className="space-y-6">
            {/* Client Code - Large and highlighted */}
            <div className="bg-muted/50 rounded-lg p-4 text-center">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                Client Code
              </p>
              <p className="text-2xl font-bold text-primary">{clientCode}</p>
            </div>

            {/* Client Info Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" /> Client Name
                </p>
                <p className="font-medium">{clientData.investor_name}</p>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> Account Type
                </p>
                <Badge variant="outline" className="capitalize">
                  {snapshotData?.account_type || "Cash"}
                </Badge>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Wallet className="h-3 w-3" /> Current Balance
                </p>
                <p
                  className={`font-bold ${
                    (clientData.ledger_balance || 0) < 0
                      ? "text-destructive"
                      : "text-green-500"
                  }`}
                >
                  {formatCurrency(clientData.ledger_balance)}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" /> RM Name
                </p>
                <p className="font-medium">{clientData.rm_name}</p>
              </div>

              {clientData.rm_email && (
                <div className="space-y-1 col-span-2">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Mail className="h-3 w-3" /> RM Email
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {clientData.rm_email}
                  </p>
                </div>
              )}
            </div>

            {/* Additional Stats */}
            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Market Value</p>
                <p className="font-semibold text-sm">
                  {formatCurrency(clientData.market_value)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Equity</p>
                <p className="font-semibold text-sm">
                  {formatCurrency(clientData.equity)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Status</p>
                <Badge
                  variant={clientData.status === "Active" ? "default" : "secondary"}
                  className="text-xs"
                >
                  {clientData.status}
                </Badge>
              </div>
            </div>

            {/* Recent Violation History */}
            {!isLoadingHistory && recentViolations && recentViolations.length > 0 && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground flex items-center gap-1 mb-3">
                  <History className="h-3 w-3" /> Recent Negative Balance History
                </p>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {recentViolations.map((v, idx) => (
                    <div
                      key={idx}
                      className="flex justify-between items-center text-sm bg-muted/30 rounded px-3 py-2"
                    >
                      <span className="text-muted-foreground">
                        {format(new Date(v.eod_date), "dd MMM yyyy")}
                      </span>
                      <span className="text-destructive font-medium">
                        {formatCurrency(v.ledger_balance)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No investor data found for {clientCode}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
