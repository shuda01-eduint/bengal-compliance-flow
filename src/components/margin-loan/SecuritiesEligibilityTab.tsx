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
import { Search, RefreshCw, Edit2, Download, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface SecurityData {
  id: string;
  trading_code: string;
  sector: string | null;
  category: string | null;
  margin_category: string | null;
  is_marginable: boolean | null;
  haircut_percentage: number | null;
  free_float_mcap: number | null;
  trailing_pe: number | null;
  close_price: number | null;
  market_cap: number | null;
  updated_at: string | null;
  last_synced_at: string | null;
  eps: number | null;
  audited_pe: number | null;
}

interface EditDialogState {
  open: boolean;
  security: SecurityData | null;
  category: string;
  haircut: number;
  isMarginable: boolean;
}

export function SecuritiesEligibilityTab() {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [editDialog, setEditDialog] = useState<EditDialogState>({
    open: false,
    security: null,
    category: "B",
    haircut: 30,
    isMarginable: true,
  });
  const [syncSymbols, setSyncSymbols] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  
  const queryClient = useQueryClient();

  // Fetch securities with margin info
  const { data: securities, isLoading, refetch } = useQuery({
    queryKey: ['securities-margin', categoryFilter, searchTerm],
    queryFn: async () => {
      let query = supabase
        .from('securities')
        .select('id, trading_code, sector, category, margin_category, is_marginable, haircut_percentage, free_float_mcap, trailing_pe, close_price, market_cap, updated_at, last_synced_at, eps, audited_pe')
        .order('trading_code', { ascending: true });

      if (categoryFilter !== 'all') {
        query = query.eq('margin_category', categoryFilter);
      }
      if (searchTerm) {
        query = query.ilike('trading_code', `%${searchTerm}%`);
      }

      const { data, error } = await query.limit(200);
      if (error) throw error;
      return data || [];
    }
  });

  // Update security mutation
  const updateSecurityMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<SecurityData> }) => {
      const { error } = await supabase
        .from('securities')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['securities-margin'] });
      toast.success('Security updated successfully');
      setEditDialog(prev => ({ ...prev, open: false }));
    },
    onError: (error) => {
      toast.error(`Failed to update: ${error.message}`);
    }
  });

  // Sync from external API
  const syncFromAPI = async (symbols: string[]) => {
    if (symbols.length === 0) {
      toast.error('Please enter at least one symbol');
      return;
    }

    setIsSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-securities-master', {
        body: { action: 'sync_to_db', symbols }
      });

      if (error) throw error;

      if (data.synced?.length > 0) {
        toast.success(`Synced ${data.synced.length} securities: ${data.synced.join(', ')}`);
      }
      if (data.failed?.length > 0) {
        toast.warning(`Failed to sync: ${data.failed.map((f: any) => f.symbol).join(', ')}`);
      }

      queryClient.invalidateQueries({ queryKey: ['securities-margin'] });
      setSyncSymbols("");
    } catch (error: any) {
      toast.error(`Sync failed: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const formatCurrency = (value: number | null) => {
    if (!value) return 'N/A';
    if (value >= 10000000) return `৳${(value / 10000000).toFixed(2)} Cr`;
    if (value >= 100000) return `৳${(value / 100000).toFixed(2)} L`;
    return `৳${value.toLocaleString()}`;
  };

  const getCategoryBadge = (category: string | null) => {
    switch (category) {
      case 'A':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">A</Badge>;
      case 'B':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">B</Badge>;
      case 'Z':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Z</Badge>;
      case 'N':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">N</Badge>;
      case 'G':
        return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">G</Badge>;
      default:
        return <Badge variant="outline">-</Badge>;
    }
  };

  const getMarginableBadge = (isMarginable: boolean | null) => {
    if (isMarginable === true) {
      return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Yes</Badge>;
    }
    return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">No</Badge>;
  };

  const handleEditSave = () => {
    if (!editDialog.security) return;
    updateSecurityMutation.mutate({
      id: editDialog.security.id,
      updates: {
        margin_category: editDialog.category,
        haircut_percentage: editDialog.haircut,
        is_marginable: editDialog.isMarginable,
        updated_at: new Date().toISOString(),
      }
    });
  };

  const openEditDialog = (security: SecurityData) => {
    setEditDialog({
      open: true,
      security,
      category: security.margin_category || 'B',
      haircut: security.haircut_percentage || 30,
      isMarginable: security.is_marginable ?? true,
    });
  };

  return (
    <div className="space-y-4">
      {/* Sync from External API */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Sync from External API</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <Input
                placeholder="Enter trading codes separated by commas (e.g., ACI, SQURPHARMA, BEXIMCO)"
                value={syncSymbols}
                onChange={(e) => setSyncSymbols(e.target.value)}
                className="w-full"
              />
            </div>
            <Button
              onClick={() => {
                const symbols = syncSymbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
                syncFromAPI(symbols);
              }}
              disabled={isSyncing || !syncSymbols.trim()}
            >
              {isSyncing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 mr-2" />
                  Sync Securities
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Fetches latest market data and fundamentals from the external stock data API
          </p>
        </CardContent>
      </Card>

      {/* Filters and Actions */}
      <Card className="bg-card border-border">
        <CardContent className="pt-4">
          <div className="flex flex-col md:flex-row gap-4 justify-between">
            <div className="flex flex-col md:flex-row gap-4 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by trading code..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="A">Category A</SelectItem>
                  <SelectItem value="B">Category B</SelectItem>
                  <SelectItem value="Z">Category Z</SelectItem>
                  <SelectItem value="N">Category N</SelectItem>
                  <SelectItem value="G">Category G</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Securities Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg">
            Security Eligibility Matrix
            {securities && <span className="text-muted-foreground text-sm ml-2">({securities.length} securities)</span>}
          </CardTitle>
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
                    <TableHead>Trading Code</TableHead>
                    <TableHead>Sector</TableHead>
                    <TableHead className="text-center">Category</TableHead>
                    <TableHead className="text-center">Marginable</TableHead>
                    <TableHead className="text-right">Haircut %</TableHead>
                    <TableHead className="text-right">Market Cap</TableHead>
                    <TableHead className="text-right">P/E Ratio</TableHead>
                    <TableHead className="text-right">LTP</TableHead>
                    <TableHead>Last Synced</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {securities && securities.length > 0 ? (
                    securities.map((security) => (
                      <TableRow key={security.id}>
                        <TableCell className="font-mono font-medium">
                          {security.trading_code}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {security.sector || '-'}
                        </TableCell>
                        <TableCell className="text-center">
                          {getCategoryBadge(security.margin_category)}
                        </TableCell>
                        <TableCell className="text-center">
                          {getMarginableBadge(security.is_marginable)}
                        </TableCell>
                        <TableCell className="text-right">
                          {security.haircut_percentage ?? 30}%
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(security.market_cap || security.free_float_mcap)}
                        </TableCell>
                        <TableCell className="text-right">
                          {(security.trailing_pe || security.audited_pe)?.toFixed(2) || 'N/A'}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {security.close_price ? `৳${security.close_price.toFixed(2)}` : '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {security.last_synced_at
                            ? format(new Date(security.last_synced_at), 'dd MMM yyyy HH:mm')
                            : security.updated_at
                            ? format(new Date(security.updated_at), 'dd MMM yyyy')
                            : 'N/A'
                          }
                        </TableCell>
                        <TableCell className="text-center">
                          <Button 
                            variant="ghost" 
                            size="icon"
                            onClick={() => openEditDialog(security)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                        No securities found. Use the sync feature above to import securities from the external API.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialog.open} onOpenChange={(open) => setEditDialog(prev => ({ ...prev, open }))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Security Category</DialogTitle>
            <DialogDescription>
              Update margin eligibility for {editDialog.security?.trading_code}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select 
                value={editDialog.category} 
                onValueChange={(value) => setEditDialog(prev => ({ ...prev, category: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">Category A</SelectItem>
                  <SelectItem value="B">Category B</SelectItem>
                  <SelectItem value="Z">Category Z</SelectItem>
                  <SelectItem value="N">Category N</SelectItem>
                  <SelectItem value="G">Category G</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Haircut Percentage</Label>
              <Input
                type="number"
                value={editDialog.haircut}
                onChange={(e) => setEditDialog(prev => ({ ...prev, haircut: Number(e.target.value) }))}
                min={0}
                max={100}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="marginable"
                checked={editDialog.isMarginable}
                onChange={(e) => setEditDialog(prev => ({ ...prev, isMarginable: e.target.checked }))}
                className="rounded"
              />
              <Label htmlFor="marginable">Is Marginable</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialog(prev => ({ ...prev, open: false }))}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={updateSecurityMutation.isPending}>
              {updateSecurityMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category Legend */}
      <Card className="bg-card border-border">
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30">A</Badge>
              <span className="text-muted-foreground">Large Cap, High Liquidity (20-30% haircut)</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">B</Badge>
              <span className="text-muted-foreground">Mid Cap (35-45% haircut)</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Z</Badge>
              <span className="text-muted-foreground">Suspended/Low Quality (Not Marginable)</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-red-500/20 text-red-400 border-red-500/30">N</Badge>
              <span className="text-muted-foreground">Not Eligible</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">G</Badge>
              <span className="text-muted-foreground">Government Securities</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
