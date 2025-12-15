import { MainLayout } from "@/components/layout/MainLayout";
import { TradeHistoryTable } from "@/components/trade-history/TradeHistoryTable";
import { AgentCodesTable } from "@/components/trade-history/AgentCodesTable";
import { DepositsWithdrawalsTable } from "@/components/trade-history/DepositsWithdrawalsTable";
import { AgentTradeDetailsTable } from "@/components/trade-history/AgentTradeDetailsTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { History, Users, ArrowDownUp, UserCheck } from "lucide-react";

const TradeHistoryPage = () => {
  return (
    <MainLayout title="Trade History" subtitle="View historical trade uploads and audit trails">
      <Tabs defaultValue="trades" className="space-y-4">
        <TabsList>
          <TabsTrigger value="trades" className="gap-2">
            <History className="h-4 w-4" />
            Trade History
          </TabsTrigger>
          <TabsTrigger value="deposits" className="gap-2">
            <ArrowDownUp className="h-4 w-4" />
            Deposits/Withdrawals
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-2">
            <Users className="h-4 w-4" />
            Agent Codes
          </TabsTrigger>
          <TabsTrigger value="agent-trades" className="gap-2">
            <UserCheck className="h-4 w-4" />
            Agent Trade Details
          </TabsTrigger>
        </TabsList>
        <TabsContent value="trades">
          <TradeHistoryTable />
        </TabsContent>
        <TabsContent value="deposits">
          <DepositsWithdrawalsTable />
        </TabsContent>
        <TabsContent value="agents">
          <AgentCodesTable />
        </TabsContent>
        <TabsContent value="agent-trades">
          <AgentTradeDetailsTable />
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default TradeHistoryPage;
