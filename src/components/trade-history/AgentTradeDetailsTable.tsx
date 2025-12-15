import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, Search, Download, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

interface AgentTradeDetail {
  id: string;
  investor_code: string;
  agent_id: string;
  rm_id: string;
  rm_name: string | null;
  turnover: number;
  gross_commission: number;
  laga_howla: number;
  ait: number;
  net_commission: number;
  net_commission_without_ait_cdbl: number;
  cdbl_charge: number;
  commission_rate: number;
  comp_portion_gross_comm: number;
  company_profit: number;
  comm_associates_portion: number;
  upload_month: string | null;
}

interface AgentSummary {
  agent_id: string;
  rm_id: string;
  rm_name: string;
  totalTurnover: number;
  totalGrossCommission: number;
  totalNetCommission: number;
  totalCompanyProfit: number;
  investorCount: number;
  details: AgentTradeDetail[];
}

export function AgentTradeDetailsTable() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedRmId, setSelectedRmId] = useState<string>("all");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("all");
  const [uploading, setUploading] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const { data: tradeDetails, isLoading, refetch } = useQuery({
    queryKey: ["agent-trade-details"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_trade_details")
        .select("*")
        .order("rm_id", { ascending: true });
      if (error) throw error;
      return data as AgentTradeDetail[];
    }
  });

  // Get unique RM Names for dropdown (using rm_name column)
  const rmOptions = useMemo(() => {
    if (!tradeDetails) return [];
    const rmMap = new Map<string, string>();
    tradeDetails.forEach(d => {
      if (d.rm_name && !rmMap.has(d.rm_name)) {
        rmMap.set(d.rm_name, d.rm_id);
      }
    });
    return Array.from(rmMap.entries())
      .map(([name, id]) => ({ name, id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tradeDetails]);

  // Get unique Agent IDs for dropdown (filtered by selected RM if applicable)
  const agentIds = useMemo(() => {
    if (!tradeDetails) return [];
    let filtered = tradeDetails;
    if (selectedRmId !== "all") {
      filtered = filtered.filter(d => d.rm_name === selectedRmId || d.rm_id === selectedRmId);
    }
    const unique = [...new Set(filtered.map(d => d.agent_id))];
    return unique.sort();
  }, [tradeDetails, selectedRmId]);

  // Group and summarize by agent
  const agentSummaries = useMemo(() => {
    if (!tradeDetails) return [];
    
    let filtered = tradeDetails;
    if (selectedRmId !== "all") {
      filtered = filtered.filter(d => d.rm_id === selectedRmId);
    }
    if (selectedAgentId !== "all") {
      filtered = filtered.filter(d => d.agent_id === selectedAgentId);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(d => 
        d.agent_id.toLowerCase().includes(term) ||
        d.rm_id.toLowerCase().includes(term) ||
        d.rm_name?.toLowerCase().includes(term) ||
        d.investor_code.toLowerCase().includes(term)
      );
    }

    const grouped = new Map<string, AgentSummary>();
    filtered.forEach(detail => {
      const existing = grouped.get(detail.agent_id);
      if (existing) {
        existing.totalTurnover += detail.turnover || 0;
        existing.totalGrossCommission += detail.gross_commission || 0;
        existing.totalNetCommission += detail.net_commission || 0;
        existing.totalCompanyProfit += detail.company_profit || 0;
        existing.investorCount++;
        existing.details.push(detail);
      } else {
        grouped.set(detail.agent_id, {
          agent_id: detail.agent_id,
          rm_id: detail.rm_id,
          rm_name: detail.rm_name || "",
          totalTurnover: detail.turnover || 0,
          totalGrossCommission: detail.gross_commission || 0,
          totalNetCommission: detail.net_commission || 0,
          totalCompanyProfit: detail.company_profit || 0,
          investorCount: 1,
          details: [detail]
        });
      }
    });

    return Array.from(grouped.values()).sort((a, b) => a.rm_id.localeCompare(b.rm_id));
  }, [tradeDetails, selectedRmId, selectedAgentId, searchTerm]);

  const parseNumber = (value: unknown): number => {
    if (value === null || value === undefined || value === "") return 0;
    const str = String(value).replace(/,/g, "").replace(/%/g, "");
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];

      // Find header row (contains "INVESTOR CODE" or similar)
      let headerRowIndex = 0;
      for (let i = 0; i < Math.min(10, jsonData.length); i++) {
        const row = jsonData[i];
        if (row && row.some(cell => String(cell).toUpperCase().includes("INVESTOR CODE"))) {
          headerRowIndex = i;
          break;
        }
      }

      const headers = (jsonData[headerRowIndex] as string[]).map(h => String(h || "").trim().toUpperCase());
      const dataRows = jsonData.slice(headerRowIndex + 1);

      // Column mapping
      const colMap: Record<string, number> = {};
      const mappings = [
        { keys: ["INVESTOR CODE", "INV CODE"], field: "investor_code" },
        { keys: ["AGENT ID"], field: "agent_id" },
        { keys: ["RM ID"], field: "rm_id" },
        { keys: ["RM NAME"], field: "rm_name" },
        { keys: ["TURNOVER"], field: "turnover" },
        { keys: ["GROSS COMMISSION"], field: "gross_commission" },
        { keys: ["LAGA/HOWLA", "LAGA", "HOWLA"], field: "laga_howla" },
        { keys: ["AIT"], field: "ait" },
        { keys: ["NET COMMISSION"], field: "net_commission" },
        { keys: ["NET COMMISSION WITHOUT AIT", "NET COMMISSION WITHOUT AIT & CDBL"], field: "net_commission_without_ait_cdbl" },
        { keys: ["CDBL CHARGE"], field: "cdbl_charge" },
        { keys: ["COMMISSION RATE"], field: "commission_rate" },
        { keys: ["COMP PORTION", "COMP PORTION ON GROSS"], field: "comp_portion_gross_comm" },
        { keys: ["COMPANY PROFIT"], field: "company_profit" },
        { keys: ["COMM. OF ASSOCIATES", "COMM OF ASSOCIATES", "ASSOCIATES PORTION"], field: "comm_associates_portion" }
      ];

      mappings.forEach(({ keys, field }) => {
        const idx = headers.findIndex(h => keys.some(k => h.includes(k)));
        if (idx !== -1) colMap[field] = idx;
      });

      // Extract month from filename
      const monthMatch = file.name.match(/([A-Za-z]{3})-?(\d{2})/i);
      const uploadMonth = monthMatch ? `${monthMatch[1]}-${monthMatch[2]}` : null;

      const records: Omit<AgentTradeDetail, "id">[] = [];
      for (const row of dataRows) {
        const arr = row as unknown[];
        const investorCode = arr[colMap.investor_code];
        const agentId = arr[colMap.agent_id];
        const rmId = arr[colMap.rm_id];

        if (!investorCode || !agentId || !rmId) continue;

        records.push({
          investor_code: String(investorCode),
          agent_id: String(agentId),
          rm_id: String(rmId),
          rm_name: colMap.rm_name !== undefined ? String(arr[colMap.rm_name] || "") : null,
          turnover: parseNumber(arr[colMap.turnover]),
          gross_commission: parseNumber(arr[colMap.gross_commission]),
          laga_howla: parseNumber(arr[colMap.laga_howla]),
          ait: parseNumber(arr[colMap.ait]),
          net_commission: parseNumber(arr[colMap.net_commission]),
          net_commission_without_ait_cdbl: parseNumber(arr[colMap.net_commission_without_ait_cdbl]),
          cdbl_charge: parseNumber(arr[colMap.cdbl_charge]),
          commission_rate: parseNumber(arr[colMap.commission_rate]),
          comp_portion_gross_comm: parseNumber(arr[colMap.comp_portion_gross_comm]),
          company_profit: parseNumber(arr[colMap.company_profit]),
          comm_associates_portion: parseNumber(arr[colMap.comm_associates_portion]),
          upload_month: uploadMonth
        });
      }

      if (records.length === 0) {
        toast.error("No valid records found in file");
        return;
      }

      // Delete existing records for this month if specified
      if (uploadMonth) {
        await supabase.from("agent_trade_details").delete().eq("upload_month", uploadMonth);
      }

      // Insert in batches
      const batchSize = 500;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const { error } = await supabase.from("agent_trade_details").insert(batch);
        if (error) throw error;
      }

      toast.success(`Imported ${records.length} agent trade records`);
      refetch();
    } catch (error) {
      console.error("Import error:", error);
      toast.error("Failed to import file");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const handleExport = () => {
    if (!agentSummaries.length) return;

    const exportData = agentSummaries.flatMap(s => 
      s.details.map(d => ({
        "Investor Code": d.investor_code,
        "Agent ID": d.agent_id,
        "RM ID": d.rm_id,
        "RM Name": d.rm_name,
        "Turnover": d.turnover,
        "Gross Commission": d.gross_commission,
        "Laga/Howla": d.laga_howla,
        "AIT": d.ait,
        "Net Commission": d.net_commission,
        "CDBL Charge": d.cdbl_charge,
        "Commission Rate": d.commission_rate,
        "Company Profit": d.company_profit,
        "Associates Portion": d.comm_associates_portion
      }))
    );

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Agent Trade Details");
    XLSX.writeFile(wb, "agent_trade_details_export.xlsx");
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  };

  const grandTotal = useMemo(() => {
    return agentSummaries.reduce((acc, s) => ({
      turnover: acc.turnover + s.totalTurnover,
      grossComm: acc.grossComm + s.totalGrossCommission,
      netComm: acc.netComm + s.totalNetCommission,
      profit: acc.profit + s.totalCompanyProfit,
      investors: acc.investors + s.investorCount
    }), { turnover: 0, grossComm: 0, netComm: 0, profit: 0, investors: 0 });
  }, [agentSummaries]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Agent Trade Details
            </CardTitle>
            <CardDescription>View and manage agent trade data with commissions and charges</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExport} disabled={!agentSummaries.length}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button variant="default" asChild disabled={uploading}>
              <label className="cursor-pointer">
                {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                Import Excel
                <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />
              </label>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by agent, RM or investor code..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <Select value={selectedRmId} onValueChange={(v) => { setSelectedRmId(v); setSelectedAgentId("all"); }}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by RM Name" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All RMs</SelectItem>
              {rmOptions.map(rm => (
                <SelectItem key={rm.name} value={rm.name}>{rm.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by Agent ID" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Agents</SelectItem>
              {agentIds.map(id => (
                <SelectItem key={id} value={id}>{id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Total Agents</p>
            <p className="text-lg font-semibold">{agentSummaries.length}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Total Investors</p>
            <p className="text-lg font-semibold">{grandTotal.investors.toLocaleString()}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Total Turnover</p>
            <p className="text-lg font-semibold">{formatCurrency(grandTotal.turnover)}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Net Commission</p>
            <p className="text-lg font-semibold">{formatCurrency(grandTotal.netComm)}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Company Profit</p>
            <p className="text-lg font-semibold">{formatCurrency(grandTotal.profit)}</p>
          </div>
        </div>

        {/* Agent Summary Table */}
        <div className="rounded-md border overflow-auto max-h-[600px]">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="w-[120px]">Agent ID</TableHead>
                <TableHead className="w-[100px]">RM ID</TableHead>
                <TableHead>RM Name</TableHead>
                <TableHead className="text-center">Investors</TableHead>
                <TableHead className="text-right">Turnover</TableHead>
                <TableHead className="text-right">Gross Comm.</TableHead>
                <TableHead className="text-right">Net Comm.</TableHead>
                <TableHead className="text-right">Company Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agentSummaries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No agent trade data found. Import an Excel file to get started.
                  </TableCell>
                </TableRow>
              ) : (
                agentSummaries.map(summary => (
                  <>
                    <TableRow 
                      key={summary.agent_id} 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setExpandedAgent(expandedAgent === summary.agent_id ? null : summary.agent_id)}
                    >
                      <TableCell className="font-medium">{summary.agent_id}</TableCell>
                      <TableCell>{summary.rm_id}</TableCell>
                      <TableCell>{summary.rm_name}</TableCell>
                      <TableCell className="text-center">{summary.investorCount}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(summary.totalTurnover)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(summary.totalGrossCommission)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(summary.totalNetCommission)}</TableCell>
                      <TableCell className="text-right font-mono">{formatCurrency(summary.totalCompanyProfit)}</TableCell>
                    </TableRow>
                    {expandedAgent === summary.agent_id && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/30 p-4">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Investor</TableHead>
                                <TableHead className="text-right">Turnover</TableHead>
                                <TableHead className="text-right">Gross</TableHead>
                                <TableHead className="text-right">Laga/Howla</TableHead>
                                <TableHead className="text-right">AIT</TableHead>
                                <TableHead className="text-right">Net</TableHead>
                                <TableHead className="text-right">CDBL</TableHead>
                                <TableHead className="text-right">Rate</TableHead>
                                <TableHead className="text-right">Profit</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {summary.details.map(d => (
                                <TableRow key={d.id}>
                                  <TableCell>{d.investor_code}</TableCell>
                                  <TableCell className="text-right font-mono">{formatCurrency(d.turnover)}</TableCell>
                                  <TableCell className="text-right font-mono">{formatCurrency(d.gross_commission)}</TableCell>
                                  <TableCell className="text-right font-mono">{formatCurrency(d.laga_howla)}</TableCell>
                                  <TableCell className="text-right font-mono">{formatCurrency(d.ait)}</TableCell>
                                  <TableCell className="text-right font-mono">{formatCurrency(d.net_commission)}</TableCell>
                                  <TableCell className="text-right font-mono">{formatCurrency(d.cdbl_charge)}</TableCell>
                                  <TableCell className="text-right font-mono">{(d.commission_rate * 100).toFixed(2)}%</TableCell>
                                  <TableCell className="text-right font-mono">{formatCurrency(d.company_profit)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
