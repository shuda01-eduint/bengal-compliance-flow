import { MainLayout } from "@/components/layout/MainLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DashboardTab } from "@/components/margin-loan/DashboardTab";
import { ClientAccountsTab } from "@/components/margin-loan/ClientAccountsTab";
import { MarginCallsTab } from "@/components/margin-loan/MarginCallsTab";
import { SecuritiesEligibilityTab } from "@/components/margin-loan/SecuritiesEligibilityTab";
import { ConcentrationRiskTab } from "@/components/margin-loan/ConcentrationRiskTab";
import { ReportsTab } from "@/components/margin-loan/ReportsTab";
import { 
  LayoutDashboard, 
  Users, 
  AlertTriangle, 
  Shield, 
  PieChart, 
  FileText 
} from "lucide-react";

const MarginLoanPage = () => {
  return (
    <MainLayout 
      title="Margin Loan Management" 
      subtitle="Monitor margin accounts, collateral, and risk exposure"
    >
      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="dashboard" className="gap-2">
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="accounts" className="gap-2">
            <Users className="h-4 w-4" />
            Client Accounts
          </TabsTrigger>
          <TabsTrigger value="margin-calls" className="gap-2">
            <AlertTriangle className="h-4 w-4" />
            Margin Calls
          </TabsTrigger>
          <TabsTrigger value="eligibility" className="gap-2">
            <Shield className="h-4 w-4" />
            Securities Eligibility
          </TabsTrigger>
          <TabsTrigger value="concentration" className="gap-2">
            <PieChart className="h-4 w-4" />
            Concentration Risk
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <FileText className="h-4 w-4" />
            Reports
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard">
          <DashboardTab />
        </TabsContent>
        <TabsContent value="accounts">
          <ClientAccountsTab />
        </TabsContent>
        <TabsContent value="margin-calls">
          <MarginCallsTab />
        </TabsContent>
        <TabsContent value="eligibility">
          <SecuritiesEligibilityTab />
        </TabsContent>
        <TabsContent value="concentration">
          <ConcentrationRiskTab />
        </TabsContent>
        <TabsContent value="reports">
          <ReportsTab />
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default MarginLoanPage;
