import { MainLayout } from "@/components/layout/MainLayout";
import { StockExchangeUpload } from "@/components/stock-exchange/StockExchangeUpload";
import { ClientTradeSearch } from "@/components/stock-exchange/ClientTradeSearch";

const StockExchangeDataPage = () => {
  return (
    <MainLayout 
      title="Stock Exchange Data" 
      subtitle="Upload daily HTML files from DSE/CSE for compliance checks and balance reconciliation"
    >
      <div className="space-y-6">
        <ClientTradeSearch />
        <StockExchangeUpload />
      </div>
    </MainLayout>
  );
};

export default StockExchangeDataPage;
