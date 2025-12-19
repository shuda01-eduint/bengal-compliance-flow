import { useState, useEffect } from "react";
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
import { Copy, CalendarIcon, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO, addDays, isWeekend } from "date-fns";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";

interface CopyBalancesDialogProps {
  availableDates: string[];
  onCopyComplete?: () => void;
}

// Bangladesh Bank Holidays for 2024-2025
// These can be updated annually or moved to database for easier management
const BANK_HOLIDAYS: { date: string; name: string }[] = [
  // 2024 Holidays
  { date: "2024-02-21", name: "Shaheed Day" },
  { date: "2024-03-17", name: "Sheikh Mujibur Rahman's Birthday" },
  { date: "2024-03-26", name: "Independence Day" },
  { date: "2024-04-14", name: "Bengali New Year" },
  { date: "2024-05-01", name: "May Day" },
  { date: "2024-08-15", name: "National Mourning Day" },
  { date: "2024-12-16", name: "Victory Day" },
  { date: "2024-12-25", name: "Christmas Day" },
  // 2025 Holidays
  { date: "2025-01-01", name: "New Year's Day" },
  { date: "2025-02-21", name: "Shaheed Day" },
  { date: "2025-03-17", name: "Sheikh Mujibur Rahman's Birthday" },
  { date: "2025-03-26", name: "Independence Day" },
  { date: "2025-03-31", name: "Eid ul-Fitr" },
  { date: "2025-04-01", name: "Eid ul-Fitr (2nd day)" },
  { date: "2025-04-02", name: "Eid ul-Fitr (3rd day)" },
  { date: "2025-04-14", name: "Bengali New Year" },
  { date: "2025-05-01", name: "May Day" },
  { date: "2025-06-07", name: "Eid ul-Adha" },
  { date: "2025-06-08", name: "Eid ul-Adha (2nd day)" },
  { date: "2025-06-09", name: "Eid ul-Adha (3rd day)" },
  { date: "2025-07-06", name: "Ashura" },
  { date: "2025-08-15", name: "National Mourning Day" },
  { date: "2025-09-05", name: "Eid-e-Miladunnabi" },
  { date: "2025-10-02", name: "Durga Puja" },
  { date: "2025-12-16", name: "Victory Day" },
  { date: "2025-12-25", name: "Christmas Day" },
];

// Check if a date is a bank holiday
function isBankHoliday(date: Date): boolean {
  const dateStr = format(date, 'yyyy-MM-dd');
  return BANK_HOLIDAYS.some(h => h.date === dateStr);
}

// Get holiday name if date is a holiday
function getHolidayName(date: Date): string | undefined {
  const dateStr = format(date, 'yyyy-MM-dd');
  return BANK_HOLIDAYS.find(h => h.date === dateStr)?.name;
}

// Check if a date is a non-business day (weekend or holiday)
function isNonBusinessDay(date: Date): boolean {
  return isWeekend(date) || isBankHoliday(date);
}

// Calculate the next business day (skipping weekends and holidays)
function getNextBusinessDay(date: Date): Date {
  let nextDay = addDays(date, 1);
  
  // Skip weekends and holidays
  while (isNonBusinessDay(nextDay)) {
    nextDay = addDays(nextDay, 1);
  }
  
  return nextDay;
}

// Check if a date is a weekend
function isWeekendDay(date: Date): boolean {
  return isWeekend(date);
}

const BATCH_SIZE = 5000;

