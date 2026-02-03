import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface ViolationCardProps {
  title: string;
  icon: LucideIcon;
  count: number;
  amount: number;
  variant: "danger" | "warning" | "caution" | "info";
  isActive: boolean;
  onClick: () => void;
  isLoading?: boolean;
}

const variantStyles = {
  danger: {
    bg: "bg-red-500/10 hover:bg-red-500/20",
    border: "border-red-500/30",
    glow: "hover:shadow-[0_0_20px_rgba(239,68,68,0.3)]",
    icon: "bg-red-500/20 text-red-400",
    text: "text-red-400",
    active: "ring-2 ring-red-500 bg-red-500/20",
  },
  warning: {
    bg: "bg-orange-500/10 hover:bg-orange-500/20",
    border: "border-orange-500/30",
    glow: "hover:shadow-[0_0_20px_rgba(249,115,22,0.3)]",
    icon: "bg-orange-500/20 text-orange-400",
    text: "text-orange-400",
    active: "ring-2 ring-orange-500 bg-orange-500/20",
  },
  caution: {
    bg: "bg-yellow-500/10 hover:bg-yellow-500/20",
    border: "border-yellow-500/30",
    glow: "hover:shadow-[0_0_20px_rgba(234,179,8,0.3)]",
    icon: "bg-yellow-500/20 text-yellow-400",
    text: "text-yellow-400",
    active: "ring-2 ring-yellow-500 bg-yellow-500/20",
  },
  info: {
    bg: "bg-purple-500/10 hover:bg-purple-500/20",
    border: "border-purple-500/30",
    glow: "hover:shadow-[0_0_20px_rgba(168,85,247,0.3)]",
    icon: "bg-purple-500/20 text-purple-400",
    text: "text-purple-400",
    active: "ring-2 ring-purple-500 bg-purple-500/20",
  },
};

export function ViolationCard({
  title,
  icon: Icon,
  count,
  amount,
  variant,
  isActive,
  onClick,
  isLoading,
}: ViolationCardProps) {
  const styles = variantStyles[variant];

  const formatAmount = (value: number) => {
    const absValue = Math.abs(value);
    if (absValue >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (absValue >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (absValue >= 1e3) return `${(value / 1e3).toFixed(2)}K`;
    return value.toFixed(2);
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex flex-col p-5 rounded-xl border transition-all duration-300 cursor-pointer text-left w-full",
        styles.bg,
        styles.border,
        styles.glow,
        isActive && styles.active
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={cn("p-3 rounded-lg", styles.icon)}>
          <Icon className="h-5 w-5" />
        </div>
        {isActive && (
          <span className={cn("text-xs font-medium px-2 py-1 rounded-full", styles.icon)}>
            Active
          </span>
        )}
      </div>

      <h3 className="text-sm font-medium text-muted-foreground mb-2">{title}</h3>

      {isLoading ? (
        <div className="space-y-2">
          <div className="h-8 w-16 bg-muted/50 rounded animate-pulse" />
          <div className="h-4 w-24 bg-muted/50 rounded animate-pulse" />
        </div>
      ) : (
        <>
          <p className={cn("text-3xl font-bold", styles.text)}>{count}</p>
          <p className="text-sm text-muted-foreground mt-1">
            Total: <span className={styles.text}>{formatAmount(amount)}</span>
          </p>
        </>
      )}
    </button>
  );
}
