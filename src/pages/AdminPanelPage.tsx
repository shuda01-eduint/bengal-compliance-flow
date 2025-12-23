import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MainLayout } from "@/components/layout/MainLayout";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Check, X, Plus, Trash2, Search, Shield, Users, UserCheck } from "lucide-react";
import { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

interface UserWithRoles {
  id: string;
  email: string;
  full_name: string | null;
  is_approved: boolean;
  is_department_head: boolean;
  is_mancom: boolean;
  created_at: string;
  roles: AppRole[];
}

const AVAILABLE_ROLES: AppRole[] = ["admin", "rm", "user", "agent", "mancom", "branch_manager"];

export default function AdminPanelPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterApproved, setFilterApproved] = useState<"all" | "approved" | "pending">("all");
  const queryClient = useQueryClient();

  const { data: users, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      // Fetch profiles
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

      if (profilesError) throw profilesError;

      // Fetch all user roles
      const { data: userRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("*");

      if (rolesError) throw rolesError;

      // Combine profiles with their roles
      const usersWithRoles: UserWithRoles[] = profiles.map((profile) => ({
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        is_approved: profile.is_approved,
        is_department_head: profile.is_department_head,
        is_mancom: profile.is_mancom,
        created_at: profile.created_at,
        roles: userRoles
          .filter((r) => r.user_id === profile.id)
          .map((r) => r.role),
      }));

      return usersWithRoles;
    },
  });

  const updateApprovalMutation = useMutation({
    mutationFn: async ({ userId, isApproved }: { userId: string; isApproved: boolean }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ is_approved: isApproved })
        .eq("id", userId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("User approval status updated");
    },
    onError: (error) => {
      toast.error("Failed to update approval: " + error.message);
    },
  });

  const addRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Role added successfully");
    },
    onError: (error) => {
      toast.error("Failed to add role: " + error.message);
    },
  });

  const removeRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", role);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success("Role removed successfully");
    },
    onError: (error) => {
      toast.error("Failed to remove role: " + error.message);
    },
  });

  const filteredUsers = users?.filter((user) => {
    const matchesSearch =
      user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.full_name?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesFilter =
      filterApproved === "all" ||
      (filterApproved === "approved" && user.is_approved) ||
      (filterApproved === "pending" && !user.is_approved);

    return matchesSearch && matchesFilter;
  });

  const pendingCount = users?.filter((u) => !u.is_approved).length || 0;
  const approvedCount = users?.filter((u) => u.is_approved).length || 0;
  const adminCount = users?.filter((u) => u.roles.includes("admin")).length || 0;

  return (
    <MainLayout title="Admin Panel" subtitle="Manage user roles and approvals">
      <div className="space-y-6">
        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Users</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{users?.length || 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Approval</CardTitle>
              <UserCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{pendingCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Admins</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{adminCount}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>User Management</CardTitle>
            <CardDescription>View and manage all registered users</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select value={filterApproved} onValueChange={(v) => setFilterApproved(v as typeof filterApproved)}>
                <SelectTrigger className="w-full md:w-[180px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Users</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading users...</div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead>Add Role</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          No users found
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredUsers?.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell>
                            <div>
                              <div className="font-medium">{user.full_name || "No name"}</div>
                              <div className="text-sm text-muted-foreground">{user.email}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={user.is_approved}
                                onCheckedChange={(checked) =>
                                  updateApprovalMutation.mutate({ userId: user.id, isApproved: checked })
                                }
                              />
                              <Badge variant={user.is_approved ? "default" : "secondary"}>
                                {user.is_approved ? "Approved" : "Pending"}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {user.roles.length === 0 ? (
                                <span className="text-sm text-muted-foreground">No roles</span>
                              ) : (
                                user.roles.map((role) => (
                                  <Badge
                                    key={role}
                                    variant={role === "admin" ? "destructive" : "outline"}
                                    className="cursor-pointer hover:opacity-80"
                                    onClick={() => {
                                      if (confirm(`Remove "${role}" role from this user?`)) {
                                        removeRoleMutation.mutate({ userId: user.id, role });
                                      }
                                    }}
                                  >
                                    {role}
                                    <X className="h-3 w-3 ml-1" />
                                  </Badge>
                                ))
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Select
                              onValueChange={(role) => addRoleMutation.mutate({ userId: user.id, role: role as AppRole })}
                            >
                              <SelectTrigger className="w-[130px]">
                                <SelectValue placeholder="Add role" />
                              </SelectTrigger>
                              <SelectContent>
                                {AVAILABLE_ROLES.filter((r) => !user.roles.includes(r)).map((role) => (
                                  <SelectItem key={role} value={role}>
                                    {role}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant={user.is_approved ? "outline" : "default"}
                              onClick={() =>
                                updateApprovalMutation.mutate({ userId: user.id, isApproved: !user.is_approved })
                              }
                            >
                              {user.is_approved ? (
                                <>
                                  <X className="h-4 w-4 mr-1" /> Revoke
                                </>
                              ) : (
                                <>
                                  <Check className="h-4 w-4 mr-1" /> Approve
                                </>
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
