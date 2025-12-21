import { Bell, Search, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MobileNav } from "./MobileNav";

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 lg:h-20 items-center justify-between border-b border-border bg-background/80 backdrop-blur-lg px-4 lg:px-6">
      <div className="flex items-center gap-3">
        {/* Mobile Nav */}
        <MobileNav />
        
        <div className="min-w-0">
          <h1 className="text-lg lg:text-2xl font-serif font-semibold text-foreground truncate">{title}</h1>
          {subtitle && <p className="text-xs lg:text-sm text-muted-foreground truncate hidden sm:block">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 lg:gap-4">
        {/* Search */}
        <div className="relative hidden lg:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search reports, employees..."
            className="w-72 bg-secondary border-border pl-10 focus:border-primary"
          />
        </div>

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground h-9 w-9 lg:h-10 lg:w-10">
          <Bell className="h-5 w-5" />
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
            3
          </span>
        </Button>

        {/* User */}
        <div className="flex items-center gap-2 lg:gap-3 rounded-lg bg-secondary px-2 lg:px-3 py-1.5 lg:py-2">
          <div className="flex h-7 w-7 lg:h-8 lg:w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <User className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
          </div>
          <div className="hidden md:block">
            <p className="text-sm font-medium text-foreground">Admin</p>
            <p className="text-xs text-muted-foreground">Compliance Officer</p>
          </div>
        </div>
      </div>
    </header>
  );
}
