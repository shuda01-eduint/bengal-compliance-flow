import { postReportActivities } from "@/data/complianceData";
import { cn } from "@/lib/utils";
import { 
  FileText, 
  CheckCircle2, 
  XCircle, 
  MessageSquare, 
  Send, 
  RefreshCw,
  Eye
} from "lucide-react";
import { format } from "date-fns";

const actionIcons = {
  created: FileText,
  updated: RefreshCw,
  submitted: Send,
  reviewed: Eye,
  approved: CheckCircle2,
  rejected: XCircle,
  comment: MessageSquare,
};

const actionColors = {
  created: "text-accent",
  updated: "text-primary",
  submitted: "text-accent",
  reviewed: "text-muted-foreground",
  approved: "text-success",
  rejected: "text-destructive",
  comment: "text-muted-foreground",
};

export function RecentActivity() {
  const recentActivities = postReportActivities.slice(0, 6);

  return (
    <div className="glass-card rounded-xl p-6 animate-slide-up" style={{ animationDelay: "300ms" }}>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold font-serif text-foreground">Recent Activity</h3>
        <a href="/activity" className="text-sm text-primary hover:underline">View all</a>
      </div>
      
      <div className="space-y-4">
        {recentActivities.map((activity, index) => {
          const Icon = actionIcons[activity.action];
          return (
            <div
              key={activity.id}
              className="flex items-start gap-4 p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
            >
              <div className={cn("mt-0.5", actionColors[activity.action])}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground">{activity.details}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">{activity.performedBy}</span>
                  <span className="text-xs text-muted-foreground">•</span>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(activity.timestamp), "MMM d, h:mm a")}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
