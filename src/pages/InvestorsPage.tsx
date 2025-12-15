import { MainLayout } from "@/components/layout/MainLayout";
import { InvestorsTable } from "@/components/investors/InvestorsTable";

const InvestorsPage = () => {
  return (
    <MainLayout title="Investors" subtitle="Manage investor information and KYC data">
      <InvestorsTable />
    </MainLayout>
  );
};

export default InvestorsPage;
