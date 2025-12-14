import { MainLayout } from "@/components/layout/MainLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PortfolioList } from "@/components/portfolio/PortfolioList";
import { CustomFieldsManager } from "@/components/portfolio/CustomFieldsManager";
import { PortfolioReports } from "@/components/portfolio/PortfolioReports";
import { Briefcase, Settings2, FileBarChart } from "lucide-react";

const PortfolioPage = () => {
  return (
    <MainLayout title="Portfolio Management" subtitle="Create and manage customer portfolios with custom fields">
      <div className="space-y-6">
        <Tabs defaultValue="portfolios" className="space-y-4">
          <TabsList className="bg-card border border-border">
            <TabsTrigger value="portfolios" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Briefcase className="h-4 w-4 mr-2" />
              Portfolios
            </TabsTrigger>
            <TabsTrigger value="custom-fields" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <Settings2 className="h-4 w-4 mr-2" />
              Custom Fields
            </TabsTrigger>
            <TabsTrigger value="reports" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
              <FileBarChart className="h-4 w-4 mr-2" />
              Reports
            </TabsTrigger>
          </TabsList>

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
      </div>
    </MainLayout>
  );
};

export default PortfolioPage;
