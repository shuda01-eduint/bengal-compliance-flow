import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { SecuritiesTable } from "@/components/securities/SecuritiesTable";
import { HoldingsTable } from "@/components/securities/HoldingsTable";
import { CodeWiseHoldings } from "@/components/securities/CodeWiseHoldings";
import { RMWiseHoldings } from "@/components/securities/RMWiseHoldings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SecuritiesPage = () => {
  const [inventoryView, setInventoryView] = useState<"all" | "code-wise" | "rm-wise">("all");

  return (
    <MainLayout title="Securities" subtitle="View and manage securities and holdings data">
      <Tabs defaultValue="securities" className="w-full">
        <TabsList>
          <TabsTrigger value="securities">Securities</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
        </TabsList>
        <TabsContent value="securities" className="mt-4">
          <SecuritiesTable />
        </TabsContent>
        <TabsContent value="inventory" className="mt-4 space-y-4">
          {/* Sub-tabs for inventory views */}
          <div className="flex gap-2 border-b pb-2">
            <button
              onClick={() => setInventoryView("all")}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                inventoryView === "all"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              }`}
            >
              All Holdings
            </button>
            <button
              onClick={() => setInventoryView("code-wise")}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                inventoryView === "code-wise"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              }`}
            >
              Code-wise
            </button>
            <button
              onClick={() => setInventoryView("rm-wise")}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                inventoryView === "rm-wise"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted hover:bg-muted/80 text-muted-foreground"
              }`}
            >
              RM-wise
            </button>
          </div>
          
          {inventoryView === "all" && <HoldingsTable />}
          {inventoryView === "code-wise" && <CodeWiseHoldings />}
          {inventoryView === "rm-wise" && <RMWiseHoldings />}
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default SecuritiesPage;
