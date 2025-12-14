import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface AgentCode {
  id: string;
  investor_code: string;
  agent_id: string;
  rm_id: string;
}

export interface AgentCodesByRM {
  [rmId: string]: {
    agents: { [agentId: string]: string[] };
    totalInvestors: number;
  };
}

export function useAgentCodes() {
  return useQuery({
    queryKey: ['agent-codes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_codes')
        .select('*')
        .order('rm_id', { ascending: true });
      
      if (error) throw error;
      return data as AgentCode[];
    },
  });
}

export function useAgentCodesByRM(rmId: string | undefined) {
  const { data: allCodes, isLoading, error } = useAgentCodes();
  
  const filteredCodes = allCodes?.filter(code => code.rm_id === rmId) || [];
  
  const groupedByAgent: { [agentId: string]: string[] } = {};
  filteredCodes.forEach(code => {
    if (!groupedByAgent[code.agent_id]) {
      groupedByAgent[code.agent_id] = [];
    }
    groupedByAgent[code.agent_id].push(code.investor_code);
  });
  
  return {
    codes: filteredCodes,
    groupedByAgent,
    totalAgents: Object.keys(groupedByAgent).length,
    totalInvestors: filteredCodes.length,
    isLoading,
    error,
  };
}

export function getAgentCodesGroupedByRM(codes: AgentCode[]): AgentCodesByRM {
  const grouped: AgentCodesByRM = {};
  
  codes.forEach(code => {
    if (!grouped[code.rm_id]) {
      grouped[code.rm_id] = { agents: {}, totalInvestors: 0 };
    }
    if (!grouped[code.rm_id].agents[code.agent_id]) {
      grouped[code.rm_id].agents[code.agent_id] = [];
    }
    grouped[code.rm_id].agents[code.agent_id].push(code.investor_code);
    grouped[code.rm_id].totalInvestors++;
  });
  
  return grouped;
}
