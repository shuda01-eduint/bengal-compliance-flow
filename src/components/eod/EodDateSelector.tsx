import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { CalendarIcon, Calendar as CalendarRange } from "lucide-react";
import { format, addDays, subDays, startOfDay } from "date-fns";
import type { DateRange } from "react-day-picker";

export type EodMode = "single" | "range";

interface EodDateSelectorProps {
  mode: EodMode;
  onModeChange: (mode: EodMode) => void;
  selectedDate: Date | undefined;
  onDateChange: (date: Date | undefined) => void;
  dateRange: DateRange | undefined;
  onRangeChange: (range: DateRange | undefined) => void;
  disabled?: boolean;
}

const MAX_RANGE_DAYS = 60;

export function EodDateSelector({
  mode,
  onModeChange,
  selectedDate,
  onDateChange,
  dateRange,
  onRangeChange,
  disabled,
}: EodDateSelectorProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);

  const handleQuickDate = (daysAgo: number) => {
    const date = startOfDay(subDays(new Date(), daysAgo));
    if (mode === "single") {
      onDateChange(date);
    } else {
      onRangeChange({ from: date, to: date });
    }
  };

  const getLastBusinessDay = (): Date => {
    let date = startOfDay(new Date());
    // If today is Monday (1), go back to Friday
    // If today is Sunday (0), go back to Friday
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0) {
      date = subDays(date, 2);
    } else if (dayOfWeek === 1) {
      date = subDays(date, 3);
    } else {
      date = subDays(date, 1);
    }
    return date;
  };

  const handleLastBusinessDay = () => {
    const date = getLastBusinessDay();
    if (mode === "single") {
      onDateChange(date);
    } else {
      onRangeChange({ from: date, to: date });
    }
  };

  const getDisplayText = (): string => {
    if (mode === "single") {
      return selectedDate ? format(selectedDate, "PPP") : "Select date";
    } else {
      if (dateRange?.from && dateRange?.to) {
        if (format(dateRange.from, "yyyy-MM-dd") === format(dateRange.to, "yyyy-MM-dd")) {
          return format(dateRange.from, "PPP");
        }
        return `${format(dateRange.from, "MMM d")} - ${format(dateRange.to, "MMM d, yyyy")}`;
      }
      return "Select date range";
    }
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      {/* Mode Toggle */}
      <Tabs value={mode} onValueChange={(v) => onModeChange(v as EodMode)}>
        <TabsList className="grid w-full grid-cols-2 sm:w-auto">
          <TabsTrigger value="single" disabled={disabled}>
            <CalendarIcon className="mr-2 h-4 w-4" />
            Single Day
          </TabsTrigger>
          <TabsTrigger value="range" disabled={disabled}>
            <CalendarRange className="mr-2 h-4 w-4" />
            Date Range
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Date Picker */}
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal sm:w-[280px]",
              !selectedDate && !dateRange?.from && "text-muted-foreground"
            )}
            disabled={disabled}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {getDisplayText()}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          {mode === "single" ? (
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => {
                onDateChange(date);
                setCalendarOpen(false);
              }}
              disabled={(date) => date > new Date()}
              initialFocus
              className="p-3 pointer-events-auto"
            />
          ) : (
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={(range) => {
                // Limit range to MAX_RANGE_DAYS
                if (range?.from && range?.to) {
                  const diffDays = Math.ceil(
                    (range.to.getTime() - range.from.getTime()) / (1000 * 60 * 60 * 24)
                  );
                  if (diffDays > MAX_RANGE_DAYS) {
                    range.to = addDays(range.from, MAX_RANGE_DAYS);
                  }
                }
                onRangeChange(range);
                if (range?.from && range?.to) {
                  setCalendarOpen(false);
                }
              }}
              disabled={(date) => date > new Date()}
              numberOfMonths={2}
              initialFocus
              className="p-3 pointer-events-auto"
            />
          )}
        </PopoverContent>
      </Popover>

      {/* Quick Date Buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleQuickDate(0)}
          disabled={disabled}
        >
          Today
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleQuickDate(1)}
          disabled={disabled}
        >
          Yesterday
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleLastBusinessDay}
          disabled={disabled}
        >
          Last Business Day
        </Button>
      </div>
    </div>
  );
}
