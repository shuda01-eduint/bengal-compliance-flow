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
import { Search, RefreshCw, Edit2, Upload } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
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

export function SecuritiesEligibilityTab() {
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Fetch securities with margin info
  const { data: securities, isLoading, refetch } = useQuery({
    queryKey: ['securities-margin', categoryFilter, searchTerm],
    queryFn: async () => {
      let query = supabase
        .from('securities')
        .select('*')
        .order('trading_code', { ascending: true });

      if (categoryFilter !== 'all') {
        query = query.eq('margin_category', categoryFilter);
      }
      if (searchTerm) {
        query = query.ilike('trading_code', `%${searchTerm}%`);
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data || [];
    }
  });

  // Also fetch from security_margin_categories for more detailed info
  const { data: marginCategories } = useQuery({
    queryKey: ['security-margin-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('security_margin_categories')
        .select('*');
      if (error) throw error;
      return data || [];
    }
  });

  const formatCurrency = (value: number | null) => {
    if (!value) return 'N/A';
    if (value >= 10000000) return `৳${(value / 10000000).toFixed(2)} Cr`;
    if (value >= 100000) return `৳${(value / 100000).toFixed(2)} L`;
    return `৳${value.toLocaleString()}`;
  };

  const getCategoryBadge = (category: string | null) => {
    switch (category) {
      case 'A':
        return <Badge className="bg-green-500/20 text-green-400">A</Badge>;
      case 'B':
        return <Badge className="bg-blue-500/20 text-blue-400">B</Badge>;
      case 'Z':
        return <Badge className="bg-yellow-500/20 text-yellow-400">Z</Badge>;
      case 'N':
        return <Badge className="bg-red-500/20 text-red-400">N</Badge>;
      case 'G':
        return <Badge className="bg-purple-500/20 text-purple-400">G</Badge>;
      default:
        return <Badge variant="outline">-</Badge>;
    }
  };

  const getMarginableBadge = (isMarginable: boolean | null) => {
    if (isMarginable === true) {
      return <Badge className="bg-green-500/20 text-green-400">Yes</Badge>;
    }
    return <Badge className="bg-red-500/20 text-red-400">No</Badge>;
  };

  // Mock data for demonstration
  const mockSecurities = [
    { id: '1', trading_code: 'BEXIMCO', margin_category: 'A', is_marginable: true, haircut_percentage: 30, free_float_mcap: 25000000000, trailing_pe: 12.5, updated_at: '2024-01-20' },
    { id: '2', trading_code: 'SQURPHARMA', margin_category: 'A', is_marginable: true, haircut_percentage: 25, free_float_mcap: 45000000000, trailing_pe: 18.2, updated_at: '2024-01-20' },
    { id: '3', trading_code: 'BRAC BANK', margin_category: 'A', is_marginable: true, haircut_percentage: 30, free_float_mcap: 32000000000, trailing_pe: 8.5, updated_at: '2024-01-20' },
    { id: '4', trading_code: 'RENATA', margin_category: 'B', is_marginable: true, haircut_percentage: 40, free_float_mcap: 15000000000, trailing_pe: 22.1, updated_at: '2024-01-19' },
    { id: '5', trading_code: 'ZENITEX', margin_category: 'Z', is_marginable: false, haircut_percentage: 100, free_float_mcap: 500000000, trailing_pe: -5.2, updated_at: '2024-01-18' },
  ];

  const displayData = securities && securities.length > 0 ? securities : mockSecurities;

  return (
    <div className="space-y-4">
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
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button variant="outline">
                <Upload className="h-4 w-4 mr-2" />
                Bulk Update
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Securities Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg">Security Eligibility Matrix</CardTitle>
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
                    <TableHead className="text-center">Category</TableHead>
                    <TableHead className="text-center">Marginable</TableHead>
                    <TableHead className="text-right">Haircut %</TableHead>
                    <TableHead className="text-right">Free Float MCap</TableHead>
                    <TableHead className="text-right">Trailing PE</TableHead>
                    <TableHead>Last Check</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayData.map((security: any) => (
                    <TableRow key={security.id}>
                      <TableCell className="font-mono font-medium">
                        {security.trading_code}
                      </TableCell>
                      <TableCell className="text-center">
                        {getCategoryBadge(security.margin_category)}
                      </TableCell>
                      <TableCell className="text-center">
                        {getMarginableBadge(security.is_marginable)}
                      </TableCell>
                      <TableCell className="text-right">
                        {security.haircut_percentage || 30}%
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(security.free_float_mcap)}
                      </TableCell>
                      <TableCell className="text-right">
                        {security.trailing_pe?.toFixed(2) || 'N/A'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {security.updated_at 
                          ? format(new Date(security.updated_at), 'dd MMM yyyy')
                          : 'N/A'
                        }
                      </TableCell>
                      <TableCell className="text-center">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Edit Security Category</DialogTitle>
                              <DialogDescription>
                                Update margin eligibility for {security.trading_code}
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <div className="space-y-2">
                                <Label>Category</Label>
                                <Select defaultValue={security.margin_category || 'B'}>
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
                                  defaultValue={security.haircut_percentage || 30}
                                  min={0}
                                  max={100}
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <input 
                                  type="checkbox" 
                                  id="marginable" 
                                  defaultChecked={security.is_marginable}
                                  className="rounded"
                                />
                                <Label htmlFor="marginable">Is Marginable</Label>
                              </div>
                            </div>
                            <DialogFooter>
                              <Button variant="outline">Cancel</Button>
                              <Button>Save Changes</Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Category Legend */}
      <Card className="bg-card border-border">
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Badge className="bg-green-500/20 text-green-400">A</Badge>
              <span className="text-muted-foreground">Large Cap, High Liquidity (20-30% haircut)</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-blue-500/20 text-blue-400">B</Badge>
              <span className="text-muted-foreground">Mid Cap (35-45% haircut)</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-yellow-500/20 text-yellow-400">Z</Badge>
              <span className="text-muted-foreground">Suspended/Low Quality (Not Marginable)</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-red-500/20 text-red-400">N</Badge>
              <span className="text-muted-foreground">Not Eligible</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-purple-500/20 text-purple-400">G</Badge>
              <span className="text-muted-foreground">Government Securities</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
