import { cn } from "@/lib/utils";
import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";

export type StatusTag = "on-track" | "warning" | "critical" | "neutral";

export interface BreakdownItem {
  label: string;
  value: number;
  color?: string;
}

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
  breakdown?: BreakdownItem[];
}

const statusStyles: Record<StatusTag, { bg: string; border: string; text: string; label: string; glow: string }> = {
  "on-track": { 
    bg: "bg-success/10", 
    border: "border-success/30",
    text: "text-success", 
    label: "On Track",
    glow: "shadow-[0_0_20px_-5px_hsl(142_76%_36%/0.4)]"
  },
  "warning": { 
    bg: "bg-warning/10", 
    border: "border-warning/30",
    text: "text-warning", 
    label: "Warning",
    glow: "shadow-[0_0_20px_-5px_hsl(38_92%_50%/0.4)]"
  },
  "critical": { 
    bg: "bg-destructive/10", 
    border: "border-destructive/30",
    text: "text-destructive", 
    label: "Critical",
    glow: "shadow-[0_0_20px_-5px_hsl(0_72%_51%/0.4)]"
  },
  "neutral": { 
    bg: "bg-muted/50", 
    border: "border-border/50",
    text: "text-muted-foreground", 
    label: "—",
    glow: ""
  },
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
  breakdown,
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
        "relative overflow-hidden rounded-xl border transition-all duration-300 hover:-translate-y-1 animate-slide-up group",
        statusConfig.bg,
        statusConfig.border,
        status !== "neutral" && statusConfig.glow,
        className
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-background/50 to-transparent pointer-events-none" />
      
      <div className="relative p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className={cn(
            "rounded-lg p-2 transition-colors",
            status === "neutral" ? "bg-secondary" : statusConfig.bg
          )}>
            <Icon className={cn(
              "h-4 w-4 transition-colors",
              status === "neutral" ? "text-muted-foreground group-hover:text-primary" : statusConfig.text
            )} />
          </div>
          {status !== "neutral" && (
            <span className={cn(
              "text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider",
              statusConfig.bg,
              statusConfig.text
            )}>
              {statusConfig.label}
            </span>
          )}
        </div>

        {/* Title & Value */}
        <p className="text-xs font-medium text-muted-foreground mb-1">{title}</p>
        <p className="text-2xl font-bold tracking-tight text-foreground mb-3 break-all leading-tight">{value}</p>

        {/* Breakdown by type */}
        {breakdown && breakdown.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {breakdown.map((item) => (
              <div
                key={item.label}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-secondary/60"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: item.color || "hsl(var(--primary))" }}
                />
                <span className="text-muted-foreground">{item.label}:</span>
                <span className="font-semibold text-foreground">{item.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}

        {/* Trend indicators */}
        <div className="flex items-center gap-3 text-[11px]">
          <div className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary/50", getTrendColor(weekChange))}>
            {getTrendIcon(weekChange)}
            <span className="font-medium">W</span>
            <span>{formatChange(weekChange)}</span>
          </div>
          <div className={cn("flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary/50", getTrendColor(monthChange))}>
            {getTrendIcon(monthChange)}
            <span className="font-medium">M</span>
            <span>{formatChange(monthChange)}</span>
          </div>
        </div>

        {subtitle && (
          <p className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-border/30 truncate">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
