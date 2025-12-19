import { cn } from "@/lib/utils";
import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";

export type StatusTag = "on-track" | "warning" | "critical" | "neutral";

interface ExecutiveHealthTileProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  weekChange?: number;
  monthChange?: number;
  status?: StatusTag;
  className?: string;
  delay?: number;
}

const statusStyles: Record<StatusTag, { bg: string; text: string; label: string }> = {
  "on-track": { bg: "bg-success/20", text: "text-success", label: "On Track" },
  "warning": { bg: "bg-warning/20", text: "text-warning", label: "Warning" },
  "critical": { bg: "bg-destructive/20", text: "text-destructive", label: "Critical" },
  "neutral": { bg: "bg-muted", text: "text-muted-foreground", label: "—" },
};

export function ExecutiveHealthTile({
  title,
  value,
  subtitle,
  icon: Icon,
  weekChange,
  monthChange,
  status = "neutral",
  className,
  delay = 0,
}: ExecutiveHealthTileProps) {
  const getTrendIcon = (change?: number) => {
    if (change === undefined || change === 0) return <Minus className="h-3 w-3" />;
    return change > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />;
  };

  const getTrendColor = (change?: number) => {
    if (change === undefined || change === 0) return "text-muted-foreground";
    return change > 0 ? "text-success" : "text-destructive";
  };

  const formatChange = (change?: number) => {
    if (change === undefined) return "—";
    const sign = change > 0 ? "+" : "";
    return `${sign}${change.toFixed(1)}%`;
  };

  const statusConfig = statusStyles[status];

  return (
    <div
      className={cn(
        "glass-card rounded-xl p-5 transition-all duration-300 hover:shadow-elevated animate-slide-up group",
        className
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="rounded-lg p-2.5 bg-secondary">
          <Icon className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
        </div>
        <span
          className={cn(
            "text-xs font-medium px-2 py-1 rounded-full",
            statusConfig.bg,
            statusConfig.text
          )}
        >
          {statusConfig.label}
        </span>
      </div>

      <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>
      <p className="text-2xl font-semibold font-serif text-foreground mb-2">{value}</p>

      <div className="flex items-center gap-4 text-xs">
        <div className={cn("flex items-center gap-1", getTrendColor(weekChange))}>
          {getTrendIcon(weekChange)}
          <span>WoW: {formatChange(weekChange)}</span>
        </div>
        <div className={cn("flex items-center gap-1", getTrendColor(monthChange))}>
          {getTrendIcon(monthChange)}
          <span>MoM: {formatChange(monthChange)}</span>
        </div>
      </div>

      {subtitle && (
        <p className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border/50">
          {subtitle}
        </p>
      )}
    </div>
  );
}
