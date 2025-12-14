import { MainLayout } from "@/components/layout/MainLayout";
import { ReportsTable } from "@/components/reports/ReportsTable";
import { Button } from "@/components/ui/button";
import { Plus, Download, Filter } from "lucide-react";

const ReportsPage = () => {
  return (
    <MainLayout 
      title="Compliance Reports" 
      subtitle="Manage and track all regulatory and internal compliance reports"
    >
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
    </MainLayout>
  );
};

export default ReportsPage;
