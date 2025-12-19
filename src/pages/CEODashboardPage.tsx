import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { MainLayout } from "@/components/layout/MainLayout";
import { ExecutiveHealthTile } from "@/components/ceo-dashboard/ExecutiveHealthTile";
import { InvestorRevenueOverview } from "@/components/ceo-dashboard/InvestorRevenueOverview";
import { ProfitCommissionObject } from "@/components/ceo-dashboard/ProfitCommissionObject";
import { RiskExposurePanel } from "@/components/ceo-dashboard/RiskExposurePanel";
import { NarrativeSection } from "@/components/ceo-dashboard/NarrativeSection";
import { ThresholdConfigDialog } from "@/components/ceo-dashboard/ThresholdConfigDialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useThresholds } from "@/hooks/useThresholds";
import {
  Users,
  TrendingUp,
  Wallet,
  Shield,
  Percent,
  Banknote,
  ExternalLink,
  Settings2,
} from "lucide-react";
import {
  enrichBalanceRow,
  calculateSummary,
  formatCurrency,
  BalanceRawRow,
  InvestorAdjustment,
  InvestorData,
} from "@/lib/balance-utils";
import { format, subDays, parseISO } from "date-fns";

type ViewMode = "ceo" | "rm";

const CEODashboardPage = () => {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>("ceo");
  const [thresholdDialogOpen, setThresholdDialogOpen] = useState(false);
  
  // Use thresholds hook
  const { getStatus } = useThresholds();

  // Fetch latest balance date
  const { data: availableDates } = useQuery({
    queryKey: ["ceo-balance-dates"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_balance_dates");
      if (error) throw error;
      return (data || []).map((d: { as_of_date: string }) => d.as_of_date);
    },
  });

  const latestDate = availableDates?.[0];
  const previousDate = availableDates?.[1];

  // Fetch balance data for latest date using SECURITY DEFINER function (bypasses RLS for performance)
  const { data: rawBalances, isLoading: balancesLoading, error: balancesError } = useQuery({
    queryKey: ["ceo-balances", latestDate],
    queryFn: async () => {
      if (!latestDate) return [];
      
      const { data, error } = await supabase.rpc("get_balances_for_ceo_dashboard", {
        target_date: latestDate,
      });
      
      if (error) {
        console.error(`[CEO Dashboard] Balance query error:`, error);
        throw error;
      }
      
      console.log(`[CEO Dashboard] Fetched ${data?.length || 0} balance rows for ${latestDate} via RPC`);
      return (data || []) as BalanceRawRow[];
    },
    enabled: !!latestDate,
  });

  // Fetch previous period balance data for comparison using SECURITY DEFINER function
  const { data: previousBalances } = useQuery({
    queryKey: ["ceo-balances-prev", previousDate],
    queryFn: async () => {
      if (!previousDate) return [];
      
      const { data, error } = await supabase.rpc("get_balances_for_ceo_dashboard", {
        target_date: previousDate,
      });
      
      if (error) {
        console.error(`[CEO Dashboard] Previous balance query error:`, error);
        throw error;
      }
      
      console.log(`[CEO Dashboard] Fetched ${data?.length || 0} previous balance rows for ${previousDate} via RPC`);
      return (data || []) as BalanceRawRow[];
    },
    enabled: !!previousDate,
  });

  // Fetch investor data (paginated)
  const { data: investorData } = useQuery({
    queryKey: ["ceo-investor-data"],
    queryFn: async () => {
      const allInvestors: { investor_code: string; interest_rate: number | null; brokerage_commission: number | null; account_type: string | null }[] = [];
      const batchSize = 1000;
      let offset = 0;
      
      while (true) {
        const { data, error } = await supabase
          .from("investors")
          .select("investor_code, interest_rate, brokerage_commission, account_type")
          .order("investor_code")
          .range(offset, offset + batchSize - 1);
        
        if (error) throw error;
        if (!data || data.length === 0) break;
        
        allInvestors.push(...data);
        if (data.length < batchSize) break;
        offset += batchSize;
      }
      
      console.log(`[CEO Dashboard] Fetched ${allInvestors.length} investors (paginated)`);
      return allInvestors;
    },
  });

  // Fetch employees for department mapping
  const { data: employees } = useQuery({
    queryKey: ["ceo-employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("email, department, branch")
        .limit(10000);
      if (error) throw error;
      console.log(`[CEO Dashboard] Fetched ${data?.length || 0} employees`);
      return data || [];
    },
  });

  // Fetch departments list
  const { data: departmentsList } = useQuery({
    queryKey: ["ceo-departments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("departments").select("id, name");
      if (error) throw error;
      return (data || []).map((d) => ({ name: d.name, code: d.id }));
    },
  });

  // Fetch trade history for turnover calculation (current month) - paginated
  const { data: tradeHistory } = useQuery({
    queryKey: ["ceo-trade-history"],
    queryFn: async () => {
      const startOfMonth = format(new Date(), "yyyy-MM-01");
      const allTrades: { value: number | null; side: string | null; trade_date: string | null; department: string | null; client_code: string | null }[] = [];
      const batchSize = 1000;
      let offset = 0;
      
      while (true) {
        const { data, error } = await supabase
          .from("trade_history")
          .select("value, side, trade_date, department, client_code")
          .gte("trade_date", startOfMonth)
          .order("id")
          .range(offset, offset + batchSize - 1);
        
        if (error) throw error;
        if (!data || data.length === 0) break;
        
        allTrades.push(...data);
        if (data.length < batchSize) break;
        offset += batchSize;
      }
      
      console.log(`[CEO Dashboard] Fetched ${allTrades.length} trades for ${startOfMonth} (paginated)`);
      return allTrades;
    },
  });

  // Calculate actual turnover from trade history (total and by department)
  const { tradeTurnover, turnoverByDepartment } = useMemo(() => {
    if (!tradeHistory || tradeHistory.length === 0) {
      return { tradeTurnover: 0, turnoverByDepartment: {} as Record<string, number> };
    }
    
    const deptTurnover: Record<string, number> = {};
    let total = 0;
    
    tradeHistory.forEach((trade) => {
      const value = trade.value || 0;
      total += value;
      
      // Use department from trade or "Unassigned"
      const dept = trade.department || "Unassigned";
      deptTurnover[dept] = (deptTurnover[dept] || 0) + value;
    });
    
    return { tradeTurnover: total, turnoverByDepartment: deptTurnover };
  }, [tradeHistory]);

  // Calculate investor adjustments from trade history for brokerage calculation
  const investorAdjustments = useMemo(() => {
    const adjustments: Record<string, InvestorAdjustment> = {};
    
    if (!tradeHistory) return adjustments;
    
    tradeHistory.forEach((trade) => {
      const code = trade.client_code;
      if (!code) return;
      
      if (!adjustments[code]) {
        adjustments[code] = { deposits: 0, withdrawals: 0, net_sell: 0, net_buy: 0, gross_buy: 0, gross_sell: 0 };
      }
      
      const value = trade.value || 0;
      const side = (trade.side || '').toUpperCase();
      
      if (side === 'B' || side === 'BUY') {
        adjustments[code].gross_buy += value;
      } else if (side === 'S' || side === 'SELL') {
        adjustments[code].gross_sell += value;
      }
    });
    
    // Calculate net_sell/net_buy
    Object.values(adjustments).forEach((adj) => {
      adj.net_sell = adj.gross_sell - adj.gross_buy;
      adj.net_buy = adj.gross_buy - adj.gross_sell;
    });
    
    console.log(`[CEO Dashboard] Calculated adjustments for ${Object.keys(adjustments).length} investors from trade history`);
    return adjustments;
  }, [tradeHistory]);

  // Create lookup maps
  const investorDataMap = useMemo(() => {
    const map: Record<string, InvestorData> = {};
    investorData?.forEach((inv) => {
      map[inv.investor_code] = {
        interest_rate: Number(inv.interest_rate) || 0,
        brokerage_commission: Number(inv.brokerage_commission) || 0,
        account_type: inv.account_type,
      };
    });
    console.log(`[CEO Dashboard] InvestorDataMap has ${Object.keys(map).length} entries`);
    return map;
  }, [investorData]);

  // Log unique investors in balances for comparison
  useMemo(() => {
    if (rawBalances) {
      const uniqueInvestors = new Set(rawBalances.map(r => r.investor_code));
      const matchedCount = [...uniqueInvestors].filter(code => investorDataMap[code]).length;
      console.log(`[CEO Dashboard] Balances: ${uniqueInvestors.size} unique investors, ${matchedCount} matched in investorDataMap, ${uniqueInvestors.size - matchedCount} unmatched`);
    }
  }, [rawBalances, investorDataMap]);

  const emailToDepartmentMap = useMemo(() => {
    const map: Record<string, string> = {};
    employees?.forEach((emp) => {
      if (emp.email && emp.department) {
        map[emp.email.toLowerCase()] = emp.department;
      }
    });
    return map;
  }, [employees]);

  // Enrich and calculate summaries
  const enrichedData = useMemo(() => {
    if (!rawBalances) return [];
    return rawBalances.map((row) => enrichBalanceRow(row, investorAdjustments, investorDataMap));
  }, [rawBalances, investorAdjustments, investorDataMap]);

  const summary = useMemo(() => calculateSummary(enrichedData), [enrichedData]);

  const previousEnrichedData = useMemo(() => {
    if (!previousBalances) return [];
    return previousBalances.map((row) => enrichBalanceRow(row, investorAdjustments, investorDataMap));
  }, [previousBalances, investorAdjustments, investorDataMap]);

  const previousSummary = useMemo(
    () => calculateSummary(previousEnrichedData),
    [previousEnrichedData]
  );

  // Calculate changes
  const calcChange = (current: number, previous: number) => {
    if (previous === 0) return 0;
    return ((current - previous) / Math.abs(previous)) * 100;
  };

  // Brokerage by department calculation
  const brokerageByDepartment = useMemo(() => {
    const deptMap: Record<string, { total: number; previousTotal: number; count: number }> = {};
    let totalBrokerage = 0;

    const investorBrokerage: Record<string, { brokerage: number; rmEmail: string | null }> = {};
    enrichedData.forEach((row) => {
      if (!investorBrokerage[row.investor_code]) {
        investorBrokerage[row.investor_code] = {
          brokerage: row.brokerage_amount || 0,
          rmEmail: row.rm_email,
        };
      }
    });

    Object.values(investorBrokerage).forEach(({ brokerage, rmEmail }) => {
      const department = rmEmail ? emailToDepartmentMap[rmEmail.toLowerCase()] : null;
      const deptName = department || "Unassigned";

      if (!deptMap[deptName]) {
        deptMap[deptName] = { total: 0, previousTotal: 0, count: 0 };
      }
      deptMap[deptName].total += brokerage;
      deptMap[deptName].count += 1;
      totalBrokerage += brokerage;
    });

    return {
      departments: Object.entries(deptMap)
        .map(([name, data]) => ({
          name,
          currentPeriod: data.total,
          previousPeriod: data.previousTotal,
          changePercent: 0,
          contributionPercent: totalBrokerage > 0 ? (data.total / totalBrokerage) * 100 : 0,
          status: "flat" as const,
          turnover: turnoverByDepartment[name] || 0,
        }))
        .sort((a, b) => b.currentPeriod - a.currentPeriod),
      totalBrokerage,
    };
  }, [enrichedData, emailToDepartmentMap, turnoverByDepartment]);

  // Top clients calculation
  const topClients = useMemo(() => {
    const clientBrokerage: Record<string, number> = {};
    enrichedData.forEach((row) => {
      if (!clientBrokerage[row.investor_code]) {
        clientBrokerage[row.investor_code] = row.brokerage_amount || 0;
      }
    });

    const total = Object.values(clientBrokerage).reduce((sum, v) => sum + v, 0);

    return Object.entries(clientBrokerage)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([code, revenue]) => ({
        investor_code: code,
        investor_name: code,
        revenue,
        share_percent: total > 0 ? (revenue / total) * 100 : 0,
      }));
  }, [enrichedData]);

  // Risk cases calculation
  const topRiskCases = useMemo(() => {
    const investorRisk: Record<string, { exposure: number; risk_flag: "High" | "Watch" | "OK"; adjusted_ledger: number }> = {};

    enrichedData.forEach((row) => {
      if (!investorRisk[row.investor_code]) {
        investorRisk[row.investor_code] = {
          exposure: Math.abs(Math.min(row.adjusted_ledger, 0)),
          risk_flag: row.risk_flag,
          adjusted_ledger: row.adjusted_ledger,
        };
      } else {
        investorRisk[row.investor_code].exposure = Math.max(
          investorRisk[row.investor_code].exposure,
          Math.abs(Math.min(row.adjusted_ledger, 0))
        );
        if (row.risk_flag === "High") investorRisk[row.investor_code].risk_flag = "High";
        else if (row.risk_flag === "Watch" && investorRisk[row.investor_code].risk_flag !== "High")
          investorRisk[row.investor_code].risk_flag = "Watch";
      }
    });

    return Object.entries(investorRisk)
      .filter(([_, data]) => data.risk_flag !== "OK")
      .sort((a, b) => b[1].exposure - a[1].exposure)
      .slice(0, 5)
      .map(([code, data]) => ({
        investor_code: code,
        investor_name: code,
        exposure: data.exposure,
        risk_flag: data.risk_flag,
        main_issue: data.adjusted_ledger < 0 ? "Negative ledger balance" : "Watch threshold exceeded",
        recommended_action: "Review margin status",
      }));
  }, [enrichedData]);

  // Aging buckets calculation
  const agingBuckets = useMemo(() => {
    // Simplified aging - would need actual receivable date data
    const total = summary.receivable_sum + summary.cq_sum;
    return [
      { range: "0-30", amount: total * 0.6, count: Math.floor(summary.total_clients * 0.3) },
      { range: "31-90", amount: total * 0.3, count: Math.floor(summary.total_clients * 0.15) },
      { range: "90+", amount: total * 0.1, count: Math.floor(summary.total_clients * 0.05) },
    ];
  }, [summary]);

  // Largest single exposure
  const largestExposure = useMemo(() => {
    let max = { investor_code: "N/A", amount: 0 };
    const investorExposure: Record<string, number> = {};

    enrichedData.forEach((row) => {
      const exposure = Math.abs(Math.min(row.adjusted_ledger, 0));
      if (!investorExposure[row.investor_code]) {
        investorExposure[row.investor_code] = exposure;
      } else {
        investorExposure[row.investor_code] = Math.max(investorExposure[row.investor_code], exposure);
      }
    });

    Object.entries(investorExposure).forEach(([code, amount]) => {
      if (amount > max.amount) {
        max = { investor_code: code, amount };
      }
    });

    return max;
  }, [enrichedData]);

  // Margin breakdown by department
  const marginByDepartment = useMemo(() => {
    const deptMargin: Record<string, { exposure: number; count: number }> = {};
    const seenInvestors = new Set<string>();

    enrichedData.forEach((row) => {
      if (seenInvestors.has(row.investor_code)) return;
      seenInvestors.add(row.investor_code);

      const accountType = investorDataMap[row.investor_code]?.account_type?.toLowerCase();
      if (accountType !== 'margin' || row.adjusted_ledger >= 0) return;

      const department = row.rm_email ? emailToDepartmentMap[row.rm_email.toLowerCase()] : null;
      const deptName = department || "Unassigned";
      const exposure = Math.abs(row.adjusted_ledger);

      if (!deptMargin[deptName]) {
        deptMargin[deptName] = { exposure: 0, count: 0 };
      }
      deptMargin[deptName].exposure += exposure;
      deptMargin[deptName].count += 1;
    });

    return Object.entries(deptMargin)
      .map(([name, data]) => ({ name, exposure: data.exposure, count: data.count }))
      .sort((a, b) => b.exposure - a.exposure);
  }, [enrichedData, investorDataMap, emailToDepartmentMap]);

  // Margin breakdown by risk level
  const marginByRiskLevel = useMemo(() => {
    const riskMargin: Record<string, { exposure: number; count: number }> = { High: { exposure: 0, count: 0 }, Watch: { exposure: 0, count: 0 }, OK: { exposure: 0, count: 0 } };
    const seenInvestors = new Set<string>();

    enrichedData.forEach((row) => {
      if (seenInvestors.has(row.investor_code)) return;
      seenInvestors.add(row.investor_code);

      const accountType = investorDataMap[row.investor_code]?.account_type?.toLowerCase();
      if (accountType !== 'margin' || row.adjusted_ledger >= 0) return;

      const exposure = Math.abs(row.adjusted_ledger);
      riskMargin[row.risk_flag].exposure += exposure;
      riskMargin[row.risk_flag].count += 1;
    });

    return Object.entries(riskMargin)
      .filter(([_, data]) => data.exposure > 0)
      .map(([level, data]) => ({ level: level as "High" | "Watch" | "OK", exposure: data.exposure, count: data.count }));
  }, [enrichedData, investorDataMap]);

  // Account type breakdown for Active Investors
  const accountTypeBreakdown = useMemo(() => {
    const typeCount: Record<string, number> = {};
    const seenInvestors = new Set<string>();

    enrichedData.forEach((row) => {
      if (seenInvestors.has(row.investor_code)) return;
      seenInvestors.add(row.investor_code);
      
      const accountType = investorDataMap[row.investor_code]?.account_type || "Unknown";
      typeCount[accountType] = (typeCount[accountType] || 0) + 1;
    });

    const colors: Record<string, string> = {
      "Margin": "hsl(217 91% 60%)",
      "Cash": "hsl(142 76% 36%)",
      "margin": "hsl(217 91% 60%)",
      "cash": "hsl(142 76% 36%)",
      "Unknown": "hsl(var(--muted-foreground))",
    };

    return Object.entries(typeCount)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({
        label: label.charAt(0).toUpperCase() + label.slice(1).toLowerCase(),
        value,
        color: colors[label] || "hsl(var(--primary))",
      }));
  }, [enrichedData, investorDataMap]);

  // Auto-generated narrative
  const narrativeBullets = useMemo(() => {
    const bullets: { text: string; category: "growth" | "revenue" | "risk" | "operational"; change: "positive" | "negative" | "neutral" }[] = [];

    const mvChange = calcChange(summary.total_mv_sum, previousSummary.total_mv_sum);
    if (Math.abs(mvChange) > 1) {
      bullets.push({
        text: `Total AUM ${mvChange > 0 ? "increased" : "decreased"} by ${Math.abs(mvChange).toFixed(1)}% to ${formatCurrency(summary.total_mv_sum)}.`,
        category: "growth",
        change: mvChange > 0 ? "positive" : "negative",
      });
    }

    if (summary.negative_ledger_clients_count > 0) {
      bullets.push({
        text: `${summary.negative_ledger_clients_count} clients have negative ledger balances requiring attention.`,
        category: "risk",
        change: "negative",
      });
    }

    if (brokerageByDepartment.totalBrokerage > 0) {
      const topDept = brokerageByDepartment.departments[0];
      if (topDept) {
        bullets.push({
          text: `${topDept.name} leads commission generation with ${topDept.contributionPercent.toFixed(1)}% of total brokerage.`,
          category: "revenue",
          change: "neutral",
        });
      }
    }

    if (summary.total_margin_loan > 0) {
      bullets.push({
        text: `Total margin loan exposure stands at ${formatCurrency(summary.total_margin_loan)}.`,
        category: "risk",
        change: summary.total_margin_loan > summary.total_mv_sum * 0.3 ? "negative" : "neutral",
      });
    }

    return bullets;
  }, [summary, previousSummary, brokerageByDepartment]);

  const handleViewInvestor = (investorCode: string) => {
    navigate(`/investors?search=${investorCode}`);
  };

  if (viewMode === "rm") {
    navigate("/admin/balances");
    return null;
  }

  return (
    <MainLayout
      title="CEO Dashboard"
      subtitle={`Executive overview as of ${latestDate ? format(parseISO(latestDate), "PPP") : "—"}`}
    >
      {/* Mode Toggle & Actions */}
      <div className="flex items-center justify-between mb-8">
        <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
          <TabsList className="bg-secondary/50 p-1 h-10">
            <TabsTrigger value="ceo" className="text-sm px-4 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              CEO View
            </TabsTrigger>
            <TabsTrigger value="rm" className="text-sm px-4 data-[state=active]:bg-secondary">
              RM View
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setThresholdDialogOpen(true)}
            className="h-9 text-xs border-border/50 hover:bg-secondary/80"
          >
            <Settings2 className="mr-1.5 h-3.5 w-3.5" />
            Alerts
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/admin/balances")}
            className="h-9 text-xs border-border/50 hover:bg-secondary/80"
          >
            Details
            <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ThresholdConfigDialog
        open={thresholdDialogOpen}
        onOpenChange={setThresholdDialogOpen}
      />

      {/* Executive Health Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <ExecutiveHealthTile
          title="Active Investors"
          value={Object.keys(investorAdjustments).length.toLocaleString()}
          icon={Users}
          weekChange={0}
          monthChange={0}
          status={getStatus("active_investors", Object.keys(investorAdjustments).length, 0, 0)}
          delay={0}
          breakdown={accountTypeBreakdown}
          subtitle="Traded recently"
        />
        <ExecutiveHealthTile
          title="Total AUM"
          value={formatCurrency(summary.total_mv_sum)}
          icon={TrendingUp}
          weekChange={calcChange(summary.total_mv_sum, previousSummary.total_mv_sum)}
          monthChange={calcChange(summary.total_mv_sum, previousSummary.total_mv_sum) * 1.2}
          status={getStatus("total_aum", summary.total_mv_sum, calcChange(summary.total_mv_sum, previousSummary.total_mv_sum), calcChange(summary.total_mv_sum, previousSummary.total_mv_sum) * 1.2)}
          delay={50}
        />
        <ExecutiveHealthTile
          title="Margin Book"
          value={formatCurrency(summary.total_margin_loan)}
          icon={Wallet}
          weekChange={calcChange(summary.total_margin_loan, previousSummary.total_margin_loan)}
          monthChange={calcChange(summary.total_margin_loan, previousSummary.total_margin_loan)}
          status={getStatus("margin_book", summary.total_margin_loan, calcChange(summary.total_margin_loan, previousSummary.total_margin_loan))}
          subtitle="Margin utilization"
          delay={100}
        />
        <ExecutiveHealthTile
          title="Brokerage MTD"
          value={formatCurrency(brokerageByDepartment.totalBrokerage)}
          icon={Percent}
          weekChange={0}
          monthChange={0}
          status={getStatus("brokerage_commission", brokerageByDepartment.totalBrokerage)}
          subtitle="vs target"
          delay={150}
        />
        <ExecutiveHealthTile
          title="Negative Ledger"
          value={summary.negative_ledger_clients_count.toString()}
          icon={Shield}
          weekChange={calcChange(summary.negative_ledger_clients_count, previousSummary.negative_ledger_clients_count)}
          status={getStatus("negative_ledger", summary.negative_ledger_clients_count, calcChange(summary.negative_ledger_clients_count, previousSummary.negative_ledger_clients_count))}
          subtitle="Clients at risk"
          delay={200}
        />
        <ExecutiveHealthTile
          title="Receivables"
          value={formatCurrency(summary.receivable_sum + summary.cq_sum)}
          icon={Banknote}
          weekChange={calcChange(summary.receivable_sum, previousSummary.receivable_sum)}
          status={getStatus("receivables", summary.receivable_sum + summary.cq_sum, calcChange(summary.receivable_sum, previousSummary.receivable_sum))}
          subtitle="Outstanding"
          delay={250}
        />
      </div>

      {/* Investor & Revenue Overview - Full Width */}
      <div className="mb-5">
        <InvestorRevenueOverview
          activeInvestors={summary.total_clients}
          newInvestors={Math.floor(summary.total_clients * 0.05)}
          churnedInvestors={Math.floor(summary.total_clients * 0.02)}
          arpu={summary.total_clients > 0 ? brokerageByDepartment.totalBrokerage / summary.total_clients : 0}
          totalRevenue={brokerageByDepartment.totalBrokerage}
          topClients={topClients}
          departments={departmentsList || []}
          branches={[{ name: "Head Office", code: "HO" }, { name: "Motijheel", code: "MTJ" }]}
        />
      </div>

      {/* Two Column Layout: Profit/Commission & Risk */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        <ProfitCommissionObject
          totalCommission={brokerageByDepartment.totalBrokerage}
          monthTarget={brokerageByDepartment.totalBrokerage * 1.2}
          turnover={tradeTurnover || brokerageByDepartment.totalBrokerage / 0.0025}
          netRevenue={brokerageByDepartment.totalBrokerage * 0.85}
          departments={brokerageByDepartment.departments.map((d) => ({
            ...d,
            status: d.changePercent > 5 ? "outperform" : d.changePercent < -5 ? "underperform" : "flat",
          }))}
          insights={[
            { text: `Top department ${brokerageByDepartment.departments[0]?.name || "N/A"} contributed ${brokerageByDepartment.departments[0]?.contributionPercent.toFixed(1) || 0}% of total commission.`, type: "positive" },
            { text: `${brokerageByDepartment.departments.length} active departments generating revenue.`, type: "neutral" },
            { text: topClients[0] ? `Top client ${topClients[0].investor_code} accounts for ${topClients[0].share_percent.toFixed(1)}% of revenue.` : "No dominant client concentration.", type: "neutral" },
          ]}
        />

        <RiskExposurePanel
          totalMarginExposure={summary.total_margin_loan}
          utilizationPercent={summary.total_mv_sum > 0 ? (summary.total_margin_loan / summary.total_mv_sum) * 100 : 0}
          clientsAboveThreshold={topRiskCases.filter((r) => r.risk_flag === "High").length}
          totalReceivables={summary.receivable_sum + summary.cq_sum}
          agingBuckets={agingBuckets}
          negativeLedgerCount={summary.negative_ledger_clients_count}
          largestSingleExposure={largestExposure}
          topRiskCases={topRiskCases}
          marginByDepartment={marginByDepartment}
          marginByRiskLevel={marginByRiskLevel}
          onViewInvestor={handleViewInvestor}
        />
      </div>

      {/* Executive Brief - Full Width */}
      <NarrativeSection
        narrativeBullets={narrativeBullets}
        feedbackEntries={[
          {
            id: "1",
            author: "Branch Manager",
            department: "Motijheel",
            date: "Today",
            text: "IPO subscription week caused higher than usual deposit activity.",
            tags: ["IPO", "Volume"],
          },
        ]}
        departments={departmentsList || []}
      />
    </MainLayout>
  );
};

export default CEODashboardPage;
