import { MainLayout } from "@/components/layout/MainLayout";
import { TradeHistoryTable } from "@/components/trade-history/TradeHistoryTable";
import { DepositsWithdrawalsTable } from "@/components/trade-history/DepositsWithdrawalsTable";
import { UploadHistoryTable } from "@/components/trade-history/UploadHistoryTable";
import { StockExchangeUpload } from "@/components/stock-exchange/StockExchangeUpload";
import { ClientTradeSearch } from "@/components/stock-exchange/ClientTradeSearch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { History, ArrowDownUp, FileUp, Upload } from "lucide-react";

const TradeHistoryPage = () => {
  return (
    <MainLayout title="Trade History" subtitle="View historical trade uploads, stock exchange data, and audit trails">
      <Tabs defaultValue="stock-exchange" className="space-y-4">
        <TabsList>
          <TabsTrigger value="stock-exchange" className="gap-2">
            <Upload className="h-4 w-4" />
            Stock Exchange
          </TabsTrigger>
          <TabsTrigger value="deposits" className="gap-2">
            <ArrowDownUp className="h-4 w-4" />
            Deposits/Withdrawals
          </TabsTrigger>
          <TabsTrigger value="trades" className="gap-2">
            <History className="h-4 w-4" />
            Trade History
          </TabsTrigger>
          <TabsTrigger value="uploads" className="gap-2">
            <FileUp className="h-4 w-4" />
            Upload History
          </TabsTrigger>
        </TabsList>
        <TabsContent value="stock-exchange">
          <div className="space-y-6">
            <ClientTradeSearch />
            <StockExchangeUpload />
          </div>
        </TabsContent>
        <TabsContent value="deposits">
          <DepositsWithdrawalsTable />
        </TabsContent>
        <TabsContent value="trades">
          <TradeHistoryTable />
        </TabsContent>
        <TabsContent value="uploads">
          <UploadHistoryTable />
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default TradeHistoryPage;
