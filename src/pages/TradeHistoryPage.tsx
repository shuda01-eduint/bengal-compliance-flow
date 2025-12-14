import { MainLayout } from "@/components/layout/MainLayout";
import { TradeHistoryTable } from "@/components/trade-history/TradeHistoryTable";
import { AgentCodesTable } from "@/components/trade-history/AgentCodesTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { History, Users } from "lucide-react";

const TradeHistoryPage = () => {
  return (
    <MainLayout title="Trade History" subtitle="View historical trade uploads and audit trails">
      <Tabs defaultValue="trades" className="space-y-4">
        <TabsList>
          <TabsTrigger value="trades" className="gap-2">
            <History className="h-4 w-4" />
            Trade History
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-2">
            <Users className="h-4 w-4" />
            Agent Codes
          </TabsTrigger>
        </TabsList>
        <TabsContent value="trades">
          <TradeHistoryTable />
        </TabsContent>
        <TabsContent value="agents">
          <AgentCodesTable />
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default TradeHistoryPage;
