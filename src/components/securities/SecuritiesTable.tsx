import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, Plus, Search, Trash2, RefreshCw, ChevronLeft, ChevronRight, Download, CloudDownload, CheckCircle2, XCircle, AlertCircle, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import * as XLSX from "xlsx";
import { SecurityRecordSchema, sanitizeString } from "@/lib/validation-schemas";

interface Security {
  id: string;
  trading_code: string;
  close_price: number | null;
  volume: number | null;
  category: string | null;
  audited_pe: number | null;
  eps: number | null;
  instrument_type: string | null;
  total_securities: number | null;
  director_percent: number | null;
  govt_percent: number | null;
  institute_percent: number | null;
  foreign_percent: number | null;
  public_percent: number | null;
  sector: string | null;
  created_at: string;
  updated_at: string;
}

interface SyncStatus {
  status: 'idle' | 'syncing' | 'success' | 'error';
  message?: string;
  configured?: boolean;
  lastSynced?: string;
  details?: {
    ip?: string;
    database?: string;
    username?: string;
  };
  syncResult?: {
    total: number;
    synced: number;
    failed: number;
  };
}

const SECTORS = [
  "All Sectors",
  "Bank",
  "Engineering",
  "Food and Allied",
  "Fuel & Power",
  "Insurance",
  "IT Sector",
  "Miscellaneous",
  "Mutual Funds",
  "Pharmaceuticals and Chemicals",
  "SME Sector",
  "Textile",
  "Corporate Bond",
  "Cement",
  "Ceramics Sector",
  "Financial Institutions",
  "Paper & Printing",
  "Services & Real Estate",
  "Tannery Industries",
  "Telecommunication",
  "Travel and Leisure",
];

const CATEGORIES = ["All", "A", "B", "N", "Z", "Y"];

