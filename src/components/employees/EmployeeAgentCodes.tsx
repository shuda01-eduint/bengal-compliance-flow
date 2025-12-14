import { useAgentCodesByRM } from "@/hooks/useAgentCodes";
import { Badge } from "@/components/ui/badge";
import { Users, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface EmployeeAgentCodesProps {
  employeeId: string;
  compact?: boolean;
}

export function EmployeeAgentCodes({ employeeId, compact = false }: EmployeeAgentCodesProps) {
  const { codes, groupedByAgent, totalAgents, totalInvestors, isLoading } = useAgentCodesByRM(employeeId);
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return <div className="text-xs text-muted-foreground">Loading...</div>;
  }

  if (totalInvestors === 0) {
    return null;
  }

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          <Users className="h-3 w-3 mr-1" />
          {totalAgents} agents · {totalInvestors} investors
        </Badge>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Users className="h-3 w-3" />
        <span>{totalAgents} Agents · {totalInvestors} Investor Codes</span>
      </button>
      
      {expanded && (
        <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
          {Object.entries(groupedByAgent).map(([agentId, investorCodes]) => (
            <div key={agentId} className="text-xs">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px] font-mono">
                  {agentId}
                </Badge>
                <span className="text-muted-foreground">
                  ({investorCodes.length} codes)
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-1 pl-2">
                {investorCodes.slice(0, 5).map(code => (
                  <span key={code} className="text-[10px] font-mono text-muted-foreground bg-secondary/50 px-1 rounded">
                    {code}
                  </span>
                ))}
                {investorCodes.length > 5 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{investorCodes.length - 5} more
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
