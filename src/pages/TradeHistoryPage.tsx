import { MainLayout } from "@/components/layout/MainLayout";
import { TradeHistoryTable } from "@/components/trade-history/TradeHistoryTable";
import { DepositsWithdrawalsTable } from "@/components/trade-history/DepositsWithdrawalsTable";
import { UploadHistoryTable } from "@/components/trade-history/UploadHistoryTable";
import { StockExchangeUpload } from "@/components/stock-exchange/StockExchangeUpload";
import { ClientTradeSearch } from "@/components/stock-exchange/ClientTradeSearch";
import { ImportOpeningBalancesDialog } from "@/components/trade-history/ImportOpeningBalancesDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { History, ArrowDownUp, FileUp, Upload } from "lucide-react";
const TradeHistoryPage = () => {
  return (
    <MainLayout title="Trade History" subtitle="View historical trade uploads, stock exchange data, and audit trails">
      <Tabs defaultValue="stock-exchange" className="space-y-4">
        <div className="overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0">
          <TabsList className="inline-flex w-auto min-w-full sm:min-w-0">
            <TabsTrigger value="stock-exchange" className="gap-1 lg:gap-2 text-xs lg:text-sm px-2 lg:px-3">
              <Upload className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
              <span className="hidden sm:inline">Stock </span>Exchange
            </TabsTrigger>
            <TabsTrigger value="deposits" className="gap-1 lg:gap-2 text-xs lg:text-sm px-2 lg:px-3">
              <ArrowDownUp className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
              <span className="hidden sm:inline">Deposits/</span>Withdrawals
            </TabsTrigger>
            <TabsTrigger value="trades" className="gap-1 lg:gap-2 text-xs lg:text-sm px-2 lg:px-3">
              <History className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
              <span className="hidden sm:inline">Trade </span>History
            </TabsTrigger>
            <TabsTrigger value="uploads" className="gap-1 lg:gap-2 text-xs lg:text-sm px-2 lg:px-3">
              <FileUp className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
              <span className="hidden sm:inline">Upload </span>History
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="stock-exchange">
          <div className="space-y-6">
            <div className="flex justify-end">
              <ImportOpeningBalancesDialog />
            </div>
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
