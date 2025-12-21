import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Calendar, Hash, Clock, ArrowDownToLine, ArrowUpFromLine, Play, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

interface FileUploadStats {
  file_name: string;
  record_count: number;
  unique_clients: number;
  total_value: number;
  first_upload: string;
  last_upload: string;
}

interface DepositImportStats {
  transaction_date: string;
  deposit_count: number;
  withdrawal_count: number;
  total_deposits: number;
  total_withdrawals: number;
  first_upload: string;
  last_upload: string;
}

interface EodRunHistory {
  id: string;
  run_date: string;
  run_at: string;
  run_by_email: string | null;
  clients_captured: number;
  total_ledger_balance: number;
  trade_files_count: number;
  deposit_records_count: number;
  total_deposits: number;
  total_withdrawals: number;
  status: string;
  notes: string | null;
}

export const UploadHistoryTable = () => {
  // Trade file upload history
  const { data: uploadHistory, isLoading: loadingTrades } = useQuery({
    queryKey: ["upload-history"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_trade_file_stats');
      if (error) throw error;
      return (data || []) as FileUploadStats[];
    },
  });

  // Deposit/Withdrawal import history
  const { data: depositHistory, isLoading: loadingDeposits } = useQuery({
    queryKey: ["deposit-import-history"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_deposit_import_stats');
      if (error) throw error;
      return (data || []) as DepositImportStats[];
    },
  });

  // EOD run history
  const { data: eodHistory, isLoading: loadingEod } = useQuery({
    queryKey: ["eod-run-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eod_run_history")
        .select("*")
        .order("run_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as EodRunHistory[];
    },
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-BD", {
      style: "currency",
      currency: "BDT",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDateTime = (dateStr: string) => {
    return format(new Date(dateStr), "dd MMM yyyy, HH:mm");
  };

  const formatDate = (dateStr: string) => {
    return format(new Date(dateStr), "dd MMM yyyy");
  };

  const extractDateFromFilename = (filename: string) => {
    const match = filename.match(/^(\d{8})/);
    if (match) {
      const dateStr = match[1];
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      return `${day}/${month}/${year}`;
    }
    return null;
  };

  const isLoading = loadingTrades || loadingDeposits || loadingEod;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Upload & EOD History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Upload & EOD History
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="trades" className="space-y-4">
          <TabsList>
            <TabsTrigger value="trades" className="gap-2">
              <FileText className="h-4 w-4" />
              Trade Files
              <Badge variant="secondary" className="ml-1">{uploadHistory?.length || 0}</Badge>
            </TabsTrigger>
            <TabsTrigger value="deposits" className="gap-2">
              <ArrowDownToLine className="h-4 w-4" />
              Deposits/Withdrawals
              <Badge variant="secondary" className="ml-1">{depositHistory?.length || 0}</Badge>
            </TabsTrigger>
            <TabsTrigger value="eod" className="gap-2">
              <Play className="h-4 w-4" />
              EOD Runs
              <Badge variant="secondary" className="ml-1">{eodHistory?.length || 0}</Badge>
            </TabsTrigger>
          </TabsList>

          {/* Trade Files History */}
          <TabsContent value="trades">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File Name</TableHead>
                    <TableHead className="text-center">Trade Date</TableHead>
                    <TableHead className="text-right">Records</TableHead>
                    <TableHead className="text-right">Unique Clients</TableHead>
                    <TableHead className="text-right">Total Value</TableHead>
                    <TableHead>First Upload</TableHead>
                    <TableHead>Last Upload</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploadHistory?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No trade file uploads found
                      </TableCell>
                    </TableRow>
                  ) : (
                    uploadHistory?.map((file) => (
                      <TableRow key={file.file_name}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="truncate max-w-[300px]" title={file.file_name}>
                              {file.file_name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline">
                            <Calendar className="h-3 w-3 mr-1" />
                            {extractDateFromFilename(file.file_name) || "N/A"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Hash className="h-3 w-3 text-muted-foreground" />
                            {file.record_count.toLocaleString()}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {file.unique_clients.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(file.total_value)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDateTime(file.first_upload)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDateTime(file.last_upload)}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {uploadHistory && uploadHistory.length > 0 && (
              <div className="mt-4 flex gap-4 text-sm text-muted-foreground">
                <div>
                  Total Records: <span className="font-medium text-foreground">
                    {uploadHistory.reduce((sum, f) => sum + f.record_count, 0).toLocaleString()}
                  </span>
                </div>
                <div>
                  Total Value: <span className="font-medium text-foreground">
                    {formatCurrency(uploadHistory.reduce((sum, f) => sum + f.total_value, 0))}
                  </span>
                </div>
              </div>
            )}
          </TabsContent>

          {/* Deposits/Withdrawals History */}
          <TabsContent value="deposits">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction Date</TableHead>
                    <TableHead className="text-right">Deposits</TableHead>
                    <TableHead className="text-right">Withdrawals</TableHead>
                    <TableHead className="text-right">Total Deposits</TableHead>
                    <TableHead className="text-right">Total Withdrawals</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Last Upload</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {depositHistory?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No deposit/withdrawal imports found
                      </TableCell>
                    </TableRow>
                  ) : (
                    depositHistory?.map((row) => (
                      <TableRow key={row.transaction_date}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            {formatDate(row.transaction_date)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="bg-green-500/10 text-green-600">
                            <ArrowDownToLine className="h-3 w-3 mr-1" />
                            {row.deposit_count}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-600">
                            <ArrowUpFromLine className="h-3 w-3 mr-1" />
                            {row.withdrawal_count}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-green-600">
                          {formatCurrency(row.total_deposits)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-amber-600">
                          {formatCurrency(row.total_withdrawals)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(row.total_deposits - row.total_withdrawals)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDateTime(row.last_upload)}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {depositHistory && depositHistory.length > 0 && (
              <div className="mt-4 flex gap-4 text-sm text-muted-foreground">
                <div>
                  Total Deposits: <span className="font-medium text-green-600">
                    {formatCurrency(depositHistory.reduce((sum, r) => sum + Number(r.total_deposits), 0))}
                  </span>
                </div>
                <div>
                  Total Withdrawals: <span className="font-medium text-amber-600">
                    {formatCurrency(depositHistory.reduce((sum, r) => sum + Number(r.total_withdrawals), 0))}
                  </span>
                </div>
              </div>
            )}
          </TabsContent>

          {/* EOD Run History */}
          <TabsContent value="eod">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>EOD Date</TableHead>
                    <TableHead>Run At</TableHead>
                    <TableHead>Run By</TableHead>
                    <TableHead className="text-right">Clients</TableHead>
                    <TableHead className="text-right">Ledger Balance</TableHead>
                    <TableHead className="text-right">Trade Files</TableHead>
                    <TableHead className="text-right">Dep/Wd Records</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {eodHistory?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        No EOD runs found. Run EOD from the Deposits/Withdrawals tab.
                      </TableCell>
                    </TableRow>
                  ) : (
                    eodHistory?.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <Play className="h-4 w-4 text-primary" />
                            {formatDate(run.run_date)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDateTime(run.run_at)}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {run.run_by_email || "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {run.clients_captured.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {formatCurrency(run.total_ledger_balance)}
                        </TableCell>
                        <TableCell className="text-right">
                          {run.trade_files_count}
                        </TableCell>
                        <TableCell className="text-right">
                          {run.deposit_records_count}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={run.status === 'completed' ? 'default' : 'destructive'} className="gap-1">
                            {run.status === 'completed' && <CheckCircle2 className="h-3 w-3" />}
                            {run.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {eodHistory && eodHistory.length > 0 && (
              <div className="mt-4 flex gap-4 text-sm text-muted-foreground">
                <div>
                  Total EOD Runs: <span className="font-medium text-foreground">
                    {eodHistory.length}
                  </span>
                </div>
                <div>
                  Latest Run: <span className="font-medium text-foreground">
                    {eodHistory[0] ? formatDate(eodHistory[0].run_date) : 'N/A'}
                  </span>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};