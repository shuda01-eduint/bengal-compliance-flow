import { MainLayout } from "@/components/layout/MainLayout";
import { TradeHistoryTable } from "@/components/trade-history/TradeHistoryTable";

const TradeHistoryPage = () => {
  return (
    <MainLayout title="Trade History" subtitle="View historical trade uploads and audit trails">
      <TradeHistoryTable />
    </MainLayout>
  );
};

export default TradeHistoryPage;
