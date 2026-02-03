import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type NegativeBalanceMode = "all" | "new_only";

interface NegativeBalanceModeToggleProps {
  mode: NegativeBalanceMode;
  onModeChange: (mode: NegativeBalanceMode) => void;
}

export function NegativeBalanceModeToggle({
  mode,
  onModeChange,
}: NegativeBalanceModeToggleProps) {
  return (
    <ToggleGroup
      type="single"
      value={mode}
      onValueChange={(value) => {
        if (value) onModeChange(value as NegativeBalanceMode);
      }}
      className="bg-background/50 rounded-md p-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      <ToggleGroupItem
        value="all"
        size="sm"
        className={cn(
          "text-xs px-2 py-1 h-6 data-[state=on]:bg-red-500/20 data-[state=on]:text-red-400"
        )}
      >
        All
      </ToggleGroupItem>
      <ToggleGroupItem
        value="new_only"
        size="sm"
        className={cn(
          "text-xs px-2 py-1 h-6 data-[state=on]:bg-red-500/20 data-[state=on]:text-red-400"
        )}
      >
        New
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
