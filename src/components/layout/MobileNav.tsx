import { useState } from "react";
import { 
  LayoutDashboard, 
  FileText, 
  Users, 
  Activity, 
  Settings,
  Shield,
  Bell,
  Wallet,
  History,
  Landmark,
  LogOut,
  Contact,
  Calculator,
  PieChart,
  Menu,
  X
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

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

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { signOut, user } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const handleNavClick = () => {
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden">
          <Menu className="h-6 w-6" />
          <span className="sr-only">Toggle menu</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0 bg-sidebar border-sidebar-border">
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg btn-gradient-gold">
                <span className="text-base font-bold text-primary-foreground">U</span>
              </div>
              <div>
                <h1 className="text-base font-semibold text-foreground">UCB Stock</h1>
                <p className="text-xs text-muted-foreground">Compliance ERP</p>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto space-y-1 px-3 py-4">
            {navigation.map((item) => (
              <NavLink
                key={item.name}
                to={item.href}
                onClick={handleNavClick}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeClassName="bg-sidebar-accent text-primary"
              >
                <item.icon className="h-5 w-5 flex-shrink-0" />
                <span>{item.name}</span>
              </NavLink>
            ))}
          </nav>

          {/* User & Logout */}
          <div className="border-t border-sidebar-border p-3 space-y-2">
            {user && (
              <div className="px-3 py-2 text-xs text-muted-foreground truncate">
                {user.email}
              </div>
            )}
            <button
              onClick={handleSignOut}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/20"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
