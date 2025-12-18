import { Agent } from "@/hooks/useAgents";
import { Badge } from "@/components/ui/badge";
import { TableCell, TableRow } from "@/components/ui/table";

interface AgentListItemProps {
  agent: Agent;
}

export function AgentListItem({ agent }: AgentListItemProps) {
  const formatCommission = (rate: number | null) => {
    if (rate === null) return "N/A";
    return `${(rate * 100).toFixed(2)}%`;
  };

  return (
    <TableRow>
      <TableCell className="font-mono text-sm">{agent.agent_id}</TableCell>
      <TableCell className="font-medium">{agent.name}</TableCell>
      <TableCell>{formatCommission(agent.commission_rate)}</TableCell>
      <TableCell>{agent.rm_name || agent.rm_id}</TableCell>
      <TableCell className="max-w-[150px] truncate">{agent.bank_name || "-"}</TableCell>
      <TableCell className="font-mono text-xs">{agent.bank_account || "-"}</TableCell>
      <TableCell>
        <Badge variant={agent.status === "Active" ? "default" : "secondary"}>
          {agent.status || "Unknown"}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
