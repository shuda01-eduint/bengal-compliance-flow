import { MainLayout } from "@/components/layout/MainLayout";
import { NegativeBalanceReport } from "@/components/violations/NegativeBalanceReport";

const ViolationsPage = () => {
  return (
    <MainLayout title="Negative Balance Violations" subtitle="Clients with negative closing balance after trades and deposits/withdrawals">
      <NegativeBalanceReport />
    </MainLayout>
  );
};

export default ViolationsPage;
