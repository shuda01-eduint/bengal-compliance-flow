import { useState } from "react";
import { Search, Eye, Briefcase, BarChart3, History, Settings } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MarketNavBarProps {
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  onSearch?: (query: string) => void;
}

const navItems = [
  { id: "watchlist", label: "Watchlist", icon: Eye },
  { id: "portfolio", label: "Portfolio", icon: Briefcase },
  { id: "birdseye", label: "Bird's Eye", icon: BarChart3 },
  { id: "historical", label: "Historical", icon: History },
  { id: "admin", label: "Admin", icon: Settings },
];

export function MarketNavBar({ activeTab = "birdseye", onTabChange, onSearch }: MarketNavBarProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    onSearch?.(e.target.value);
  };

  return (
    <div className="flex items-center gap-4 mb-6 p-3 rounded-xl bg-card/50 border border-border/50 backdrop-blur-sm">
      <div className="relative flex-1 max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search stocks..."
          value={searchQuery}
          onChange={handleSearchChange}
          className="pl-9 pr-12 bg-background/50 border-border/50 focus:border-primary/50"
        />
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </div>

      <div className="flex items-center gap-1">
        {navItems.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            size="sm"
            className={cn(
              "flex items-center gap-2 text-muted-foreground hover:text-white transition-colors",
              activeTab === item.id && "bg-primary/20 text-primary"
            )}
            onClick={() => onTabChange?.(item.id)}
          >
            <item.icon className="h-4 w-4" />
            <span className="hidden lg:inline">{item.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
