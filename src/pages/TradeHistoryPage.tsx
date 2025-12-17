import { MainLayout } from "@/components/layout/MainLayout";
import { TradeHistoryTable } from "@/components/trade-history/TradeHistoryTable";
import { AgentCodesTable } from "@/components/trade-history/AgentCodesTable";
import { DepositsWithdrawalsTable } from "@/components/trade-history/DepositsWithdrawalsTable";
import { UploadHistoryTable } from "@/components/trade-history/UploadHistoryTable";
import AccountingTab from "@/components/trade-history/AccountingTab";
import { StockExchangeUpload } from "@/components/stock-exchange/StockExchangeUpload";
import { ClientTradeSearch } from "@/components/stock-exchange/ClientTradeSearch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { History, Users, ArrowDownUp, FileUp, Upload, Calculator } from "lucide-react";

const TradeHistoryPage = () => {
  return (
    <MainLayout title="Trade History" subtitle="View historical trade uploads, stock exchange data, and audit trails">
      <Tabs defaultValue="trades" className="space-y-4">
        <TabsList>
          <TabsTrigger value="trades" className="gap-2">
            <History className="h-4 w-4" />
            Trade History
          </TabsTrigger>
          <TabsTrigger value="stock-exchange" className="gap-2">
            <Upload className="h-4 w-4" />
            Stock Exchange
          </TabsTrigger>
          <TabsTrigger value="deposits" className="gap-2">
            <ArrowDownUp className="h-4 w-4" />
            Deposits/Withdrawals
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-2">
            <Users className="h-4 w-4" />
            Agent Codes
          </TabsTrigger>
          <TabsTrigger value="uploads" className="gap-2">
            <FileUp className="h-4 w-4" />
            Upload History
          </TabsTrigger>
          <TabsTrigger value="accounting" className="gap-2">
            <Calculator className="h-4 w-4" />
            Accounting
          </TabsTrigger>
        </TabsList>
        <TabsContent value="trades">
          <TradeHistoryTable />
        </TabsContent>
        <TabsContent value="stock-exchange">
          <div className="space-y-6">
            <ClientTradeSearch />
            <StockExchangeUpload />
          </div>
        </TabsContent>
        <TabsContent value="deposits">
          <DepositsWithdrawalsTable />
        </TabsContent>
        <TabsContent value="agents">
          <AgentCodesTable />
        </TabsContent>
        <TabsContent value="uploads">
          <UploadHistoryTable />
        </TabsContent>
        <TabsContent value="accounting">
          <AccountingTab />
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default TradeHistoryPage;
