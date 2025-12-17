import { MainLayout } from "@/components/layout/MainLayout";
import AccountingTab from "@/components/trade-history/AccountingTab";

const AccountingPage = () => {
  return (
    <MainLayout title="Accounting" subtitle="View consolidated investor accounting data with reconciliation details">
      <AccountingTab />
    </MainLayout>
  );
};

export default AccountingPage;
