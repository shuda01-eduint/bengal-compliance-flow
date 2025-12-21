import { 
  LayoutDashboard, 
  FileText, 
  Users, 
  Activity, 
  Settings,
  Shield,
  Bell,
  ChevronLeft,
  ChevronRight,
  Wallet,
  History,
  Landmark,
  LogOut,
  Contact,
  Calculator,
  PieChart
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

interface SidebarProps {
  className?: string;
}

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "CEO Dashboard", href: "/ceo-dashboard", icon: PieChart },
  { name: "Trade History", href: "/trade-history", icon: History },
  { name: "Admin Balances", href: "/admin/balances", icon: Wallet },
  { name: "Securities", href: "/securities", icon: Landmark },
  { name: "Accounting", href: "/accounting", icon: Calculator },
  { name: "Investors", href: "/investors", icon: Contact },
  { name: "Compliance Reports", href: "/reports", icon: FileText },
  { name: "Post-Report Activity", href: "/activity", icon: Activity },
  { name: "Organization", href: "/employees", icon: Users },
  { name: "Compliance Rules", href: "/rules", icon: Shield },
  { name: "Notifications", href: "/notifications", icon: Bell },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar({ className }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { signOut, user } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };
  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300",
        collapsed ? "w-20" : "w-64",
        className
      )}
    >
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-20 items-center justify-between border-b border-sidebar-border px-4">
          {!collapsed && (
            <div className="flex items-center gap-3 animate-fade-in">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg btn-gradient-gold">
                <span className="text-lg font-bold text-primary-foreground">U</span>
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground">UCB Stock</h1>
                <p className="text-xs text-muted-foreground">Compliance ERP</p>
              </div>
            </div>
          )}
          {collapsed && (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg btn-gradient-gold mx-auto">
              <span className="text-lg font-bold text-primary-foreground">U</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 px-3 py-4">
          {navigation.map((item) => (
            <NavLink
              key={item.name}
              to={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                collapsed && "justify-center px-2"
              )}
              activeClassName="bg-sidebar-accent text-primary"
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              {!collapsed && <span>{item.name}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User & Logout */}
        <div className="border-t border-sidebar-border p-3 space-y-2">
          {!collapsed && user && (
            <div className="px-3 py-2 text-xs text-muted-foreground truncate">
              {user.email}
            </div>
          )}
          <button
            onClick={handleSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/20"
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span>Sign Out</span>}
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-sidebar-accent px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/80"
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </div>
    </aside>
  );
}
