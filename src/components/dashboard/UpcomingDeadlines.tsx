import { complianceReports } from "@/data/complianceData";
import { cn } from "@/lib/utils";
import { Calendar, AlertTriangle, Clock } from "lucide-react";
import { format, differenceInDays, parseISO } from "date-fns";

export function UpcomingDeadlines() {
  const today = new Date();
  
  const upcomingReports = complianceReports
    .filter(r => r.status === "pending" || r.status === "requires_revision" || r.status === "overdue")
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, 5);

  const getDaysRemaining = (dueDate: string) => {
    return differenceInDays(parseISO(dueDate), today);
  };

  const getUrgencyStyles = (daysRemaining: number) => {
    if (daysRemaining < 0) return "border-l-destructive bg-destructive/5";
    if (daysRemaining <= 3) return "border-l-warning bg-warning/5";
    if (daysRemaining <= 7) return "border-l-accent bg-accent/5";
    return "border-l-success bg-success/5";
  };

  return (
    <div className="glass-card rounded-xl p-6 animate-slide-up" style={{ animationDelay: "400ms" }}>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold font-serif text-foreground">Upcoming Deadlines</h3>
        <Calendar className="h-5 w-5 text-muted-foreground" />
      </div>

      <div className="space-y-3">
        {upcomingReports.map((report) => {
          const daysRemaining = getDaysRemaining(report.dueDate);
          
          return (
            <div
              key={report.id}
              className={cn(
                "border-l-4 rounded-r-lg p-4 transition-all hover:translate-x-1",
                getUrgencyStyles(daysRemaining)
              )}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">{report.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{report.department}</p>
                </div>
                <div className="flex items-center gap-1 text-xs">
                  {daysRemaining < 0 ? (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                      <span className="text-destructive font-medium">Overdue</span>
                    </>
                  ) : daysRemaining === 0 ? (
                    <>
                      <Clock className="h-3.5 w-3.5 text-warning" />
                      <span className="text-warning font-medium">Due today</span>
                    </>
                  ) : (
                    <>
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-muted-foreground">{daysRemaining}d left</span>
                    </>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Due: {format(parseISO(report.dueDate), "MMMM d, yyyy")}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
