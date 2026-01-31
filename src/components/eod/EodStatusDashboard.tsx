import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface EodStatusDashboardProps {
  pendingCount: number;
  runningCount: number;
  completedCount: number;
  failedCount: number;
  lastRunDate?: string;
  lastRunStatus?: string;
}

export function EodStatusDashboard({
  pendingCount,
  runningCount,
  completedCount,
  failedCount,
  lastRunDate,
  lastRunStatus,
}: EodStatusDashboardProps) {
  const cards = [
    {
      title: "Pending",
      value: pendingCount,
      icon: Clock,
      color: "text-muted-foreground",
      bgColor: "bg-muted/50",
    },
    {
      title: "Running",
      value: runningCount,
      icon: Loader2,
      color: "text-primary",
      bgColor: "bg-primary/10",
      iconClass: runningCount > 0 ? "animate-spin" : "",
    },
    {
      title: "Completed",
      value: completedCount,
      icon: CheckCircle2,
      color: "text-green-600",
      bgColor: "bg-green-50 dark:bg-green-950/30",
    },
    {
      title: "Failed",
      value: failedCount,
      icon: XCircle,
      color: "text-destructive",
      bgColor: "bg-destructive/10",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.title} className={cn("border", card.bgColor)}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
              <card.icon className={cn("h-4 w-4", card.color, card.iconClass)} />
            </CardHeader>
            <CardContent>
              <div className={cn("text-2xl font-bold", card.color)}>
                {card.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {lastRunDate && (
        <p className="text-sm text-muted-foreground">
          Last EOD run: <span className="font-medium">{lastRunDate}</span>
          {lastRunStatus && (
            <span
              className={cn(
                "ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                lastRunStatus === "completed"
                  ? "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-400"
                  : lastRunStatus === "failed"
                  ? "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400"
                  : "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-400"
              )}
            >
              {lastRunStatus}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
