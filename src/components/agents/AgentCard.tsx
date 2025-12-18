import { Agent } from "@/hooks/useAgents";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User, Building, Percent, CreditCard, Phone, FileText } from "lucide-react";

interface AgentCardProps {
  agent: Agent;
  index: number;
}

export function AgentCard({ agent, index }: AgentCardProps) {
  const formatCommission = (rate: number | null) => {
    if (rate === null) return "N/A";
    return `${(rate * 100).toFixed(2)}%`;
  };

  return (
    <Card 
      className="hover:shadow-lg transition-all duration-300 animate-fade-in border-border/50"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground leading-tight">{agent.name}</h3>
              <p className="text-sm text-muted-foreground">{agent.agent_id}</p>
            </div>
          </div>
          <Badge variant={agent.status === "Active" ? "default" : "secondary"}>
            {agent.status || "Unknown"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Percent className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Commission:</span>
          <span className="font-medium text-foreground">{formatCommission(agent.commission_rate)}</span>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">RM:</span>
          <span className="text-foreground">{agent.rm_name || agent.rm_id}</span>
        </div>

        {agent.bank_name && (
          <div className="flex items-center gap-2 text-sm">
            <Building className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Bank:</span>
            <span className="text-foreground truncate">{agent.bank_name}</span>
          </div>
        )}

        {agent.bank_account && (
          <div className="flex items-center gap-2 text-sm">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Account:</span>
            <span className="text-foreground font-mono text-xs">{agent.bank_account}</span>
          </div>
        )}

        {agent.remarks && (
          <div className="flex items-start gap-2 text-sm pt-2 border-t border-border/50">
            <FileText className="h-4 w-4 text-muted-foreground mt-0.5" />
            <span className="text-muted-foreground text-xs">{agent.remarks}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
