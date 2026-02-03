import { useState } from "react";
import { Settings2, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NegativeBalanceThresholdFilterProps {
  threshold: number | null;
  onThresholdChange: (value: number | null) => void;
  variant: "danger" | "warning" | "caution" | "info";
}

const variantStyles = {
  danger: "text-red-400 hover:bg-red-500/20 border-red-500/30",
  warning: "text-orange-400 hover:bg-orange-500/20 border-orange-500/30",
  caution: "text-yellow-400 hover:bg-yellow-500/20 border-yellow-500/30",
  info: "text-purple-400 hover:bg-purple-500/20 border-purple-500/30",
};

export function NegativeBalanceThresholdFilter({
  threshold,
  onThresholdChange,
  variant,
}: NegativeBalanceThresholdFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(
    threshold ? Math.abs(threshold).toString() : ""
  );

  const handleApply = () => {
    const value = parseFloat(inputValue);
    if (!isNaN(value) && value > 0) {
      onThresholdChange(-value); // Store as negative
    } else {
      onThresholdChange(null);
    }
    setIsOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setInputValue("");
    onThresholdChange(null);
  };

  const formatThreshold = (value: number) => {
    const absValue = Math.abs(value);
    if (absValue >= 1e6) return `< -${(absValue / 1e6).toFixed(1)}M`;
    if (absValue >= 1e3) return `< -${(absValue / 1e3).toFixed(0)}K`;
    return `< -${absValue}`;
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(true);
          }}
          className={cn(
            "p-1.5 rounded-md transition-colors border bg-background/50",
            variantStyles[variant],
            threshold && "bg-red-500/20"
          )}
          title="Set amount threshold"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-4 bg-popover border-border"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-4">
          <div>
            <h4 className="font-medium text-sm mb-1">Amount Threshold</h4>
            <p className="text-xs text-muted-foreground">
              Show balances worse than this amount
            </p>
          </div>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                -
              </span>
              <Input
                type="number"
                placeholder="100000"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="pl-6"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleApply();
                }}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => {
                setInputValue("");
                setIsOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" className="flex-1" onClick={handleApply}>
              Apply
            </Button>
          </div>

          {threshold && (
            <p className="text-xs text-muted-foreground text-center">
              Current: {formatThreshold(threshold)}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ThresholdBadge({
  threshold,
  onClear,
}: {
  threshold: number;
  onClear: () => void;
}) {
  const formatThreshold = (value: number) => {
    const absValue = Math.abs(value);
    if (absValue >= 1e6) return `< -${(absValue / 1e6).toFixed(1)}M`;
    if (absValue >= 1e3) return `< -${(absValue / 1e3).toFixed(0)}K`;
    return `< -${absValue}`;
  };

  return (
    <span className="inline-flex items-center gap-1 text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">
      {formatThreshold(threshold)}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClear();
        }}
        className="hover:bg-red-500/30 rounded-full p-0.5"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
