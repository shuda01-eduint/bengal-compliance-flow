import { useState } from "react";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Wallet, TrendingUp, ArrowRightLeft, ShieldX } from "lucide-react";
import { ViolationCard } from "./ViolationCard";
import { ViolationsTable } from "./ViolationsTable";
import { ViolationsFilters } from "./ViolationsFilters";
import { useViolations, ViolationType } from "@/hooks/useViolations";
import { useDebounce } from "@/hooks/useDebounce";
import { NegativeBalanceThresholdFilter, ThresholdBadge } from "./NegativeBalanceThresholdFilter";
import * as XLSX from "xlsx";

export function ViolationsDashboard() {
  const [fromDate, setFromDate] = useState<Date | undefined>(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  );
  const [toDate, setToDate] = useState<Date | undefined>(new Date());
  const [searchTerm, setSearchTerm] = useState("");
  const [negativeBalanceThreshold, setNegativeBalanceThreshold] = useState<number | null>(null);
  const debouncedSearch = useDebounce(searchTerm, 300);

  const {
    summary,
    records,
    isLoading,
    activeFilter,
    setActiveFilter,
    refetchAll,
  } = useViolations(fromDate, toDate, debouncedSearch, negativeBalanceThreshold);

  const handleCardClick = (type: ViolationType) => {
    setActiveFilter(activeFilter === type ? "all" : type);
  };

  const handleExport = () => {
    if (!records.length) return;

    const exportData = records.map((r) => ({
      "Event Date": format(new Date(r.event_date), "dd MMM yyyy"),
      "Client Code": r.client_code,
      "Client Name": r.client_name,
      "Violation Type": r.violation_type.replace(/_/g, " ").toUpperCase(),
      "Amount": r.amount,
      "RM Name": r.rm_name,
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Violations");
    XLSX.writeFile(wb, `violations_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Violation Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ViolationCard
          title="Negative Balance (Cash)"
          icon={Wallet}
          count={summary.negative_balance.count}
          amount={summary.negative_balance.amount}
          variant="danger"
          isActive={activeFilter === "negative_balance"}
          onClick={() => handleCardClick("negative_balance")}
          isLoading={isLoading}
          filterComponent={
            <NegativeBalanceThresholdFilter
              threshold={negativeBalanceThreshold}
              onThresholdChange={setNegativeBalanceThreshold}
              variant="danger"
            />
          }
          filterBadge={
            negativeBalanceThreshold ? (
              <ThresholdBadge
                threshold={negativeBalanceThreshold}
                onClear={() => setNegativeBalanceThreshold(null)}
              />
            ) : null
          }
        />
        <ViolationCard
          title="Over Buy (Margin)"
          icon={TrendingUp}
          count={summary.over_buy.count}
          amount={summary.over_buy.amount}
          variant="warning"
          isActive={activeFilter === "over_buy"}
          onClick={() => handleCardClick("over_buy")}
          isLoading={isLoading}
        />
        <ViolationCard
          title="Z Group Adjustment"
          icon={ArrowRightLeft}
          count={summary.z_group_adjustment.count}
          amount={summary.z_group_adjustment.amount}
          variant="caution"
          isActive={activeFilter === "z_group_adjustment"}
          onClick={() => handleCardClick("z_group_adjustment")}
          isLoading={isLoading}
        />
        <ViolationCard
          title="Non-Margin Buy"
          icon={ShieldX}
          count={summary.non_margin_buy.count}
          amount={summary.non_margin_buy.amount}
          variant="info"
          isActive={activeFilter === "non_margin_buy"}
          onClick={() => handleCardClick("non_margin_buy")}
          isLoading={isLoading}
        />
      </div>

      {/* Filters */}
      <ViolationsFilters
        fromDate={fromDate}
        toDate={toDate}
        searchTerm={searchTerm}
        onFromDateChange={setFromDate}
        onToDateChange={setToDate}
        onSearchChange={setSearchTerm}
        onExport={handleExport}
        onRefresh={refetchAll}
        isExportDisabled={!records.length}
        isRefreshing={isLoading}
      />

      {/* Active Filter Indicator */}
      {activeFilter !== "all" && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Showing:</span>
          <button
            onClick={() => setActiveFilter("all")}
            className="text-sm font-medium text-primary hover:underline flex items-center gap-1"
          >
            {activeFilter.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
            <span className="text-muted-foreground">×</span>
          </button>
        </div>
      )}

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          <ViolationsTable records={records} isLoading={isLoading} activeFilter={activeFilter} />
        </CardContent>
      </Card>
    </div>
  );
}