export function CopyBalancesDialog({ availableDates, onCopyComplete }: CopyBalancesDialogProps) {
  const [open, setOpen] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [showHolidays, setShowHolidays] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [sourceDate, setSourceDate] = useState<Date | undefined>(
    availableDates?.[0] ? parseISO(availableDates[0]) : undefined
  );
  const [targetDate, setTargetDate] = useState<Date | undefined>(
    availableDates?.[0] ? getNextBusinessDay(parseISO(availableDates[0])) : undefined
  );

  // Auto-update target date when source date changes
  useEffect(() => {
    if (sourceDate) {
      setTargetDate(getNextBusinessDay(sourceDate));
    }
  }, [sourceDate]);

  // Get upcoming holidays (next 6 months)
  const upcomingHolidays = BANK_HOLIDAYS.filter(h => {
    const holidayDate = parseISO(h.date);
    const today = new Date();
    const sixMonthsLater = addDays(today, 180);
    return holidayDate >= today && holidayDate <= sixMonthsLater;
  }).slice(0, 8);

  const handleCopy = async () => {
    if (!sourceDate || !targetDate) {
      toast.error("Please select both source and target dates");
      return;
    }

    setIsCopying(true);
    setProgress(0);
    setProgressText("Initializing...");

    const sourceDateStr = format(sourceDate, 'yyyy-MM-dd');
    const targetDateStr = format(targetDate, 'yyyy-MM-dd');

    try {
      // Step 1: Initialize - validate and get total count
      const { data: initData, error: initError } = await supabase.rpc('init_copy_balances', {
        p_source_date: sourceDateStr,
        p_target_date: targetDateStr,
      });

      if (initError) throw initError;

      const { total_rows } = initData as { total_rows: number; deleted_count: number };
      const totalBatches = Math.ceil(total_rows / BATCH_SIZE);
      
      setProgressText(`Copying ${total_rows.toLocaleString()} records...`);

      // Step 2: Copy in batches
      let totalCopied = 0;
      let offset = 0;
      let batchNum = 1;

      while (true) {
        setProgressText(`Batch ${batchNum}/${totalBatches} (${totalCopied.toLocaleString()} of ${total_rows.toLocaleString()})`);
        
        const { data: batchData, error: batchError } = await supabase.rpc('copy_balances_batch', {
          p_source_date: sourceDateStr,
          p_target_date: targetDateStr,
          p_batch_size: BATCH_SIZE,
          p_offset: offset,
        });

        if (batchError) throw batchError;

        const { copied_count, has_more } = batchData as { copied_count: number; has_more: boolean };
        totalCopied += copied_count;
        
        // Update progress
        const progressPercent = Math.min(100, Math.round((totalCopied / total_rows) * 100));
        setProgress(progressPercent);

        if (!has_more || copied_count === 0) break;
        
        offset += BATCH_SIZE;
        batchNum++;
      }

      setProgress(100);
      setProgressText("Complete!");
      
      toast.success(
        `Copied ${totalCopied.toLocaleString()} records from ${format(sourceDate, 'PP')} to ${format(targetDate, 'PP')}`
      );
      
      setTimeout(() => {
        setOpen(false);
        setProgress(0);
        setProgressText("");
        onCopyComplete?.();
      }, 1000);
      
    } catch (error) {
      console.error('Copy error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to copy balance data');
      setProgress(0);
      setProgressText("");
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
            <Label className="flex items-center gap-2">
              Target Date (copy to)
              {targetDate && sourceDate && 
                format(targetDate, 'yyyy-MM-dd') === format(getNextBusinessDay(sourceDate), 'yyyy-MM-dd') && (
                <Badge variant="secondary" className="text-xs">
                  Next Business Day
                </Badge>
              )}
            </Label>
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
                  className="pointer-events-auto"
                  modifiers={{
                    weekend: (date) => isWeekendDay(date),
                    holiday: (date) => isBankHoliday(date)
                  }}
                  modifiersStyles={{
                    weekend: { color: 'hsl(var(--muted-foreground))', opacity: 0.5 },
                    holiday: { color: 'hsl(var(--destructive))', fontWeight: 'bold' }
                  }}
                />
              </PopoverContent>
            </Popover>
            {targetDate && isWeekendDay(targetDate) && (
              <p className="text-xs text-amber-500">
                Note: Selected date is a weekend
              </p>
            )}
            {targetDate && isBankHoliday(targetDate) && (
              <p className="text-xs text-destructive">
                Note: Selected date is a bank holiday ({getHolidayName(targetDate)})
              </p>
            )}
            {targetDate && availableDates?.includes(format(targetDate, 'yyyy-MM-dd')) && (
              <p className="text-xs text-amber-500">
                Warning: This date already has data that will be replaced
              </p>
            )}
          </div>

          {/* Upcoming Holidays Section */}
          <Collapsible open={showHolidays} onOpenChange={setShowHolidays}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground">
                <span className="text-xs">View configured bank holidays ({BANK_HOLIDAYS.length})</span>
                {showHolidays ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="max-h-32 overflow-y-auto rounded border bg-muted/50 p-2">
                <p className="text-xs font-medium text-muted-foreground mb-2">Upcoming holidays:</p>
                <div className="space-y-1">
                  {upcomingHolidays.length > 0 ? (
                    upcomingHolidays.map((h) => (
                      <div key={h.date} className="flex justify-between text-xs">
                        <span className="text-muted-foreground">{format(parseISO(h.date), 'PP')}</span>
                        <span className="text-foreground">{h.name}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No upcoming holidays</p>
                  )}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Progress indicator */}
          {isCopying && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{progressText}</span>
                <span className="font-medium">{progress}%</span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          )}

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