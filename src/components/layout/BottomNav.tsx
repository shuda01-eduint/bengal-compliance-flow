import { LayoutDashboard, History, Calculator, Landmark, Menu, Wallet } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { cn } from "@/lib/utils";
import { useUserRole } from "@/hooks/useUserRole";

interface BottomNavProps {
  onMenuClick: () => void;
}

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Balances", href: "/admin/balances", icon: Wallet },
  { name: "Trades", href: "/trade-history", icon: History, adminOnly: true },
  { name: "Accounting", href: "/accounting", icon: Calculator, adminOnly: true },
  { name: "Securities", href: "/securities", icon: Landmark, adminOnly: true },
];

export function BottomNav({ onMenuClick }: BottomNavProps) {
  const { isAdmin } = useUserRole();
  
  const filteredNavItems = navItems.filter(item => 
    !item.adminOnly || isAdmin
  );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-background/95 backdrop-blur-md border-t border-border safe-area-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {filteredNavItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.href}
            className="flex flex-col items-center justify-center gap-1 px-3 py-2 text-muted-foreground transition-colors rounded-lg min-w-[60px]"
            activeClassName="text-primary bg-primary/10"
          >
            <item.icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{item.name}</span>
          </NavLink>
        ))}
        {isAdmin && (
          <button
            onClick={onMenuClick}
            className="flex flex-col items-center justify-center gap-1 px-3 py-2 text-muted-foreground transition-colors rounded-lg min-w-[60px] hover:text-foreground"
          >
            <Menu className="h-5 w-5" />
            <span className="text-[10px] font-medium">More</span>
          </button>
        )}
      </div>
    </nav>
  );
}
