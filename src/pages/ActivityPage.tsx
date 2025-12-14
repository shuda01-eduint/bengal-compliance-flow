import { MainLayout } from "@/components/layout/MainLayout";
import { postReportActivities } from "@/data/complianceData";
import { format } from "date-fns";
import { 
  FileText, 
  CheckCircle2, 
  XCircle, 
  MessageSquare, 
  Send, 
  RefreshCw,
  Eye,
  Filter
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";

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
  created: "bg-accent/20 text-accent border-accent/30",
  updated: "bg-primary/20 text-primary border-primary/30",
  submitted: "bg-accent/20 text-accent border-accent/30",
  reviewed: "bg-secondary text-muted-foreground border-border",
  approved: "bg-success/20 text-success border-success/30",
  rejected: "bg-destructive/20 text-destructive border-destructive/30",
  comment: "bg-secondary text-muted-foreground border-border",
};

const actionLabels = {
  created: "Created",
  updated: "Updated",
  submitted: "Submitted",
  reviewed: "Reviewed",
  approved: "Approved",
  rejected: "Rejected",
  comment: "Comment",
};

const ActivityPage = () => {
  const [filterAction, setFilterAction] = useState<string>("all");

  const filteredActivities = filterAction === "all" 
    ? postReportActivities 
    : postReportActivities.filter(a => a.action === filterAction);

  return (
    <MainLayout 
      title="Post-Report Activity" 
      subtitle="Track all activities and updates on compliance reports"
    >
      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <Select value={filterAction} onValueChange={setFilterAction}>
          <SelectTrigger className="w-48 bg-secondary border-border">
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Filter by action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Actions</SelectItem>
            <SelectItem value="created">Created</SelectItem>
            <SelectItem value="updated">Updated</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="reviewed">Reviewed</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="comment">Comments</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Activity Timeline */}
      <div className="glass-card rounded-xl p-6">
        <div className="space-y-6">
          {filteredActivities.map((activity, index) => {
            const Icon = actionIcons[activity.action];
            return (
              <div 
                key={activity.id}
                className="flex gap-4 animate-slide-up"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {/* Timeline connector */}
                <div className="flex flex-col items-center">
                  <div className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full border",
                    actionColors[activity.action]
                  )}>
                    <Icon className="h-4 w-4" />
                  </div>
                  {index < filteredActivities.length - 1 && (
                    <div className="w-px h-full bg-border mt-2" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 pb-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn(
                          "text-xs font-medium px-2 py-0.5 rounded-full border",
                          actionColors[activity.action]
                        )}>
                          {actionLabels[activity.action]}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {activity.reportId}
                        </span>
                      </div>
                      <p className="text-sm text-foreground">{activity.details}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs font-medium text-foreground">
                          {activity.performedBy}
                        </span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">
                          {activity.department}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(activity.timestamp), "MMM d, yyyy 'at' h:mm a")}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </MainLayout>
  );
};

export default ActivityPage;
