import { MainLayout } from "@/components/layout/MainLayout";
import { ViolationsDashboard } from "@/components/violations/ViolationsDashboard";

const ViolationsPage = () => {
  return (
    <MainLayout 
      title="Compliance Violations" 
      subtitle="Monitor and track trading violations across all account types"
    >
      <ViolationsDashboard />
    </MainLayout>
  );
};

export default ViolationsPage;
