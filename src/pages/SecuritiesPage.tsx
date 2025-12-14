import { MainLayout } from "@/components/layout/MainLayout";
import { SecuritiesTable } from "@/components/securities/SecuritiesTable";
import { HoldingsTable } from "@/components/securities/HoldingsTable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SecuritiesPage = () => {
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
        <TabsContent value="inventory" className="mt-4">
          <HoldingsTable />
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default SecuritiesPage;
