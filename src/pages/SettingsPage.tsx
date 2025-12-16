import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { User, Bell, Shield, LogOut, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { toast } from "sonner";

const SettingsPage = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      toast.success("Signed out successfully");
      navigate("/auth");
    } catch (error) {
      toast.error("Failed to sign out");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <MainLayout 
      title="Settings" 
      subtitle="Manage your account and system preferences"
    >
      <div className="max-w-3xl space-y-8">
        {/* Active Session */}
        <div className="glass-card rounded-xl p-6 animate-slide-up border-l-4 border-l-primary">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/20 text-primary">
                <User className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Signed in as</p>
                <p className="text-lg font-semibold text-foreground">{user?.email || "Not signed in"}</p>
                <p className="text-xs text-muted-foreground">
                  Last sign in: {user?.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleString() : "N/A"}
                </p>
              </div>
            </div>
            <Button 
              variant="destructive" 
              onClick={handleSignOut}
              disabled={signingOut}
              className="gap-2"
            >
              {signingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              Sign Out
            </Button>
          </div>
        </div>

        {/* Profile Settings */}
        <div className="glass-card rounded-xl p-6 animate-slide-up" style={{ animationDelay: "50ms" }}>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg btn-gradient-gold">
              <User className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-semibold font-serif text-foreground">Profile Settings</h3>
              <p className="text-sm text-muted-foreground">Manage your personal information</p>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email Address</Label>
              <Input 
                id="email" 
                type="email" 
                value={user?.email || ""} 
                disabled 
                className="bg-muted border-border" 
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user-id">User ID</Label>
              <Input 
                id="user-id" 
                value={user?.id || ""} 
                disabled 
                className="bg-muted border-border font-mono text-xs" 
              />
            </div>
          </div>
        </div>

        {/* Notification Settings */}
        <div className="glass-card rounded-xl p-6 animate-slide-up" style={{ animationDelay: "100ms" }}>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/20">
              <Bell className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h3 className="text-lg font-semibold font-serif text-foreground">Notification Preferences</h3>
              <p className="text-sm text-muted-foreground">Control how you receive alerts</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Email Notifications</p>
                <p className="text-xs text-muted-foreground">Receive compliance alerts via email</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator className="bg-border" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Deadline Reminders</p>
                <p className="text-xs text-muted-foreground">Get notified 3 days before due dates</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator className="bg-border" />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">Report Status Updates</p>
                <p className="text-xs text-muted-foreground">Notifications when reports are reviewed</p>
              </div>
              <Switch defaultChecked />
            </div>
          </div>
        </div>

        {/* Security Settings */}
        <div className="glass-card rounded-xl p-6 animate-slide-up" style={{ animationDelay: "200ms" }}>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/20">
              <Shield className="h-5 w-5 text-success" />
            </div>
            <div>
              <h3 className="text-lg font-semibold font-serif text-foreground">Security</h3>
              <p className="text-sm text-muted-foreground">Manage your account security</p>
            </div>
          </div>

          <div className="space-y-4">
            <Button variant="outline" className="w-full justify-start">
              Change Password
            </Button>
            <Button variant="outline" className="w-full justify-start">
              Enable Two-Factor Authentication
            </Button>
            <Button variant="outline" className="w-full justify-start">
              View Login History
            </Button>
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default SettingsPage;
