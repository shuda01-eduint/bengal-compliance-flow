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
import { Plus, Search, Trash2, Eye } from "lucide-react";
import { toast } from "sonner";
import { PortfolioDetailDialog } from "./PortfolioDetailDialog";

interface Portfolio {
  id: string;
  name: string;
  description: string | null;
  investor_code: string;
  created_at: string;
}

interface CustomField {
  id: string;
  field_name: string;
  field_type: string;
  options: string[];
}

export function PortfolioList() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string | null>(null);
  const [newPortfolio, setNewPortfolio] = useState({
    name: "",
    description: "",
    investor_code: ""
  });
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  // Fetch portfolios
  const { data: portfolios = [], isLoading } = useQuery({
    queryKey: ["portfolios"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portfolios")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Portfolio[];
    }
  });

  // Fetch clients for investor code dropdown
  const { data: clients = [] } = useQuery({
    queryKey: ["clients-for-portfolio"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("inv_code, investor_name")
        .order("investor_name");
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
      // Create portfolio
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

      // Create field values
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
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
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
      queryClient.invalidateQueries({ queryKey: ["portfolios"] });
      toast.success("Portfolio deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete: " + error.message);
    }
  });

  const filteredPortfolios = portfolios.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.investor_code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-foreground">Customer Portfolios</CardTitle>
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
        <div className="mb-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search portfolios..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-background border-border"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading portfolios...</div>
        ) : filteredPortfolios.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No portfolios found. Create your first portfolio to get started.
          </div>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-foreground">Name</TableHead>
                  <TableHead className="text-foreground">Investor Code</TableHead>
                  <TableHead className="text-foreground">Description</TableHead>
                  <TableHead className="text-foreground">Created</TableHead>
                  <TableHead className="text-foreground text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPortfolios.map((portfolio) => (
                  <TableRow key={portfolio.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium text-foreground">{portfolio.name}</TableCell>
                    <TableCell className="text-muted-foreground">{portfolio.investor_code}</TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate">
                      {portfolio.description || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(portfolio.created_at).toLocaleDateString()}
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
