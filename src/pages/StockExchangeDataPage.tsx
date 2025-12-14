import { MainLayout } from "@/components/layout/MainLayout";
import { StockExchangeUpload } from "@/components/stock-exchange/StockExchangeUpload";

const StockExchangeDataPage = () => {
  return (
    <MainLayout 
      title="Stock Exchange Data" 
      subtitle="Upload daily HTML files from DSE/CSE for compliance checks and balance reconciliation"
    >
      <StockExchangeUpload />
    </MainLayout>
  );
};

export default StockExchangeDataPage;
