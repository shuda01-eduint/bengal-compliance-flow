import { useState, useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Search, Upload, ChevronDown, ChevronRight, Users, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

interface AgentCode {
  id: string;
  investor_code: string;
  agent_id: string;
  rm_id: string;
}

interface GroupedByRM {
  rm_id: string;
  agents: { agent_id: string; investors: string[] }[];
  totalInvestors: number;
}

export function AgentCodesTable() {
  const [agentCodes, setAgentCodes] = useState<AgentCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedRMs, setExpandedRMs] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchAgentCodes();
  }, []);

  const fetchAgentCodes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("agent_codes")
        .select("*")
        .order("rm_id");

      if (error) throw error;
      setAgentCodes(data || []);
    } catch (error) {
      console.error("Error fetching agent codes:", error);
      toast({
        title: "Error",
        description: "Failed to fetch agent codes",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const groupedData = useMemo((): GroupedByRM[] => {
    const filtered = agentCodes.filter((ac) => {
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return (
        ac.investor_code.toLowerCase().includes(term) ||
        ac.agent_id.toLowerCase().includes(term) ||
        ac.rm_id.toLowerCase().includes(term)
      );
    });

    const byRM = new Map<string, Map<string, string[]>>();

    filtered.forEach((ac) => {
      if (!byRM.has(ac.rm_id)) {
        byRM.set(ac.rm_id, new Map());
      }
      const rmMap = byRM.get(ac.rm_id)!;
      if (!rmMap.has(ac.agent_id)) {
        rmMap.set(ac.agent_id, []);
      }
      rmMap.get(ac.agent_id)!.push(ac.investor_code);
    });

    return Array.from(byRM.entries())
      .map(([rm_id, agentMap]) => ({
        rm_id,
        agents: Array.from(agentMap.entries()).map(([agent_id, investors]) => ({
          agent_id,
          investors: investors.sort((a, b) => Number(a) - Number(b)),
        })),
        totalInvestors: Array.from(agentMap.values()).reduce((sum, inv) => sum + inv.length, 0),
      }))
      .sort((a, b) => a.rm_id.localeCompare(b.rm_id));
  }, [agentCodes, searchTerm]);

  const toggleRM = (rmId: string) => {
    setExpandedRMs((prev) => {
      const next = new Set(prev);
      if (next.has(rmId)) {
        next.delete(rmId);
      } else {
        next.add(rmId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedRMs(new Set(groupedData.map((g) => g.rm_id)));
  };

  const collapseAll = () => {
    setExpandedRMs(new Set());
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet);

      const records = jsonData
        .map((row) => ({
          investor_code: String(row["Investor codes"] || row["investor_code"] || ""),
          agent_id: String(row["Agent ID"] || row["agent_id"] || ""),
          rm_id: String(row["RM ID"] || row["rm_id"] || ""),
        }))
        .filter((r) => r.investor_code && r.agent_id && r.rm_id);

      if (records.length === 0) {
        throw new Error("No valid records found in file");
      }

      // Insert in batches
      const batchSize = 500;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const { error } = await supabase.from("agent_codes").upsert(batch, {
          onConflict: "investor_code,agent_id",
        });
        if (error) throw error;
      }

      toast({
        title: "Upload successful",
        description: `${records.length} agent codes imported`,
      });

      fetchAgentCodes();
    } catch (error: unknown) {
      console.error("Upload error:", error);
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Failed to parse file",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Agent Codes by RM
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search RM ID, Agent ID, or Investor Code..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={expandAll}>
              Expand All
            </Button>
            <Button variant="outline" size="sm" onClick={collapseAll}>
              Collapse All
            </Button>
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="btn-gradient-gold text-primary-foreground"
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Import Excel
                </>
              )}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* Summary */}
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{groupedData.length} RMs</span>
          <span>•</span>
          <span>{agentCodes.length} total records</span>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : groupedData.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {agentCodes.length === 0 ? (
              <p>No agent codes imported yet. Upload an Excel file to get started.</p>
            ) : (
              <p>No results found for "{searchTerm}"</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {groupedData.map((group) => (
              <Collapsible
                key={group.rm_id}
                open={expandedRMs.has(group.rm_id)}
                onOpenChange={() => toggleRM(group.rm_id)}
              >
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted transition-colors">
                    <div className="flex items-center gap-3">
                      {expandedRMs.has(group.rm_id) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <span className="font-medium">RM {group.rm_id}</span>
                      <Badge variant="secondary">{group.agents.length} agents</Badge>
                      <Badge variant="outline">{group.totalInvestors} investors</Badge>
                    </div>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 ml-6 rounded-md border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Agent ID</TableHead>
                          <TableHead>Investor Codes</TableHead>
                          <TableHead className="text-right">Count</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.agents.map((agent) => (
                          <TableRow key={agent.agent_id}>
                            <TableCell className="font-medium">{agent.agent_id}</TableCell>
                            <TableCell className="max-w-[500px]">
                              <div className="flex flex-wrap gap-1">
                                {agent.investors.slice(0, 20).map((inv) => (
                                  <Badge key={inv} variant="outline" className="text-xs">
                                    {inv}
                                  </Badge>
                                ))}
                                {agent.investors.length > 20 && (
                                  <Badge variant="secondary" className="text-xs">
                                    +{agent.investors.length - 20} more
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">{agent.investors.length}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
