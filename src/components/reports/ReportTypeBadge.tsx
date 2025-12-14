import { cn } from "@/lib/utils";
import type { ComplianceReport } from "@/data/complianceData";

interface ReportTypeBadgeProps {
  type: ComplianceReport["type"];
}

const typeConfig = {
  regulatory: {
    label: "Regulatory",
    className: "bg-secondary text-foreground"
  },
  internal: {
    label: "Internal",
    className: "bg-secondary text-muted-foreground"
  },
  audit: {
    label: "Audit",
    className: "bg-accent/20 text-accent"
  },
  bsec: {
    label: "BSEC",
    className: "bg-primary/20 text-primary"
  },
  dse: {
    label: "DSE",
    className: "bg-success/20 text-success"
  },
  cse: {
    label: "CSE",
    className: "bg-warning/20 text-warning"
  }
};

export function ReportTypeBadge({ type }: ReportTypeBadgeProps) {
  const config = typeConfig[type];
  
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium",
        config.className
      )}
    >
      {config.label}
    </span>
  );
}
