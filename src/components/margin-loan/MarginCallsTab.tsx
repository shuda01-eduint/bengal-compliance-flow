import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  CheckCircle2,
  Mail,
  MessageSquare,
  RefreshCw,
  XCircle,
  Send,
  Gavel
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function MarginCallsTab() {
  const queryClient = useQueryClient();

  // Fetch margin calls
  const { data: marginCalls, isLoading, refetch } = useQuery({
    queryKey: ['margin-calls'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('margin_calls')
        .select('*')
        .in('status', ['issued', 'acknowledged'])
        .order('call_date', { ascending: false });
      if (error) throw error;
      return data || [];
    }
  });

  // Fetch high-risk clients (below 100% margin)
  const { data: highRiskClients } = useQuery({
    queryKey: ['high-risk-clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('margin_accounts')
        .select('*')
        .lt('margin_utilization', 100)
        .eq('status', 'active')
        .order('margin_utilization', { ascending: true });
      if (error) throw error;
      return data || [];
    }
  });

  // Mark as resolved mutation
  const resolveMutation = useMutation({
    mutationFn: async (callId: string) => {
      const { error } = await supabase
        .from('margin_calls')
        .update({ 
          status: 'resolved', 
          resolved_at: new Date().toISOString() 
        })
        .eq('id', callId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Margin call marked as resolved');
      queryClient.invalidateQueries({ queryKey: ['margin-calls'] });
    },
    onError: (error) => {
      toast.error('Failed to update margin call');
      console.error(error);
    }
  });

  const formatCurrency = (value: number) => {
    if (value >= 10000000) return `৳${(value / 10000000).toFixed(2)} Cr`;
    if (value >= 100000) return `৳${(value / 100000).toFixed(2)} L`;
    return `৳${value?.toLocaleString() || 0}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'issued':
        return <Badge className="bg-red-500/20 text-red-400">Issued</Badge>;
      case 'acknowledged':
        return <Badge className="bg-yellow-500/20 text-yellow-400">Acknowledged</Badge>;
      case 'resolved':
        return <Badge className="bg-green-500/20 text-green-400">Resolved</Badge>;
      case 'forced_liquidation':
        return <Badge className="bg-purple-500/20 text-purple-400">Liquidated</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getDaysSinceCall = (callDate: string) => {
    const days = differenceInDays(new Date(), new Date(callDate));
    if (days > 3) return <span className="text-red-400 font-bold">{days} days</span>;
    if (days > 1) return <span className="text-yellow-400">{days} days</span>;
    return <span className="text-green-400">{days} days</span>;
  };

  // Mock data for demonstration
  const mockMarginCalls = [
    { 
      id: '1', 
      investor_code: 'INV003', 
      call_date: '2024-01-23', 
      margin_required: 2500000, 
      current_margin: 1800000, 
      shortfall_amount: 700000, 
      portfolio_value: 15200000,
      margin_ratio: 108,
      status: 'issued',
      sms_sent: true,
      email_sent: true,
      due_date: '2024-01-26'
    },
    { 
      id: '2', 
      investor_code: 'INV004', 
      call_date: '2024-01-22', 
      margin_required: 1800000, 
      current_margin: 1500000, 
      shortfall_amount: 300000, 
      portfolio_value: 12800000,
      margin_ratio: 115,
      status: 'acknowledged',
      sms_sent: true,
      email_sent: false,
      due_date: '2024-01-25'
    },
  ];

  const mockHighRisk = [
    { investor_code: 'INV007', margin_utilization: 95, current_exposure: 9500000, approved_limit: 10000000 },
    { investor_code: 'INV008', margin_utilization: 98, current_exposure: 4900000, approved_limit: 5000000 },
  ];

  const displayCalls = marginCalls && marginCalls.length > 0 ? marginCalls : mockMarginCalls;
  const displayHighRisk = highRiskClients && highRiskClients.length > 0 ? highRiskClients : mockHighRisk;

  return (
    <div className="space-y-6">
      {/* Active Margin Calls */}
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Active Margin Calls
            </CardTitle>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : displayCalls.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500" />
              <p>No active margin calls</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Investor</TableHead>
                    <TableHead>Call Date</TableHead>
                    <TableHead className="text-right">Required</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">Shortfall</TableHead>
                    <TableHead>Days</TableHead>
                    <TableHead className="text-center">SMS</TableHead>
                    <TableHead className="text-center">Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayCalls.map((call: any) => (
                    <TableRow key={call.id}>
                      <TableCell className="font-mono font-medium">
                        {call.investor_code}
                      </TableCell>
                      <TableCell>
                        {format(new Date(call.call_date), 'dd MMM yyyy')}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(call.margin_required)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(call.current_margin)}
                      </TableCell>
                      <TableCell className="text-right text-red-400 font-medium">
                        {formatCurrency(call.shortfall_amount)}
                      </TableCell>
                      <TableCell>{getDaysSinceCall(call.call_date)}</TableCell>
                      <TableCell className="text-center">
                        {call.sms_sent ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground mx-auto" />
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {call.email_sent ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                        ) : (
                          <XCircle className="h-4 w-4 text-muted-foreground mx-auto" />
                        )}
                      </TableCell>
                      <TableCell>{getStatusBadge(call.status)}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" title="Send Reminder">
                            <Send className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            title="Mark Resolved"
                            onClick={() => resolveMutation.mutate(call.id)}
                          >
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" title="Force Liquidate">
                                <Gavel className="h-4 w-4 text-red-500" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Force Liquidation</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to initiate forced liquidation for {call.investor_code}? 
                                  This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction className="bg-destructive text-destructive-foreground">
                                  Proceed with Liquidation
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Forced Liquidation Watchlist */}
      <Card className="bg-card border-border border-red-500/20">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Gavel className="h-5 w-5 text-red-500" />
            Forced Liquidation Watchlist
            <Badge variant="destructive" className="ml-2">
              {displayHighRisk.length} clients
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {displayHighRisk.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500" />
              <p>No clients below 100% margin ratio</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Investor Code</TableHead>
                    <TableHead className="text-right">Utilization</TableHead>
                    <TableHead className="text-right">Exposure</TableHead>
                    <TableHead className="text-right">Limit</TableHead>
                    <TableHead>Risk Level</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayHighRisk.map((client: any) => (
                    <TableRow key={client.investor_code} className="bg-red-500/5">
                      <TableCell className="font-mono font-medium">
                        {client.investor_code}
                      </TableCell>
                      <TableCell className="text-right text-red-400 font-bold">
                        {client.margin_utilization?.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(client.current_exposure)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(client.approved_limit)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="destructive" className="animate-pulse">
                          CRITICAL
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="outline" size="sm">
                            <MessageSquare className="h-4 w-4 mr-1" />
                            SMS
                          </Button>
                          <Button variant="outline" size="sm">
                            <Mail className="h-4 w-4 mr-1" />
                            Email
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
