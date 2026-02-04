import { cn } from "@/lib/utils";
import { TrendingUp, Users, Trophy } from "lucide-react";

interface DepartmentTurnover {
  department: string;
  total_turnover: number;
  trade_count: number;
  active_clients: number;
  top_performer: string;
  top_performer_turnover: number;
}

// Format number to Crore format
const formatCrore = (value: number): string => {
  const croreValue = value / 10000000;
  return `${croreValue.toFixed(2)} Cr`;
};

interface DepartmentTurnoverGridProps {
  data: DepartmentTurnover[];
  totalTurnover: number;
}

// Generate consistent colors for departments based on index
const DEPARTMENT_COLORS = [
  { bg: "from-emerald-500/20 to-emerald-500/5", border: "border-emerald-500/30", accent: "bg-emerald-500", text: "text-emerald-400" },
  { bg: "from-blue-500/20 to-blue-500/5", border: "border-blue-500/30", accent: "bg-blue-500", text: "text-blue-400" },
  { bg: "from-amber-500/20 to-amber-500/5", border: "border-amber-500/30", accent: "bg-amber-500", text: "text-amber-400" },
  { bg: "from-purple-500/20 to-purple-500/5", border: "border-purple-500/30", accent: "bg-purple-500", text: "text-purple-400" },
  { bg: "from-rose-500/20 to-rose-500/5", border: "border-rose-500/30", accent: "bg-rose-500", text: "text-rose-400" },
  { bg: "from-cyan-500/20 to-cyan-500/5", border: "border-cyan-500/30", accent: "bg-cyan-500", text: "text-cyan-400" },
  { bg: "from-orange-500/20 to-orange-500/5", border: "border-orange-500/30", accent: "bg-orange-500", text: "text-orange-400" },
  { bg: "from-indigo-500/20 to-indigo-500/5", border: "border-indigo-500/30", accent: "bg-indigo-500", text: "text-indigo-400" },
  { bg: "from-teal-500/20 to-teal-500/5", border: "border-teal-500/30", accent: "bg-teal-500", text: "text-teal-400" },
  { bg: "from-pink-500/20 to-pink-500/5", border: "border-pink-500/30", accent: "bg-pink-500", text: "text-pink-400" },
  { bg: "from-lime-500/20 to-lime-500/5", border: "border-lime-500/30", accent: "bg-lime-500", text: "text-lime-400" },
  { bg: "from-sky-500/20 to-sky-500/5", border: "border-sky-500/30", accent: "bg-sky-500", text: "text-sky-400" },
];

export function DepartmentTurnoverGrid({ data, totalTurnover }: DepartmentTurnoverGridProps) {
  if (!data || data.length === 0) {
    return (
      <div className="p-4 rounded-xl bg-gradient-to-br from-muted/50 to-transparent border border-border/50">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-semibold">Turnover by Department</h4>
        </div>
        <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
          No turnover data available for this period
        </div>
      </div>
    );
  }

  const sortedData = [...data].sort((a, b) => b.total_turnover - a.total_turnover);

  return (
    <div className="p-4 rounded-xl bg-gradient-to-br from-muted/50 to-transparent border border-border/50">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-blue-400" />
          Turnover by Department
        </h4>
        <span className="text-[10px] text-muted-foreground px-2 py-1 rounded-full bg-muted/50">
          {data.length} Departments
        </span>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[500px] overflow-y-auto pr-1">
        {sortedData.map((dept, index) => {
          const colorScheme = DEPARTMENT_COLORS[index % DEPARTMENT_COLORS.length];
          const percentage = totalTurnover > 0 
            ? ((dept.total_turnover / totalTurnover) * 100).toFixed(1) 
            : "0.0";
          
          return (
            <div
              key={dept.department || `dept-${index}`}
              className={cn(
                "relative overflow-hidden rounded-xl border p-3 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg group cursor-default",
                "bg-gradient-to-br",
                colorScheme.bg,
                colorScheme.border
              )}
            >
              {/* Colored accent bar */}
              <div 
                className={cn(
                  "absolute top-0 left-0 w-1 h-full rounded-l-xl",
                  colorScheme.accent
                )}
              />
              
              {/* Rank badge for top 3 */}
              {index < 3 && (
                <div className={cn(
                  "absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                  index === 0 ? "bg-amber-500/30 text-amber-300 ring-1 ring-amber-500/50" :
                  index === 1 ? "bg-slate-400/30 text-slate-300 ring-1 ring-slate-400/50" :
                  "bg-orange-600/30 text-orange-300 ring-1 ring-orange-600/50"
                )}>
                  {index + 1}
                </div>
              )}
              
              <div className="pl-2">
                {/* Department name */}
                <p className="text-xs font-medium text-foreground truncate mb-1.5 pr-6" title={dept.department || 'Unknown'}>
                  {dept.department || 'Unknown'}
                </p>
                
                {/* Turnover amount in Crore */}
                <p className={cn("text-lg font-bold mb-1.5", colorScheme.text)}>
                  {formatCrore(dept.total_turnover)}
                </p>
                
                {/* Top Performer */}
                <div className="flex items-center gap-1 mb-1.5 min-h-[20px]">
                  <Trophy className="h-3 w-3 text-amber-400 shrink-0" />
                  <span className="text-[10px] text-amber-300 truncate" title={dept.top_performer || '-'}>
                    Top: {dept.top_performer ? (dept.top_performer.length > 15 ? dept.top_performer.substring(0, 15) + '...' : dept.top_performer) : '-'}
                  </span>
                </div>
                
                {/* Active Clients Badge - Prominent */}
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-primary/20 border border-primary/30">
                    <Users className="h-3 w-3 text-primary" />
                    <span className="text-xs font-bold text-primary">
                      {dept.active_clients.toLocaleString()}
                    </span>
                    <span className="text-[9px] text-primary/70">clients</span>
                  </div>
                </div>
                
                {/* Percentage and trades */}
                <div className="flex items-center justify-between">
                  <span className={cn(
                    "text-[10px] font-semibold px-1.5 py-0.5 rounded-md",
                    "bg-background/50 backdrop-blur-sm",
                    colorScheme.text
                  )}>
                    {percentage}%
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    {dept.trade_count.toLocaleString()} trades
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
