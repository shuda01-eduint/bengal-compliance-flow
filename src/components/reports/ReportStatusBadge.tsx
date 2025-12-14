import { cn } from "@/lib/utils";
import type { ComplianceReport } from "@/data/complianceData";

interface ReportStatusBadgeProps {
  status: ComplianceReport["status"];
}

const statusConfig = {
  pending: {
    label: "Pending",
    className: "bg-warning/20 text-warning border-warning/30"
  },
  submitted: {
    label: "Submitted",
    className: "bg-accent/20 text-accent border-accent/30"
  },
  approved: {
    label: "Approved",
    className: "bg-success/20 text-success border-success/30"
  },
  requires_revision: {
    label: "Needs Revision",
    className: "bg-purple-500/20 text-purple-400 border-purple-500/30"
  },
  overdue: {
    label: "Overdue",
    className: "bg-destructive/20 text-destructive border-destructive/30"
  }
};

export function ReportStatusBadge({ status }: ReportStatusBadgeProps) {
  const config = statusConfig[status];
  
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        config.className
      )}
    >
      {config.label}
    </span>
  );
}
