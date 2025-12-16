import { MainLayout } from "@/components/layout/MainLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InvestorsTable } from "@/components/investors/InvestorsTable";
import { InvestorLedgerTab } from "@/components/investors/InvestorLedgerTab";
import { PortfolioList } from "@/components/portfolio/PortfolioList";
import { CustomFieldsManager } from "@/components/portfolio/CustomFieldsManager";
import { PortfolioReports } from "@/components/portfolio/PortfolioReports";
import { Contact, BookOpen, Briefcase, Settings2, FileBarChart } from "lucide-react";

const InvestorsPage = () => {
  return (
    <MainLayout title="Investors" subtitle="Manage investor information, ledger statements, and portfolios">
      <Tabs defaultValue="investors" className="space-y-4">
        <TabsList>
          <TabsTrigger value="investors" className="gap-2">
            <Contact className="h-4 w-4" />
            Investors
          </TabsTrigger>
          <TabsTrigger value="ledger" className="gap-2">
            <BookOpen className="h-4 w-4" />
            Ledger Statement
          </TabsTrigger>
          <TabsTrigger value="portfolios" className="gap-2">
            <Briefcase className="h-4 w-4" />
            Portfolios
          </TabsTrigger>
          <TabsTrigger value="custom-fields" className="gap-2">
            <Settings2 className="h-4 w-4" />
            Custom Fields
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <FileBarChart className="h-4 w-4" />
            Reports
          </TabsTrigger>
        </TabsList>
        <TabsContent value="investors">
          <InvestorsTable />
        </TabsContent>
        <TabsContent value="ledger">
          <InvestorLedgerTab />
        </TabsContent>
        <TabsContent value="portfolios">
          <PortfolioList />
        </TabsContent>
        <TabsContent value="custom-fields">
          <CustomFieldsManager />
        </TabsContent>
        <TabsContent value="reports">
          <PortfolioReports />
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default InvestorsPage;
