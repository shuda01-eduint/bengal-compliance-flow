import { MainLayout } from "@/components/layout/MainLayout";
import { SecuritiesTable } from "@/components/securities/SecuritiesTable";

const SecuritiesPage = () => {
  return (
    <MainLayout title="Securities" subtitle="View and manage stock securities data">
      <SecuritiesTable />
    </MainLayout>
  );
};

export default SecuritiesPage;
