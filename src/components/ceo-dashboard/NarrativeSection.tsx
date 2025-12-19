import { useState } from "react";
import { FileText, MessageSquare, ChevronDown, ChevronUp, Filter } from "lucide-react";
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

  const categoryIcons = {
    growth: "📈",
    revenue: "💰",
    risk: "⚠️",
    operational: "⚙️",
  };

  const changeStyles = {
    positive: "text-success",
    negative: "text-destructive",
    neutral: "text-muted-foreground",
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
    <div className="glass-card rounded-xl p-6 animate-slide-up" style={{ animationDelay: "500ms" }}>
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="rounded-lg p-2.5 bg-accent/20">
            <FileText className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h3 className="text-lg font-semibold font-serif">Executive Brief</h3>
            <p className="text-sm text-muted-foreground">
              Weekly summary and team feedback
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon">
          {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </Button>
      </div>

      {expanded && (
        <div className="mt-6 space-y-6">
          {/* Auto-generated Narrative */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-3">
              This Week's Performance Summary
            </h4>
            <div className="bg-secondary/30 rounded-lg p-4 space-y-3">
              {narrativeBullets.length > 0 ? (
                narrativeBullets.map((bullet, index) => (
                  <div key={index} className="flex items-start gap-3">
                    <span className="text-lg">{categoryIcons[bullet.category]}</span>
                    <p className={cn("text-sm", changeStyles[bullet.change])}>{bullet.text}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No significant changes to report this week. All metrics are within normal ranges.
                </p>
              )}
            </div>
          </div>

          {/* RM/Department Feedback */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Team Feedback & Context
              </h4>
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={feedbackFilter} onValueChange={setFeedbackFilter}>
                  <SelectTrigger className="w-[140px] h-8 bg-secondary border-border">
                    <SelectValue placeholder="Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.code} value={d.code}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3 max-h-64 overflow-y-auto">
              {filteredFeedback.length > 0 ? (
                filteredFeedback.map((entry) => (
                  <div key={entry.id} className="bg-secondary/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{entry.author}</span>
                        <Badge variant="outline" className="text-xs">
                          {entry.department}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground">{entry.date}</span>
                    </div>
                    <p className="text-sm text-foreground">{entry.text}</p>
                    {entry.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {entry.tags.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No feedback entries for selected filter
                </p>
              )}
            </div>

            {/* Add Feedback */}
            <div className="mt-4 pt-4 border-t border-border">
              <Textarea
                placeholder="Add context or feedback (e.g., 'IPO week caused volume spike', 'System downtime on Tuesday')..."
                value={newFeedback}
                onChange={(e) => setNewFeedback(e.target.value)}
                className="mb-2 bg-secondary border-border resize-none"
                rows={2}
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={handleSubmit} disabled={!newFeedback.trim()}>
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
