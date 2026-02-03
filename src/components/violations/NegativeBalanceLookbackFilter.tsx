import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface NegativeBalanceLookbackFilterProps {
  lookbackDays: number;
  onLookbackChange: (days: number) => void;
}

const LOOKBACK_OPTIONS = [
  { label: "7 days", value: 7 },
  { label: "14 days", value: 14 },
  { label: "30 days", value: 30 },
  { label: "60 days", value: 60 },
  { label: "90 days", value: 90 },
];

export function NegativeBalanceLookbackFilter({
  lookbackDays,
  onLookbackChange,
}: NegativeBalanceLookbackFilterProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="end" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            Lookback Period
          </p>
          {LOOKBACK_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant="ghost"
              size="sm"
              className={cn(
                "w-full justify-start text-sm",
                lookbackDays === option.value && "bg-accent"
              )}
              onClick={() => onLookbackChange(option.value)}
            >
              {option.label}
              {lookbackDays === option.value && (
                <span className="ml-auto text-xs text-muted-foreground">✓</span>
              )}
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
