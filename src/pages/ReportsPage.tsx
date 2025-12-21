import { MainLayout } from "@/components/layout/MainLayout";
import { ReportsTable } from "@/components/reports/ReportsTable";
import { OverBuyReport } from "@/components/reports/OverBuyReport";
import { MerchantBankReport } from "@/components/reports/MerchantBankReport";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus, Download, Filter, AlertTriangle, FileText, Building2 } from "lucide-react";

const ReportsPage = () => {
  return (
    <MainLayout 
      title="Compliance Reports" 
      subtitle="Manage and track all regulatory and internal compliance reports"
    >
      <Tabs defaultValue="overbuy" className="space-y-4">
        <div className="overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0">
          <TabsList className="inline-flex w-auto min-w-full sm:min-w-0">
            <TabsTrigger value="overbuy" className="gap-1 lg:gap-2 text-xs lg:text-sm px-2 lg:px-3">
              <AlertTriangle className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
              <span className="hidden sm:inline">OverBuy </span>Monitor
            </TabsTrigger>
            <TabsTrigger value="merchant" className="gap-1 lg:gap-2 text-xs lg:text-sm px-2 lg:px-3">
              <Building2 className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
              <span className="hidden sm:inline">Merchant </span>Banks
            </TabsTrigger>
            <TabsTrigger value="general" className="gap-1 lg:gap-2 text-xs lg:text-sm px-2 lg:px-3">
              <FileText className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
              <span className="hidden sm:inline">General </span>Reports
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overbuy">
          <OverBuyReport />
        </TabsContent>

        <TabsContent value="merchant">
          <MerchantBankReport />
        </TabsContent>

        <TabsContent value="general">
          {/* Actions Bar */}
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center mb-6">
            <div className="flex gap-3">
              <Button className="btn-gradient-gold text-primary-foreground">
                <Plus className="h-4 w-4 mr-2" />
                New Report
              </Button>
              <Button variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
            <Button variant="secondary">
              <Filter className="h-4 w-4 mr-2" />
              Filters
            </Button>
          </div>
          {/* Reports Table */}
          <ReportsTable />
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default ReportsPage;
