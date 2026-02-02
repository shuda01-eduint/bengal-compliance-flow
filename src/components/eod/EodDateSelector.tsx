import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CalendarIcon } from "lucide-react";
import { format, subDays, startOfDay } from "date-fns";

interface EodDateSelectorProps {
  selectedDate: Date | undefined;
  onDateChange: (date: Date | undefined) => void;
  disabled?: boolean;
}

export function EodDateSelector({
  selectedDate,
  onDateChange,
  disabled,
}: EodDateSelectorProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);

  const handleQuickDate = (daysAgo: number) => {
    const date = startOfDay(subDays(new Date(), daysAgo));
    onDateChange(date);
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
    onDateChange(date);
  };

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      {/* Date Picker */}
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal sm:w-[280px]",
              !selectedDate && "text-muted-foreground"
            )}
            disabled={disabled}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {selectedDate ? format(selectedDate, "PPP") : "Select date"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
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
