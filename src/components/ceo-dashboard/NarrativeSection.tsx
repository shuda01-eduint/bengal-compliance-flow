import { useState } from "react";
import { FileText, MessageSquare, ChevronDown, ChevronUp, Filter, Sparkles, TrendingUp, TrendingDown, AlertTriangle, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface NarrativeBullet {
  text: string;
  category: "growth" | "revenue" | "risk" | "operational";
  change: "positive" | "negative" | "neutral";
}

interface FeedbackEntry {
  id: string;
  author: string;
  department: string;
  date: string;
  text: string;
  tags: string[];
}

interface NarrativeSectionProps {
  narrativeBullets: NarrativeBullet[];
  feedbackEntries: FeedbackEntry[];
  departments: { name: string; code: string }[];
  onSubmitFeedback?: (text: string, tags: string[]) => void;
}

export function NarrativeSection({
  narrativeBullets,
  feedbackEntries,
  departments,
  onSubmitFeedback,
}: NarrativeSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [feedbackFilter, setFeedbackFilter] = useState<string>("all");
  const [newFeedback, setNewFeedback] = useState("");

  const categoryConfig = {
    growth: { icon: TrendingUp, color: "text-success", bg: "bg-success/10" },
    revenue: { icon: Sparkles, color: "text-primary", bg: "bg-primary/10" },
    risk: { icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10" },
    operational: { icon: Settings, color: "text-accent", bg: "bg-accent/10" },
  };

  const changeStyles = {
    positive: "text-success/90",
    negative: "text-destructive/90",
    neutral: "text-foreground/80",
  };

  const filteredFeedback =
    feedbackFilter === "all"
      ? feedbackEntries
      : feedbackEntries.filter((f) => f.department === feedbackFilter);

  const handleSubmit = () => {
    if (newFeedback.trim() && onSubmitFeedback) {
      onSubmitFeedback(newFeedback, []);
      setNewFeedback("");
    }
  };

  return (
    <div className="glass-card rounded-xl overflow-hidden animate-slide-up" style={{ animationDelay: "500ms" }}>
      {/* Header */}
      <div
        className="px-6 py-4 border-b border-border/30 bg-gradient-to-r from-accent/5 to-transparent cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <div className="section-header mb-0">
            <div className="section-icon bg-gradient-to-br from-accent to-accent/70">
              <FileText className="h-5 w-5 text-accent-foreground" />
            </div>
            <div>
              <h3 className="text-base font-semibold font-serif">Executive Brief</h3>
              <p className="text-xs text-muted-foreground">Weekly summary and team feedback</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="p-5 space-y-5">
          {/* Auto-generated Narrative */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">
              Performance Summary
            </h4>
            <div className="space-y-2">
              {narrativeBullets.length > 0 ? (
                narrativeBullets.map((bullet, index) => {
                  const CategoryIcon = categoryConfig[bullet.category].icon;
                  return (
                    <div 
                      key={index} 
                      className="flex items-start gap-3 p-3 rounded-lg bg-secondary/30 hover:bg-secondary/50 transition-colors"
                    >
                      <div className={cn("rounded-md p-1.5 mt-0.5", categoryConfig[bullet.category].bg)}>
                        <CategoryIcon className={cn("h-3.5 w-3.5", categoryConfig[bullet.category].color)} />
                      </div>
                      <p className={cn("text-sm leading-relaxed", changeStyles[bullet.change])}>
                        {bullet.text}
                      </p>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-6 text-sm text-muted-foreground bg-success/5 rounded-lg border border-success/20">
                  <TrendingUp className="h-5 w-5 text-success mx-auto mb-2" />
                  All metrics are within normal ranges
                </div>
              )}
            </div>
          </div>

          {/* Team Feedback */}
          <div className="pt-4 border-t border-border/30">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5" />
                Team Feedback
              </h4>
              <div className="flex items-center gap-2">
                <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                <Select value={feedbackFilter} onValueChange={setFeedbackFilter}>
                  <SelectTrigger className="w-[130px] h-7 text-xs bg-secondary/50 border-border/50">
                    <SelectValue placeholder="Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.code} value={d.code}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {filteredFeedback.length > 0 ? (
                filteredFeedback.map((entry) => (
                  <div key={entry.id} className="stat-card">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold">{entry.author}</span>
                        <Badge variant="outline" className="text-[10px] h-5 border-border/50">
                          {entry.department}
                        </Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{entry.date}</span>
                    </div>
                    <p className="text-xs text-foreground/80">{entry.text}</p>
                    {entry.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {entry.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[10px] h-5">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No feedback for selected filter
                </p>
              )}
            </div>

            {/* Add Feedback */}
            <div className="mt-4 pt-4 border-t border-border/30">
              <Textarea
                placeholder="Add context (e.g., 'IPO week', 'System downtime')..."
                value={newFeedback}
                onChange={(e) => setNewFeedback(e.target.value)}
                className="mb-2 bg-secondary/50 border-border/50 resize-none text-sm"
                rows={2}
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={handleSubmit} disabled={!newFeedback.trim()} className="h-8 text-xs">
                  Submit Feedback
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
