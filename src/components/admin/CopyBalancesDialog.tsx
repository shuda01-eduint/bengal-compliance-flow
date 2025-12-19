import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Copy, CalendarIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO, addDays } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface CopyBalancesDialogProps {
  availableDates: string[];
  onCopyComplete?: () => void;
}

export function CopyBalancesDialog({ availableDates, onCopyComplete }: CopyBalancesDialogProps) {
  const [open, setOpen] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [sourceDate, setSourceDate] = useState<Date | undefined>(
    availableDates?.[0] ? parseISO(availableDates[0]) : undefined
  );
  const [targetDate, setTargetDate] = useState<Date | undefined>(
    availableDates?.[0] ? addDays(parseISO(availableDates[0]), 1) : undefined
  );

  const handleCopy = async () => {
    if (!sourceDate || !targetDate) {
      toast.error("Please select both source and target dates");
      return;
    }

    setIsCopying(true);
    try {
      const { data, error } = await supabase.rpc('copy_balances_to_date', {
        p_source_date: format(sourceDate, 'yyyy-MM-dd'),
        p_target_date: format(targetDate, 'yyyy-MM-dd'),
      });

      if (error) throw error;

      const result = data as { records_copied: number; records_replaced: number };
      toast.success(
        `Copied ${result.records_copied.toLocaleString()} records from ${format(sourceDate, 'PP')} to ${format(targetDate, 'PP')}`
      );
      setOpen(false);
      onCopyComplete?.();
    } catch (error) {
      console.error('Copy error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to copy balance data');
    } finally {
      setIsCopying(false);
    }
  };

  const latestDate = availableDates?.[0] ? parseISO(availableDates[0]) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Copy className="h-4 w-4" />
          Copy to Date
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copy Balance Data</DialogTitle>
          <DialogDescription>
            Clone balance data from an existing date to create a projection for another date.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label>Source Date (copy from)</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !sourceDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {sourceDate ? format(sourceDate, "PPP") : "Select source date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={sourceDate}
                  onSelect={setSourceDate}
                  disabled={(date) => {
                    const dateStr = format(date, 'yyyy-MM-dd');
                    return !availableDates?.includes(dateStr);
                  }}
                  initialFocus
                  modifiers={{
                    hasData: availableDates?.map(d => parseISO(d)) || []
                  }}
                  modifiersStyles={{
                    hasData: { fontWeight: 'bold', color: 'hsl(var(--primary))' }
                  }}
                />
              </PopoverContent>
            </Popover>
            {latestDate && (
              <p className="text-xs text-muted-foreground">
                Latest available: {format(latestDate, 'PP')}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Target Date (copy to)</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !targetDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {targetDate ? format(targetDate, "PPP") : "Select target date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={targetDate}
                  onSelect={setTargetDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            {targetDate && availableDates?.includes(format(targetDate, 'yyyy-MM-dd')) && (
              <p className="text-xs text-amber-500">
                Warning: This date already has data that will be replaced
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isCopying}>
              Cancel
            </Button>
            <Button onClick={handleCopy} disabled={!sourceDate || !targetDate || isCopying}>
              {isCopying ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Copying...
                </>
              ) : (
                'Copy Data'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}