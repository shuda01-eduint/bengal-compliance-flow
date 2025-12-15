import { MainLayout } from "@/components/layout/MainLayout";
import { AgentTradeDetailsTable } from "@/components/trade-history/AgentTradeDetailsTable";

const AgentsPage = () => {
  return (
    <MainLayout 
      title="Agents" 
      subtitle="Manage agent trade details, commissions and performance"
    >
      <AgentTradeDetailsTable />
    </MainLayout>
  );
};

export default AgentsPage;
