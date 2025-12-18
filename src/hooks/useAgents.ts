import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Agent {
  id: string;
  agent_id: string;
  name: string;
  commission_rate: number | null;
  bank_account: string | null;
  routing_number: string | null;
  bank_name: string | null;
  tin_number: string | null;
  nid_number: string | null;
  rm_id: string;
  rm_name: string | null;
  status: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .order("agent_id", { ascending: true });

      if (error) throw error;
      return data as Agent[];
    },
  });
}
