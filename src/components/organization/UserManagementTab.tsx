import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Check, X, Search, Shield, Users, Clock, RefreshCw, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { ImportDepartmentHeadsDialog } from "./ImportDepartmentHeadsDialog";
import { ImportMANCOMDialog } from "./ImportMANCOMDialog";

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  is_approved: boolean;
  created_at: string;
}

type AppRole = "admin" | "mancom" | "department_head" | "branch_manager" | "rm" | "agent" | "user";

interface UserRole {
  user_id: string;
  role: AppRole;
}

export function UserManagementTab() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "approved">("all");
  const [isSyncing, setIsSyncing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const syncDepartments = async () => {
    setIsSyncing(true);
    try {
      const { data, error } = await supabase.rpc("sync_departments_from_employees");
      if (error) throw error;
      
      const result = data as { departments_created: number; total_departments: number };
      toast({
        title: "Departments Synced",
        description: `${result.departments_created} new departments created. Total: ${result.total_departments}`,
      });
      queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Profile[];
    },
  });

  const { data: userRoles } = useQuery({
    queryKey: ["admin-user-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, role");
      if (error) throw error;
      return data as UserRole[];
    },
  });

  const approvalMutation = useMutation({
    mutationFn: async ({ userId, approve }: { userId: string; approve: boolean }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ is_approved: approve })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: (_, { approve }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
      toast({
        title: approve ? "User Approved" : "Approval Revoked",
        description: approve 
          ? "User can now log in to the system." 
          : "User's access has been revoked.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const roleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      await supabase.from("user_roles").delete().eq("user_id", userId);
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role: role as any });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-user-roles"] });
      toast({
        title: "Role Updated",
        description: "User role has been updated successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getUserRole = (userId: string): AppRole => {
    const role = userRoles?.find(r => r.user_id === userId);
    return role?.role ?? "user";
  };

  const filteredProfiles = profiles?.filter(profile => {
    const matchesSearch = 
      profile.email.toLowerCase().includes(search.toLowerCase()) ||
      (profile.full_name?.toLowerCase().includes(search.toLowerCase()) ?? false);
    
    const matchesFilter = 
      filter === "all" ||
      (filter === "pending" && !profile.is_approved) ||
      (filter === "approved" && profile.is_approved);
    
    return matchesSearch && matchesFilter;
  });

  const pendingCount = profiles?.filter(p => !p.is_approved).length ?? 0;
  const approvedCount = profiles?.filter(p => p.is_approved).length ?? 0;

  // Calculate role distribution
  const roleDistribution = userRoles?.reduce((acc, role) => {
    acc[role.role] = (acc[role.role] || 0) + 1;
    return acc;
  }, {} as Record<string, number>) ?? {};

  const adminCount = roleDistribution.admin ?? 0;
  const mancomCount = roleDistribution.mancom ?? 0;
  const rmCount = roleDistribution.rm ?? 0;
  const branchManagerCount = roleDistribution.branch_manager ?? 0;
  const agentCount = roleDistribution.agent ?? 0;
  const userCount = roleDistribution.user ?? 0;

  const roleColors: Record<string, string> = {
    admin: "bg-destructive",
    mancom: "bg-primary",
    rm: "bg-success",
    branch_manager: "bg-warning",
    agent: "bg-secondary",
    user: "bg-muted-foreground",
  };

  const roleLabels: Record<string, string> = {
    admin: "Admin",
    mancom: "MANCOM",
    rm: "RM",
    branch_manager: "Branch Mgr",
    agent: "Agent",
    user: "User",
  };

  const totalRoles = Object.values(roleDistribution).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="glass-card">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="p-3 rounded-lg bg-primary/10">
              <Users className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{profiles?.length ?? 0}</p>
              <p className="text-sm text-muted-foreground">Total Users</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="p-3 rounded-lg bg-warning/10">
              <Clock className="h-6 w-6 text-warning" />
            </div>
            <div>
              <p className="text-2xl font-bold">{pendingCount}</p>
              <p className="text-sm text-muted-foreground">Pending Approval</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="p-3 rounded-lg bg-success/10">
              <Shield className="h-6 w-6 text-success" />
            </div>
            <div>
              <p className="text-2xl font-bold">{approvedCount}</p>
              <p className="text-sm text-muted-foreground">Approved Users</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="p-3 rounded-lg bg-destructive/10">
              <Shield className="h-6 w-6 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold">{adminCount}</p>
              <p className="text-sm text-muted-foreground">Administrators</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Role Distribution */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Role Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Progress Bar */}
            <div className="h-3 rounded-full bg-muted overflow-hidden flex">
              {Object.entries(roleDistribution).map(([role, count]) => {
                const percentage = totalRoles > 0 ? (count / totalRoles) * 100 : 0;
                return percentage > 0 ? (
                  <div
                    key={role}
                    className={`${roleColors[role] || "bg-muted-foreground"} transition-all`}
                    style={{ width: `${percentage}%` }}
                    title={`${roleLabels[role] || role}: ${count}`}
                  />
                ) : null;
              })}
            </div>
            {/* Legend */}
            <div className="flex flex-wrap gap-4">
              {Object.entries(roleDistribution)
                .sort((a, b) => b[1] - a[1])
                .map(([role, count]) => (
                  <div key={role} className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${roleColors[role] || "bg-muted-foreground"}`} />
                    <span className="text-sm text-muted-foreground">
                      {roleLabels[role] || role}: <span className="font-medium text-foreground">{count}</span>
                    </span>
                  </div>
                ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Admin Actions */}
      <Card className="glass-card">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-center">
            <span className="text-sm font-medium text-muted-foreground">Admin Actions:</span>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={syncDepartments}
              disabled={isSyncing}
            >
              {isSyncing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Sync Departments
            </Button>
            <ImportDepartmentHeadsDialog 
              onSuccess={() => queryClient.invalidateQueries({ queryKey: ["admin-profiles"] })} 
            />
            <ImportMANCOMDialog 
              onSuccess={() => queryClient.invalidateQueries({ queryKey: ["admin-profiles", "admin-user-roles"] })} 
            />
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                <SelectItem value="pending">Pending Approval</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <p className="text-center py-8 text-muted-foreground">Loading users...</p>
          ) : filteredProfiles?.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No users found</p>
          ) : (
            <div className="rounded-lg border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProfiles?.map((profile) => (
                    <TableRow key={profile.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{profile.full_name || "No name"}</p>
                          <p className="text-sm text-muted-foreground">{profile.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {profile.is_approved ? (
                          <Badge variant="default" className="bg-success/20 text-success border-success/30">
                            Approved
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-warning/20 text-warning border-warning/30">
                            Pending
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select 
                          value={getUserRole(profile.id)} 
                          onValueChange={(role) => roleMutation.mutate({ userId: profile.id, role: role as AppRole })}
                        >
                          <SelectTrigger className="w-[150px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="mancom">MANCOM</SelectItem>
                            <SelectItem value="department_head">Department Head</SelectItem>
                            <SelectItem value="branch_manager">Branch Manager</SelectItem>
                            <SelectItem value="rm">RM</SelectItem>
                            <SelectItem value="agent">Agent</SelectItem>
                            <SelectItem value="user">User</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {format(new Date(profile.created_at), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-right">
                        {profile.is_approved ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => approvalMutation.mutate({ userId: profile.id, approve: false })}
                            className="text-destructive hover:text-destructive"
                          >
                            <X className="h-4 w-4 mr-1" />
                            Revoke
                          </Button>
                        ) : (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => approvalMutation.mutate({ userId: profile.id, approve: true })}
                          >
                            <Check className="h-4 w-4 mr-1" />
                            Approve
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
