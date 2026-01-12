import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  CalendarIcon, 
  FileSearch, 
  Loader2, 
  ArrowRight, 
  TrendingUp, 
  TrendingDown,
  AlertCircle,
  Search
} from "lucide-react";
import { format, subDays } from "date-fns";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { fetchAllRows } from "@/lib/supabase-utils";

interface SnapshotRecord {
  investor_code: string;
  investor_name: string | null;
  ledger_balance: number;
}

interface MismatchItem {
  investor_code: string;
  investor_name: string | null;
  date1Balance: number | null;
  date2Balance: number | null;
  difference: number;
  percentChange: number | null;
  type: 'increased' | 'decreased' | 'new' | 'missing';
}

export const BalanceMismatchReport = () => {
  const [open, setOpen] = useState(false);
  const [date1, setDate1] = useState<Date | undefined>(subDays(new Date(), 1));
  const [date2, setDate2] = useState<Date | undefined>(new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [mismatches, setMismatches] = useState<MismatchItem[]>([]);
  const [hasCompared, setHasCompared] = useState(false);
  const [threshold, setThreshold] = useState<number>(1000);
  const [searchTerm, setSearchTerm] = useState("");

  const handleCompare = async () => {
    if (!date1 || !date2) {
      toast.error("Please select both dates");
      return;
    }

    setIsLoading(true);
    setHasCompared(false);

    try {
      const date1Str = format(date1, "yyyy-MM-dd");
      const date2Str = format(date2, "yyyy-MM-dd");

      // Fetch both snapshots in parallel with proper pagination
      const [snapshot1, snapshot2] = await Promise.all([
        fetchAllRows<SnapshotRecord>((from, to) =>
          supabase
            .from("eod_ledger_snapshots")
            .select("investor_code, investor_name, ledger_balance")
            .eq("eod_date", date1Str)
            .range(from, to)
        ),
        fetchAllRows<SnapshotRecord>((from, to) =>
          supabase
            .from("eod_ledger_snapshots")
            .select("investor_code, investor_name, ledger_balance")
            .eq("eod_date", date2Str)
            .range(from, to)
        ),
      ]);

      if (snapshot1.length === 0 && snapshot2.length === 0) {
        toast.error("No data found for either date");
        setMismatches([]);
        setHasCompared(true);
        setIsLoading(false);
        return;
      }

      // Create maps for quick lookup
      const map1 = new Map(snapshot1.map(r => [r.investor_code, r]));
      const map2 = new Map(snapshot2.map(r => [r.investor_code, r]));

      const allCodes = new Set([...map1.keys(), ...map2.keys()]);
      const results: MismatchItem[] = [];

      allCodes.forEach(code => {
        const rec1 = map1.get(code);
        const rec2 = map2.get(code);

        const bal1 = rec1?.ledger_balance ?? null;
        const bal2 = rec2?.ledger_balance ?? null;

        let type: MismatchItem['type'];
        let difference = 0;
        let percentChange: number | null = null;

        if (bal1 === null) {
          type = 'new';
          difference = bal2!;
        } else if (bal2 === null) {
          type = 'missing';
          difference = -bal1;
        } else {
          difference = bal2 - bal1;
          percentChange = bal1 !== 0 ? (difference / Math.abs(bal1)) * 100 : null;
          type = difference >= 0 ? 'increased' : 'decreased';
        }

        // Only include if difference exceeds threshold
        if (Math.abs(difference) >= threshold || type === 'new' || type === 'missing') {
          results.push({
            investor_code: code,
            investor_name: rec2?.investor_name || rec1?.investor_name || null,
            date1Balance: bal1,
            date2Balance: bal2,
            difference,
            percentChange,
            type,
          });
        }
      });

      // Sort by absolute difference descending
      results.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

      setMismatches(results);
      setHasCompared(true);

      if (results.length === 0) {
        toast.success("No significant differences found");
      } else {
        toast.success(`Found ${results.length} mismatches`);
      }
    } catch (error) {
      console.error("Compare error:", error);
      toast.error("Failed to compare balances");
    } finally {
      setIsLoading(false);
    }
  };

  const filteredMismatches = useMemo(() => {
    if (!searchTerm) return mismatches;
    const term = searchTerm.toLowerCase();
    return mismatches.filter(
      m => m.investor_code.toLowerCase().includes(term) ||
           m.investor_name?.toLowerCase().includes(term)
    );
  }, [mismatches, searchTerm]);

  const stats = useMemo(() => {
    const increased = mismatches.filter(m => m.type === 'increased').length;
    const decreased = mismatches.filter(m => m.type === 'decreased').length;
    const newCodes = mismatches.filter(m => m.type === 'new').length;
    const missing = mismatches.filter(m => m.type === 'missing').length;
    const totalDiff = mismatches.reduce((sum, m) => sum + m.difference, 0);
    return { increased, decreased, newCodes, missing, totalDiff };
  }, [mismatches]);

  const formatBalance = (val: number | null) => {
    if (val === null) return "-";
    return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const getTypeIcon = (type: MismatchItem['type']) => {
    switch (type) {
      case 'increased': return <TrendingUp className="h-4 w-4 text-green-600" />;
      case 'decreased': return <TrendingDown className="h-4 w-4 text-red-600" />;
      case 'new': return <Badge variant="secondary" className="text-xs">NEW</Badge>;
      case 'missing': return <Badge variant="destructive" className="text-xs">MISSING</Badge>;
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <FileSearch className="h-4 w-4" />
          Balance Mismatch Report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Balance Mismatch Report</DialogTitle>
          <DialogDescription>
            Compare opening balance snapshots between two dates to identify significant changes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Date Selection Row */}
          <div className="flex flex-wrap items-end gap-4">
            {/* Date 1 */}
            <div className="space-y-1">
              <label className="text-sm font-medium">From Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[180px] justify-start text-left font-normal",
                      !date1 && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date1 ? format(date1, "MMM d, yyyy") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date1}
                    onSelect={setDate1}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <ArrowRight className="h-5 w-5 text-muted-foreground mb-2" />

            {/* Date 2 */}
            <div className="space-y-1">
              <label className="text-sm font-medium">To Date</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[180px] justify-start text-left font-normal",
                      !date2 && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date2 ? format(date2, "MMM d, yyyy") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={date2}
                    onSelect={setDate2}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Threshold */}
            <div className="space-y-1">
              <label className="text-sm font-medium">Min Difference</label>
              <Input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value) || 0)}
                className="w-[120px]"
                placeholder="1000"
              />
            </div>

            {/* Compare Button */}
            <Button onClick={handleCompare} disabled={isLoading || !date1 || !date2}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Comparing...
                </>
              ) : (
                "Compare"
              )}
            </Button>
          </div>

          {/* Results */}
          {hasCompared && (
            <>
              {/* Stats Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <div className="bg-muted/50 rounded-md p-3 text-center">
                  <p className="text-2xl font-bold">{mismatches.length}</p>
                  <p className="text-xs text-muted-foreground">Total Mismatches</p>
                </div>
                <div className="bg-green-500/10 rounded-md p-3 text-center">
                  <p className="text-2xl font-bold text-green-600">{stats.increased}</p>
                  <p className="text-xs text-muted-foreground">Increased</p>
                </div>
                <div className="bg-red-500/10 rounded-md p-3 text-center">
                  <p className="text-2xl font-bold text-red-600">{stats.decreased}</p>
                  <p className="text-xs text-muted-foreground">Decreased</p>
                </div>
                <div className="bg-blue-500/10 rounded-md p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600">{stats.newCodes}</p>
                  <p className="text-xs text-muted-foreground">New Codes</p>
                </div>
                <div className="bg-amber-500/10 rounded-md p-3 text-center">
                  <p className="text-2xl font-bold text-amber-600">{stats.missing}</p>
                  <p className="text-xs text-muted-foreground">Missing</p>
                </div>
              </div>

              {/* Net Change */}
              <div className="text-sm flex items-center gap-2 text-muted-foreground">
                <AlertCircle className="h-4 w-4" />
                Net Balance Change: 
                <span className={cn(
                  "font-mono font-medium",
                  stats.totalDiff >= 0 ? "text-green-600" : "text-red-600"
                )}>
                  {stats.totalDiff >= 0 ? "+" : ""}{formatBalance(stats.totalDiff)}
                </span>
              </div>

              {/* Search */}
              {mismatches.length > 0 && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by investor code or name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>
              )}

              {/* Results Table */}
              {filteredMismatches.length > 0 ? (
                <ScrollArea className="h-[300px] border rounded-md">
                  <table className="w-full text-sm">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-medium">Code</th>
                        <th className="text-left p-2 font-medium">Name</th>
                        <th className="text-right p-2 font-medium">
                          {date1 ? format(date1, "MMM d") : "Date 1"}
                        </th>
                        <th className="text-right p-2 font-medium">
                          {date2 ? format(date2, "MMM d") : "Date 2"}
                        </th>
                        <th className="text-right p-2 font-medium">Difference</th>
                        <th className="text-center p-2 font-medium">Type</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMismatches.map((item) => (
                        <tr key={item.investor_code} className="border-t hover:bg-muted/30">
                          <td className="p-2 font-mono text-xs">{item.investor_code}</td>
                          <td className="p-2 text-xs truncate max-w-[150px]">
                            {item.investor_name || "-"}
                          </td>
                          <td className="p-2 text-right font-mono text-xs">
                            {formatBalance(item.date1Balance)}
                          </td>
                          <td className="p-2 text-right font-mono text-xs">
                            {formatBalance(item.date2Balance)}
                          </td>
                          <td className={cn(
                            "p-2 text-right font-mono text-xs font-medium",
                            item.difference >= 0 ? "text-green-600" : "text-red-600"
                          )}>
                            {item.difference >= 0 ? "+" : ""}{formatBalance(item.difference)}
                            {item.percentChange !== null && (
                              <span className="text-muted-foreground ml-1">
                                ({item.percentChange >= 0 ? "+" : ""}{item.percentChange.toFixed(1)}%)
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-center">{getTypeIcon(item.type)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              ) : hasCompared && mismatches.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileSearch className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No significant differences found between these dates.</p>
                </div>
              ) : searchTerm && filteredMismatches.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  No results match your search.
                </div>
              ) : null}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
