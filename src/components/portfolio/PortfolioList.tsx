import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Trash2, Eye, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { PortfolioDetailDialog } from "./PortfolioDetailDialog";

interface Portfolio {
  id: string;
  name: string;
  description: string | null;
  investor_code: string;
  created_at: string;
}

interface ClientData {
  inv_code: string;
  investor_name: string;
  rm_name: string;
  ledger_balance: number;
  market_value: number;
  accrued_interest: number;
  equity: number;
}

interface PortfolioWithClient extends Portfolio {
  client: ClientData | null;
  costValue: number;
}

interface CustomField {
  id: string;
  field_name: string;
  field_type: string;
  options: string[];
}

const PAGE_SIZE = 50;

export function PortfolioList() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
  const [newPortfolio, setNewPortfolio] = useState({
    name: "",
    description: "",
    investor_code: ""
  });
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  // Debounce search
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
    setTimeout(() => setDebouncedSearch(value), 300);
  };

  // Fetch total count for pagination
  const { data: totalCount = 0 } = useQuery({
    queryKey: ["portfolios-count", debouncedSearch],
    queryFn: async () => {
      let query = supabase.from("portfolios").select("id", { count: "exact", head: true });
      
      if (debouncedSearch) {
        query = query.or(`investor_code.eq.${debouncedSearch},name.ilike.%${debouncedSearch}%`);
      }
      
      const { count, error } = await query;
      if (error) throw error;
      return count || 0;
    }
  });

  // Fetch portfolios with server-side pagination and filtering
  const { data: portfolios = [], isLoading } = useQuery({
    queryKey: ["portfolios-with-clients", debouncedSearch, currentPage],
    queryFn: async () => {
      const from = (currentPage - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      let query = supabase
        .from("portfolios")
        .select("*")
        .order("investor_code", { ascending: true })
        .range(from, to);
      
      if (debouncedSearch) {
        query = query.or(`investor_code.eq.${debouncedSearch},name.ilike.%${debouncedSearch}%`);
      }

      const { data: portfolioData, error: portfolioError } = await query;
      if (portfolioError) throw portfolioError;
      if (!portfolioData?.length) return [];

      // Fetch client data for these investor codes
      const investorCodes = [...new Set(portfolioData.map(p => p.investor_code))];
      const { data: clientsData, error: clientsError } = await supabase
        .from("clients")
        .select("inv_code, investor_name, rm_name, ledger_balance, market_value, accrued_interest, equity")
        .in("inv_code", investorCodes);
      if (clientsError) throw clientsError;

      // Fetch holdings data to calculate total cost per investor
      const { data: holdingsData, error: holdingsError } = await supabase
        .from("holdings")
        .select("investor_code, total_cost")
        .in("investor_code", investorCodes);
      if (holdingsError) throw holdingsError;

      // Calculate total cost per investor
      const costMap = new Map<string, number>();
      holdingsData?.forEach(h => {
        const current = costMap.get(h.investor_code) || 0;
        costMap.set(h.investor_code, current + (h.total_cost || 0));
      });

      // Create lookup map
      const clientMap = new Map(clientsData?.map(c => [c.inv_code, c]) || []);

      // Merge portfolio with client data and cost value
      return portfolioData.map(p => ({
        ...p,
        client: clientMap.get(p.investor_code) || null,
        costValue: costMap.get(p.investor_code) || 0
      })) as PortfolioWithClient[];
    }
  });

  // Fetch clients for investor code dropdown
  const { data: clients = [] } = useQuery({
    queryKey: ["clients-for-portfolio"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("inv_code, investor_name")
        .order("investor_name")
        .limit(1000);
      if (error) throw error;
      return data;
    }
  });

  // Fetch custom fields
  const { data: customFields = [] } = useQuery({
    queryKey: ["portfolio-custom-fields"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portfolio_custom_fields")
        .select("*")
        .order("created_at");
      if (error) throw error;
      return data.map(f => ({
        ...f,
        options: Array.isArray(f.options) ? f.options : []
      })) as CustomField[];
    }
  });

  // Create portfolio mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: portfolio, error: portfolioError } = await supabase
        .from("portfolios")
        .insert({
          name: newPortfolio.name,
          description: newPortfolio.description || null,
          investor_code: newPortfolio.investor_code
        })
        .select()
        .single();

      if (portfolioError) throw portfolioError;

      const fieldValueInserts = Object.entries(fieldValues)
        .filter(([_, value]) => value)
        .map(([fieldId, value]) => ({
          portfolio_id: portfolio.id,
          field_id: fieldId,
          value
        }));

      if (fieldValueInserts.length > 0) {
        const { error: valuesError } = await supabase
          .from("portfolio_field_values")
          .insert(fieldValueInserts);
        if (valuesError) throw valuesError;
      }

      return portfolio;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolios-with-clients"] });
      queryClient.invalidateQueries({ queryKey: ["portfolios-count"] });
      setIsCreateOpen(false);
      setNewPortfolio({ name: "", description: "", investor_code: "" });
      setFieldValues({});
      toast.success("Portfolio created successfully");
    },
    onError: (error) => {
      toast.error("Failed to create portfolio: " + error.message);
    }
  });

  // Delete portfolio mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("portfolios").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolios-with-clients"] });
      queryClient.invalidateQueries({ queryKey: ["portfolios-count"] });
      toast.success("Portfolio deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete: " + error.message);
    }
  });

  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined) return "-";
    return new Intl.NumberFormat("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-foreground">Customer Portfolios</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {totalCount.toLocaleString()} portfolios total
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="btn-gradient-gold">
              <Plus className="h-4 w-4 mr-2" />
              Create Portfolio
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-foreground">Create New Portfolio</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label className="text-foreground">Portfolio Name</Label>
                <Input
                  value={newPortfolio.name}
                  onChange={(e) => setNewPortfolio({ ...newPortfolio, name: e.target.value })}
                  placeholder="Enter portfolio name"
                  className="bg-background border-border"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">Customer (Investor Code)</Label>
                <Select
                  value={newPortfolio.investor_code}
                  onValueChange={(value) => setNewPortfolio({ ...newPortfolio, investor_code: value })}
                >
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border z-50">
                    {clients.map((client) => (
                      <SelectItem key={client.inv_code} value={client.inv_code}>
                        {client.investor_name} ({client.inv_code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-foreground">Description</Label>
                <Textarea
                  value={newPortfolio.description}
                  onChange={(e) => setNewPortfolio({ ...newPortfolio, description: e.target.value })}
                  placeholder="Optional description"
                  className="bg-background border-border"
                />
              </div>

              {customFields.length > 0 && (
                <div className="border-t border-border pt-4 mt-4">
                  <h4 className="text-sm font-medium text-foreground mb-3">Custom Fields</h4>
                  {customFields.map((field) => (
                    <div key={field.id} className="space-y-2 mb-3">
                      <Label className="text-foreground">{field.field_name}</Label>
                      <Select
                        value={fieldValues[field.id] || ""}
                        onValueChange={(value) => setFieldValues({ ...fieldValues, [field.id]: value })}
                      >
                        <SelectTrigger className="bg-background border-border">
                          <SelectValue placeholder={`Select ${field.field_name}`} />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border z-50">
                          {field.options.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}

              <Button
                onClick={() => createMutation.mutate()}
                disabled={!newPortfolio.name || !newPortfolio.investor_code || createMutation.isPending}
                className="w-full btn-gradient-gold"
              >
                {createMutation.isPending ? "Creating..." : "Create Portfolio"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by exact code or name..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 bg-background border-border"
            />
          </div>
          
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground min-w-[100px] text-center">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading portfolios...</div>
        ) : portfolios.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            {debouncedSearch ? `No portfolios found for "${debouncedSearch}"` : "No portfolios found. Create your first portfolio to get started."}
          </div>
        ) : (
          <div className="rounded-md border border-border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-foreground">Code No</TableHead>
                  <TableHead className="text-foreground">Investor Name</TableHead>
                  <TableHead className="text-foreground">RM</TableHead>
                  <TableHead className="text-foreground text-right">Ledger Balance</TableHead>
                  <TableHead className="text-foreground text-right">Accrued Fees</TableHead>
                  <TableHead className="text-foreground text-right">Market Value</TableHead>
                  <TableHead className="text-foreground text-right">Cost Value</TableHead>
                  <TableHead className="text-foreground text-right">Equity</TableHead>
                  <TableHead className="text-foreground text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {portfolios.map((portfolio) => (
                  <TableRow key={portfolio.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium text-foreground">
                      {portfolio.investor_code}
                    </TableCell>
                    <TableCell className="text-foreground">
                      {portfolio.client?.investor_name || portfolio.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {portfolio.client?.rm_name || "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-foreground">
                      {formatCurrency(portfolio.client?.ledger_balance)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-foreground">
                      {formatCurrency(portfolio.client?.accrued_interest)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-foreground">
                      {formatCurrency(portfolio.client?.market_value)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-foreground">
                      {formatCurrency(portfolio.costValue)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-foreground">
                      {formatCurrency(portfolio.client?.equity)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedPortfolioId(portfolio.id)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate(portfolio.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4">
            <p className="text-sm text-muted-foreground">
              Showing {((currentPage - 1) * PAGE_SIZE) + 1} - {Math.min(currentPage * PAGE_SIZE, totalCount)} of {totalCount.toLocaleString()}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {selectedPortfolioId && (
          <PortfolioDetailDialog
            portfolioId={selectedPortfolioId}
            onClose={() => setSelectedPortfolioId(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}
