import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface EodProgressBarProps {
  progress: number;
  currentDate?: string;
  processedDays: number;
  totalDays: number;
  visible?: boolean;
}

export function EodProgressBar({
  progress,
  currentDate,
  processedDays,
  totalDays,
  visible = false,
}: EodProgressBarProps) {
  if (!visible) return null;

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {currentDate ? `Processing ${currentDate}...` : "Preparing..."}
        </span>
        <span className="font-medium">
          {processedDays} / {totalDays} days
        </span>
      </div>
      <Progress value={progress} className="h-2" />
      <p className="text-xs text-muted-foreground">
        {Math.round(progress)}% complete
      </p>
    </div>
  );
}