export function SecuritiesTable() {
  const [securities, setSecurities] = useState<Security[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sectorFilter, setSectorFilter] = useState("All Sectors");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({ status: 'idle' });
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);
  const { toast } = useToast();

  // Form state for adding new security
  const [newSecurity, setNewSecurity] = useState({
    trading_code: "",
    close_price: "",
    volume: "",
    category: "",
    audited_pe: "",
    eps: "",
    instrument_type: "",
    total_securities: "",
    director_percent: "",
    govt_percent: "",
    institute_percent: "",
    foreign_percent: "",
    public_percent: "",
    sector: "",
  });

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchTerm(searchInput);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    fetchSecurities();
  }, [searchTerm, sectorFilter, categoryFilter, currentPage, pageSize]);

  const fetchSecurities = async () => {
    setLoading(true);
    try {
      let query = supabase.from("securities").select("*", { count: "exact" });

      if (searchTerm) {
        query = query.ilike("trading_code", `%${searchTerm}%`);
      }

      if (sectorFilter !== "All Sectors") {
        query = query.eq("sector", sectorFilter);
      }

      if (categoryFilter !== "All") {
        query = query.eq("category", categoryFilter);
      }

      const from = (currentPage - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error, count } = await query
        .order("trading_code", { ascending: true })
        .range(from, to);

      if (error) throw error;

      setSecurities(data || []);
      setTotalCount(count || 0);
    } catch (error) {
      console.error("Error fetching securities:", error);
      toast({
        title: "Error",
        description: "Failed to fetch securities data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as string[][];

      if (jsonData.length < 2) {
        throw new Error("File is empty or has no data rows");
      }

      // Parse header row
      const headers = jsonData[0].map((h: string) => h?.toString().trim());
      
      // Map CSV columns to database columns
      const columnMap: Record<string, string> = {
        "TRADING CODE": "trading_code",
        "Close": "close_price",
        "Volume": "volume",
        "CAT": "category",
        "AUDITED PE": "audited_pe",
        "EPS": "eps",
        "INSTRUMENT TYPE": "instrument_type",
        "TOTAL SEC.": "total_securities",
        "DIRECTOR %": "director_percent",
        "GOVT %": "govt_percent",
        "INSTITUTE %": "institute_percent",
        "FOREIGN %": "foreign_percent",
        "PUBLIC %": "public_percent",
        "Sector": "sector",
      };

      const validRecords: any[] = [];
      const validationErrors: string[] = [];
      const chunkSize = 500;

      for (let i = 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!row || row.length === 0) continue;

        const rawRecord: Record<string, unknown> = {};
        headers.forEach((header: string, index: number) => {
          const dbColumn = columnMap[header];
          if (dbColumn) {
            let value = row[index];
            if (typeof value === "string") {
              value = sanitizeString(value);
            }
            
            // Handle numeric fields
            if (["close_price", "volume", "audited_pe", "eps", "total_securities", 
                 "director_percent", "govt_percent", "institute_percent", 
                 "foreign_percent", "public_percent"].includes(dbColumn)) {
              const numVal = parseFloat(String(value || ''));
              rawRecord[dbColumn] = isNaN(numVal) ? null : numVal;
            } else {
              rawRecord[dbColumn] = value || null;
            }
          }
        });

        // Validate using zod schema
        const result = SecurityRecordSchema.safeParse(rawRecord);
        
        if (result.success) {
          validRecords.push(result.data);
        } else if (validationErrors.length < 10) {
          validationErrors.push(`Row ${i}: ${result.error.errors.map(e => e.message).join(', ')}`);
        }
      }

      if (validationErrors.length > 0) {
        console.warn('Validation warnings:', validationErrors);
      }

      // Clear existing data before import
      await supabase.from("securities").delete().neq("id", "00000000-0000-0000-0000-000000000000");

      // Insert in chunks
      for (let i = 0; i < validRecords.length; i += chunkSize) {
        const chunk = validRecords.slice(i, i + chunkSize);
        const { error } = await supabase.from("securities").insert(chunk);
        if (error) throw error;

        // Yield to UI
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }

      toast({
        title: "Import Successful",
        description: `Imported ${validRecords.length} securities`,
      });

      fetchSecurities();
    } catch (error: any) {
      console.error("Import error:", error);
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import file",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const handleAddSecurity = async () => {
    if (!newSecurity.trading_code) {
      toast({
        title: "Validation Error",
        description: "Trading code is required",
        variant: "destructive",
      });
      return;
    }

    try {
      const record = {
        trading_code: newSecurity.trading_code,
        close_price: newSecurity.close_price ? parseFloat(newSecurity.close_price) : null,
        volume: newSecurity.volume ? parseInt(newSecurity.volume) : null,
        category: newSecurity.category || null,
        audited_pe: newSecurity.audited_pe ? parseFloat(newSecurity.audited_pe) : null,
        eps: newSecurity.eps ? parseFloat(newSecurity.eps) : null,
        instrument_type: newSecurity.instrument_type || null,
        total_securities: newSecurity.total_securities ? parseInt(newSecurity.total_securities) : null,
        director_percent: newSecurity.director_percent ? parseFloat(newSecurity.director_percent) : null,
        govt_percent: newSecurity.govt_percent ? parseFloat(newSecurity.govt_percent) : null,
        institute_percent: newSecurity.institute_percent ? parseFloat(newSecurity.institute_percent) : null,
        foreign_percent: newSecurity.foreign_percent ? parseFloat(newSecurity.foreign_percent) : null,
        public_percent: newSecurity.public_percent ? parseFloat(newSecurity.public_percent) : null,
        sector: newSecurity.sector || null,
      };

      const { error } = await supabase.from("securities").insert(record);
      if (error) throw error;

      toast({
        title: "Success",
        description: "Security added successfully",
      });

      setIsAddDialogOpen(false);
      setNewSecurity({
        trading_code: "",
        close_price: "",
        volume: "",
        category: "",
        audited_pe: "",
        eps: "",
        instrument_type: "",
        total_securities: "",
        director_percent: "",
        govt_percent: "",
        institute_percent: "",
        foreign_percent: "",
        public_percent: "",
        sector: "",
      });
      fetchSecurities();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to add security",
        variant: "destructive",
      });
    }
  };

  const handleDeleteSecurity = async (id: string) => {
    try {
      const { error } = await supabase.from("securities").delete().eq("id", id);
      if (error) throw error;

      toast({
        title: "Deleted",
        description: "Security removed successfully",
      });
      fetchSecurities();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete security",
        variant: "destructive",
      });
    }
  };

  const handleExport = () => {
    const exportData = securities.map((s) => ({
      "Trading Code": s.trading_code,
      "Close Price": s.close_price,
      Volume: s.volume,
      Category: s.category,
      "Audited PE": s.audited_pe,
      EPS: s.eps,
      "Instrument Type": s.instrument_type,
      "Total Securities": s.total_securities,
      "Director %": s.director_percent,
      "Govt %": s.govt_percent,
      "Institute %": s.institute_percent,
      "Foreign %": s.foreign_percent,
      "Public %": s.public_percent,
      Sector: s.sector,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Securities");
    XLSX.writeFile(wb, `securities_export_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  const checkDSEStatus = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('dse-market-data', {
        body: { action: 'check_status' }
      });
      
      if (error) throw error;
      
      return data?.data || {};
    } catch (error) {
      console.error('Error checking DSE status:', error);
      return { configured: false };
    }
  };

  const handleDSESync = async () => {
    setSyncStatus({ status: 'syncing', message: 'Checking DSE MDS configuration...' });
    
    try {
      // Only check status - direct SQL Server sync is not possible from Edge Functions
      const statusData = await checkDSEStatus();
      
      if (statusData.configured) {
        setSyncStatus({
          status: 'success',
          message: statusData.note || 'DSE MDS credentials are configured. Use the manual import feature or set up a scheduled ETL job to sync data.',
          configured: true,
          lastSynced: new Date().toISOString(),
          details: statusData.connection
        });
        
        toast({
          title: "Connection Verified",
          description: "DSE MDS credentials are configured correctly.",
        });
      } else {
        setSyncStatus({
          status: 'error',
          message: 'DSE MDS credentials are not configured.',
          configured: false
        });
        
        toast({
          title: "Not Configured",
          description: "DSE MDS credentials need to be configured.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      console.error('DSE status check error:', error);
      
      setSyncStatus({
        status: 'error',
        message: error.message || 'Failed to check DSE MDS status',
        configured: false
      });
      
      toast({
        title: "Error",
        description: error.message || "Failed to check DSE MDS status",
        variant: "destructive",
      });
    }
  };

  const handleBulkSync = async () => {
    setSyncStatus({ 
      status: 'syncing', 
      message: 'Syncing all securities from external API... This may take a few minutes.' 
    });
    
    try {
      const { data, error } = await supabase.functions.invoke('dse-market-data', {
        body: { action: 'bulk_sync' }
      });
      
      if (error) throw error;
      
      const result = data?.data;
      
      if (!result) {
        throw new Error('No result returned from bulk sync');
      }
      
      setSyncStatus({
        status: 'success',
        message: `Synced ${result.synced} of ${result.total} securities. ${result.failed} failed.`,
        configured: true,
        lastSynced: result.synced_at,
        syncResult: {
          total: result.total,
          synced: result.synced,
          failed: result.failed
        }
      });
      
      toast({
        title: "Bulk Sync Complete",
        description: `Updated ${result.synced} securities. ${result.failed > 0 ? `${result.failed} failed.` : ''}`,
      });
      
      // Refresh the table
      fetchSecurities();
    } catch (error: any) {
      console.error('Bulk sync error:', error);
      
      setSyncStatus({
        status: 'error',
        message: error.message || 'Bulk sync failed',
        configured: false
      });
      
      toast({
        title: "Bulk Sync Failed",
        description: error.message || "Failed to sync securities",
        variant: "destructive",
      });
    }
  };

    switch (syncStatus.status) {
      case 'syncing':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-amber-500" />;
      default:
        return <CloudDownload className="h-4 w-4" />;
    }
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <CardTitle className="text-lg font-medium">Securities Master Data</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {/* DSE Sync Button */}
            <Dialog open={isSyncDialogOpen} onOpenChange={setIsSyncDialogOpen}>
              <DialogTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {
                    setIsSyncDialogOpen(true);
                    if (syncStatus.status === 'idle') {
                      checkDSEStatus().then(statusData => {
                        setSyncStatus({
                          status: 'idle',
                          configured: statusData.configured,
                          details: statusData.connection,
                          message: statusData.message
                        });
                      });
                    }
                  }}
                >
                  {getSyncStatusIcon()}
                  <span className="ml-2">DSE Sync</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>DSE Market Data Sync</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  {/* Connection Status */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">MDS Connection</span>
                      <Badge variant={syncStatus.configured ? "default" : "secondary"}>
                        {syncStatus.configured ? "Configured" : "Not Configured"}
                      </Badge>
                    </div>
                    {syncStatus.details && (
                      <div className="text-xs text-muted-foreground space-y-1 bg-muted/50 p-2 rounded">
                        <div>IP: {syncStatus.details.ip}</div>
                        <div>Database: {syncStatus.details.database}</div>
                        <div>Username: {syncStatus.details.username}</div>
                      </div>
                    )}
                  </div>

                  {/* Sync Status */}
                  <div className="space-y-2">
                    <span className="text-sm font-medium">Sync Status</span>
                    <div className={`p-3 rounded-lg border ${
                      syncStatus.status === 'success' ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800' :
                      syncStatus.status === 'error' ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800' :
                      syncStatus.status === 'syncing' ? 'bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800' :
                      'bg-muted/50 border-border'
                    }`}>
                      <div className="flex items-center gap-2">
                        {getSyncStatusIcon()}
                        <span className="text-sm">
                          {syncStatus.status === 'idle' ? 'Ready to sync' :
                           syncStatus.status === 'syncing' ? 'Syncing...' :
                           syncStatus.status === 'success' ? 'Completed' : 'Attention Required'}
                        </span>
                      </div>
                      {syncStatus.message && (
                        <p className="text-xs text-muted-foreground mt-2">{syncStatus.message}</p>
                      )}
                      {syncStatus.lastSynced && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Last checked: {new Date(syncStatus.lastSynced).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Info Note */}
                  <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded">
                    <strong>Note:</strong> Click "Sync All Prices" to fetch current market prices for all securities from the external API. Uses LTP when close price is unavailable.
                  </div>

                  {/* Sync Results */}
                  {syncStatus.syncResult && (
                    <div className="text-xs space-y-1 bg-muted/50 p-2 rounded">
                      <div className="flex justify-between">
                        <span>Total Securities:</span>
                        <span className="font-medium">{syncStatus.syncResult.total}</span>
                      </div>
                      <div className="flex justify-between text-green-600">
                        <span>Successfully Synced:</span>
                        <span className="font-medium">{syncStatus.syncResult.synced}</span>
                      </div>
                      {syncStatus.syncResult.failed > 0 && (
                        <div className="flex justify-between text-amber-600">
                          <span>Failed:</span>
                          <span className="font-medium">{syncStatus.syncResult.failed}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex flex-col gap-2">
                    <Button 
                      onClick={handleBulkSync} 
                      disabled={syncStatus.status === 'syncing'}
                      className="w-full"
                    >
                      {syncStatus.status === 'syncing' ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Syncing All Prices...
                        </>
                      ) : (
                        <>
                          <CloudDownload className="h-4 w-4 mr-2" />
                          Sync All Prices
                        </>
                      )}
                    </Button>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline"
                        onClick={handleDSESync} 
                        disabled={syncStatus.status === 'syncing'}
                        className="flex-1"
                        size="sm"
                      >
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Check Status
                      </Button>
                      <Button 
                        variant="outline" 
                        onClick={() => setIsSyncDialogOpen(false)}
                        size="sm"
                      >
                        Close
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Button variant="outline" size="sm" onClick={handleExport} disabled={securities.length === 0}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Add Security
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add New Security</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-4 py-4">
                  <div className="space-y-2">
                    <Label>Trading Code *</Label>
                    <Input
                      value={newSecurity.trading_code}
                      onChange={(e) => setNewSecurity({ ...newSecurity, trading_code: e.target.value })}
                      placeholder="e.g., ABBANK"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Close Price</Label>
                    <Input
                      type="number"
                      value={newSecurity.close_price}
                      onChange={(e) => setNewSecurity({ ...newSecurity, close_price: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Volume</Label>
                    <Input
                      type="number"
                      value={newSecurity.volume}
                      onChange={(e) => setNewSecurity({ ...newSecurity, volume: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={newSecurity.category}
                      onValueChange={(v) => setNewSecurity({ ...newSecurity, category: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {["A", "B", "N", "Z", "Y"].map((cat) => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Audited PE</Label>
                    <Input
                      type="number"
                      value={newSecurity.audited_pe}
                      onChange={(e) => setNewSecurity({ ...newSecurity, audited_pe: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>EPS</Label>
                    <Input
                      type="number"
                      value={newSecurity.eps}
                      onChange={(e) => setNewSecurity({ ...newSecurity, eps: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Instrument Type</Label>
                    <Input
                      value={newSecurity.instrument_type}
                      onChange={(e) => setNewSecurity({ ...newSecurity, instrument_type: e.target.value })}
                      placeholder="e.g., Equity"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Total Securities</Label>
                    <Input
                      type="number"
                      value={newSecurity.total_securities}
                      onChange={(e) => setNewSecurity({ ...newSecurity, total_securities: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Director %</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newSecurity.director_percent}
                      onChange={(e) => setNewSecurity({ ...newSecurity, director_percent: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Govt %</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newSecurity.govt_percent}
                      onChange={(e) => setNewSecurity({ ...newSecurity, govt_percent: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Institute %</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newSecurity.institute_percent}
                      onChange={(e) => setNewSecurity({ ...newSecurity, institute_percent: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Foreign %</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newSecurity.foreign_percent}
                      onChange={(e) => setNewSecurity({ ...newSecurity, foreign_percent: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Public %</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={newSecurity.public_percent}
                      onChange={(e) => setNewSecurity({ ...newSecurity, public_percent: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Sector</Label>
                    <Select
                      value={newSecurity.sector}
                      onValueChange={(v) => setNewSecurity({ ...newSecurity, sector: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select sector" />
                      </SelectTrigger>
                      <SelectContent>
                        {SECTORS.filter((s) => s !== "All Sectors").map((sector) => (
                          <SelectItem key={sector} value={sector}>{sector}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddSecurity}>Add Security</Button>
                </div>
              </DialogContent>
            </Dialog>
            <label>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileUpload}
                disabled={uploading}
              />
              <Button variant="outline" size="sm" asChild disabled={uploading}>
                <span>
                  <Upload className="h-4 w-4 mr-2" />
                  {uploading ? "Importing..." : "Import Excel/CSV"}
                </span>
              </Button>
            </label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search trading code..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={sectorFilter} onValueChange={(v) => { setSectorFilter(v); setCurrentPage(1); }}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Sector" />
            </SelectTrigger>
            <SelectContent>
              {SECTORS.map((sector) => (
                <SelectItem key={sector} value={sector}>{sector}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setCurrentPage(1); }}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchSecurities}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* Stats */}
        <div className="text-sm text-muted-foreground">
          Showing {securities.length} of {totalCount} securities
        </div>

        {/* Table */}
        <div className="border rounded-lg overflow-auto max-h-[60vh]">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="whitespace-nowrap">Trading Code</TableHead>
                <TableHead className="text-right">Close</TableHead>
                <TableHead className="text-right">Volume</TableHead>
                <TableHead>CAT</TableHead>
                <TableHead className="text-right">PE</TableHead>
                <TableHead className="text-right">EPS</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Total Sec.</TableHead>
                <TableHead className="text-right">Director%</TableHead>
                <TableHead className="text-right">Govt%</TableHead>
                <TableHead className="text-right">Institute%</TableHead>
                <TableHead className="text-right">Foreign%</TableHead>
                <TableHead className="text-right">Public%</TableHead>
                <TableHead>Sector</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={15} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : securities.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={15} className="text-center py-8 text-muted-foreground">
                    No securities found. Import a file or add manually.
                  </TableCell>
                </TableRow>
              ) : (
                securities.map((security) => (
                  <TableRow key={security.id}>
                    <TableCell className="font-medium">{security.trading_code}</TableCell>
                    <TableCell className="text-right">{security.close_price?.toFixed(2) ?? "-"}</TableCell>
                    <TableCell className="text-right">{security.volume?.toLocaleString() ?? "-"}</TableCell>
                    <TableCell>{security.category ?? "-"}</TableCell>
                    <TableCell className="text-right">{security.audited_pe?.toFixed(2) ?? "-"}</TableCell>
                    <TableCell className="text-right">{security.eps?.toFixed(2) ?? "-"}</TableCell>
                    <TableCell>{security.instrument_type ?? "-"}</TableCell>
                    <TableCell className="text-right">{security.total_securities?.toLocaleString() ?? "-"}</TableCell>
                    <TableCell className="text-right">{security.director_percent?.toFixed(2) ?? "-"}</TableCell>
                    <TableCell className="text-right">{security.govt_percent?.toFixed(2) ?? "-"}</TableCell>
                    <TableCell className="text-right">{security.institute_percent?.toFixed(2) ?? "-"}</TableCell>
                    <TableCell className="text-right">{security.foreign_percent?.toFixed(2) ?? "-"}</TableCell>
                    <TableCell className="text-right">{security.public_percent?.toFixed(2) ?? "-"}</TableCell>
                    <TableCell className="max-w-[150px] truncate">{security.sector ?? "-"}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteSecurity(security.id)}
                        className="h-8 w-8 text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows per page:</span>
              <Select value={pageSize.toString()} onValueChange={(v) => { setPageSize(parseInt(v)); setCurrentPage(1); }}>
                <SelectTrigger className="w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                  <SelectItem value="250">250</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
