import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

interface CustomField {
  id: string;
  field_name: string;
  field_type: string;
  options: string[];
  created_at: string;
}

export function CustomFieldsManager() {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newField, setNewField] = useState({ field_name: "", options: [] as string[] });
  const [optionInput, setOptionInput] = useState("");

  // Fetch custom fields
  const { data: customFields = [], isLoading } = useQuery({
    queryKey: ["portfolio-custom-fields"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portfolio_custom_fields")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data.map(f => ({
        ...f,
        options: Array.isArray(f.options) ? f.options : []
      })) as CustomField[];
    }
  });

  // Create field mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("portfolio_custom_fields")
        .insert({
          field_name: newField.field_name,
          field_type: "dropdown",
          options: newField.options
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio-custom-fields"] });
      setIsCreateOpen(false);
      setNewField({ field_name: "", options: [] });
      toast.success("Custom field created");
    },
    onError: (error) => {
      toast.error("Failed to create field: " + error.message);
    }
  });

  // Delete field mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("portfolio_custom_fields").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portfolio-custom-fields"] });
      toast.success("Custom field deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete field: " + error.message);
    }
  });

  const addOption = () => {
    if (optionInput.trim() && !newField.options.includes(optionInput.trim())) {
      setNewField({ ...newField, options: [...newField.options, optionInput.trim()] });
      setOptionInput("");
    }
  };

  const removeOption = (option: string) => {
    setNewField({ ...newField, options: newField.options.filter(o => o !== option) });
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-foreground">Custom Dropdown Fields</CardTitle>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="btn-gradient-gold">
              <Plus className="h-4 w-4 mr-2" />
              Add Field
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-foreground">Create Custom Field</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label className="text-foreground">Field Name</Label>
                <Input
                  value={newField.field_name}
                  onChange={(e) => setNewField({ ...newField, field_name: e.target.value })}
                  placeholder="e.g., Risk Level, Account Type"
                  className="bg-background border-border"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-foreground">Dropdown Options</Label>
                <div className="flex gap-2">
                  <Input
                    value={optionInput}
                    onChange={(e) => setOptionInput(e.target.value)}
                    placeholder="Add an option"
                    className="bg-background border-border"
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addOption())}
                  />
                  <Button type="button" onClick={addOption} variant="outline">
                    Add
                  </Button>
                </div>
                {newField.options.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {newField.options.map((option) => (
                      <Badge key={option} variant="secondary" className="flex items-center gap-1">
                        {option}
                        <button onClick={() => removeOption(option)} className="ml-1 hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <Button
                onClick={() => createMutation.mutate()}
                disabled={!newField.field_name || newField.options.length === 0 || createMutation.isPending}
                className="w-full btn-gradient-gold"
              >
                {createMutation.isPending ? "Creating..." : "Create Field"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading fields...</div>
        ) : customFields.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No custom fields defined. Create your first dropdown field to customize portfolios.
          </div>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-foreground">Field Name</TableHead>
                  <TableHead className="text-foreground">Type</TableHead>
                  <TableHead className="text-foreground">Options</TableHead>
                  <TableHead className="text-foreground">Created</TableHead>
                  <TableHead className="text-foreground text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customFields.map((field) => (
                  <TableRow key={field.id} className="hover:bg-muted/30">
                    <TableCell className="font-medium text-foreground">{field.field_name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">Dropdown</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-md">
                        {field.options.slice(0, 5).map((option) => (
                          <Badge key={option} variant="secondary" className="text-xs">
                            {option}
                          </Badge>
                        ))}
                        {field.options.length > 5 && (
                          <Badge variant="secondary" className="text-xs">
                            +{field.options.length - 5} more
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(field.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMutation.mutate(field.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
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
  );
}
