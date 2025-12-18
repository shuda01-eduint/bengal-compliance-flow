import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, X, Loader2, Clock, CheckCircle, XCircle, ArrowRight } from "lucide-react";
import { format } from "date-fns";

type CommissionRequest = {
  id: string;
  investor_code: string;
  investor_name: string | null;
  current_commission: number | null;
  requested_commission: number;
  reason: string | null;
  requested_by_email: string;
  requested_at: string;
  status: string;
  manager_notes: string | null;
  manager_approved_at: string | null;
  admin_notes: string | null;
  admin_approved_at: string | null;
  rejection_reason: string | null;
};

export function CommissionApprovalTab() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<CommissionRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isDeptHead, setIsDeptHead] = useState(false);
  const [actionDialog, setActionDialog] = useState<{
    type: "approve" | "reject";
    request: CommissionRequest;
  } | null>(null);
  const [notes, setNotes] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (user) {
      checkUserRole();
      fetchRequests();
    }
  }, [user]);

  const checkUserRole = async () => {
    if (!user) return;

    // Check if admin
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .single();
    setIsAdmin(!!roleData);

    // Check if department head
    const { data: profileData } = await supabase
      .from("profiles")
      .select("is_department_head")
      .eq("id", user.id)
      .single();
    setIsDeptHead(profileData?.is_department_head || false);
  };

  const fetchRequests = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("commission_change_requests")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setRequests(data || []);
    } catch (error: any) {
      console.error("Error fetching requests:", error);
      toast.error("Failed to load commission change requests");
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!actionDialog || !user) return;
    const { request } = actionDialog;

    setIsProcessing(true);
    try {
      let updateData: Record<string, any> = {};

      if (request.status === "pending_manager" && isDeptHead) {
        // Manager approval -> move to pending_admin
        updateData = {
          status: "pending_admin",
          manager_approved_by: user.id,
          manager_approved_at: new Date().toISOString(),
          manager_notes: notes.trim() || null,
        };
      } else if ((request.status === "pending_admin" || request.status === "pending_manager") && isAdmin) {
        // Admin final approval
        updateData = {
          status: "approved",
          admin_approved_by: user.id,
          admin_approved_at: new Date().toISOString(),
          admin_notes: notes.trim() || null,
        };
        // If admin is approving a pending_manager request, also set manager fields
        if (request.status === "pending_manager") {
          updateData.manager_approved_by = user.id;
          updateData.manager_approved_at = new Date().toISOString();
          updateData.manager_notes = "Approved directly by admin";
        }
      }

      const { error } = await supabase
        .from("commission_change_requests")
        .update(updateData)
        .eq("id", request.id);

      if (error) throw error;

      toast.success(
        updateData.status === "approved" 
          ? "Request approved! Commission rate updated." 
          : "Request approved and forwarded to admin."
      );
      setActionDialog(null);
      setNotes("");
      fetchRequests();
    } catch (error: any) {
      console.error("Error approving request:", error);
      toast.error(error.message || "Failed to approve request");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!actionDialog || !user) return;
    const { request } = actionDialog;

    if (!notes.trim()) {
      toast.error("Please provide a reason for rejection");
      return;
    }

    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from("commission_change_requests")
        .update({
          status: "rejected",
          rejected_by: user.id,
          rejected_at: new Date().toISOString(),
          rejection_reason: notes.trim(),
        })
        .eq("id", request.id);

      if (error) throw error;

      toast.success("Request rejected");
      setActionDialog(null);
      setNotes("");
      fetchRequests();
    } catch (error: any) {
      console.error("Error rejecting request:", error);
      toast.error(error.message || "Failed to reject request");
    } finally {
      setIsProcessing(false);
    }
  };

  const formatCommission = (value: number | null) => {
    if (value === null) return "-";
    return `${(value * 100).toFixed(4)}%`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending_manager":
        return <Badge variant="outline" className="gap-1"><Clock className="h-3 w-3" />Pending Manager</Badge>;
      case "pending_admin":
        return <Badge variant="secondary" className="gap-1"><ArrowRight className="h-3 w-3" />Pending Admin</Badge>;
      case "approved":
        return <Badge className="gap-1 bg-green-600"><CheckCircle className="h-3 w-3" />Approved</Badge>;
      case "rejected":
        return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const canTakeAction = (request: CommissionRequest) => {
    if (isAdmin) {
      return request.status === "pending_manager" || request.status === "pending_admin";
    }
    if (isDeptHead) {
      return request.status === "pending_manager";
    }
    return false;
  };

  // Summary counts
  const pendingManagerCount = requests.filter(r => r.status === "pending_manager").length;
  const pendingAdminCount = requests.filter(r => r.status === "pending_admin").length;
  const approvedCount = requests.filter(r => r.status === "approved").length;
  const rejectedCount = requests.filter(r => r.status === "rejected").length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Manager</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{pendingManagerCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending Admin</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{pendingAdminCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Approved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{approvedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Rejected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{rejectedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Requests Table */}
      <Card>
        <CardHeader>
          <CardTitle>Commission Change Requests</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No commission change requests found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Investor</TableHead>
                    <TableHead>Current</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Requested By</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{request.investor_code}</div>
                          <div className="text-sm text-muted-foreground">{request.investor_name}</div>
                        </div>
                      </TableCell>
                      <TableCell>{formatCommission(request.current_commission)}</TableCell>
                      <TableCell className="font-medium">{formatCommission(request.requested_commission)}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={request.reason || ""}>
                        {request.reason || "-"}
                      </TableCell>
                      <TableCell>{request.requested_by_email}</TableCell>
                      <TableCell>{format(new Date(request.requested_at), "dd MMM yyyy")}</TableCell>
                      <TableCell>{getStatusBadge(request.status)}</TableCell>
                      <TableCell className="text-right">
                        {canTakeAction(request) && (
                          <div className="flex gap-2 justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-600 hover:text-green-700"
                              onClick={() => setActionDialog({ type: "approve", request })}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 hover:text-red-700"
                              onClick={() => setActionDialog({ type: "reject", request })}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                        {request.status === "rejected" && request.rejection_reason && (
                          <span className="text-xs text-muted-foreground" title={request.rejection_reason}>
                            {request.rejection_reason.slice(0, 30)}...
                          </span>
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

      {/* Action Dialog */}
      <Dialog open={!!actionDialog} onOpenChange={() => setActionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionDialog?.type === "approve" ? "Approve Request" : "Reject Request"}
            </DialogTitle>
          </DialogHeader>

          {actionDialog && (
            <div className="space-y-4">
              <div className="bg-muted/30 p-4 rounded-lg space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Investor:</span>
                  <span className="font-medium">{actionDialog.request.investor_code} - {actionDialog.request.investor_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Rate:</span>
                  <span>{formatCommission(actionDialog.request.current_commission)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Requested Rate:</span>
                  <span className="font-medium text-primary">{formatCommission(actionDialog.request.requested_commission)}</span>
                </div>
                {actionDialog.request.reason && (
                  <div className="pt-2 border-t">
                    <span className="text-muted-foreground">Reason:</span>
                    <p className="mt-1 text-sm">{actionDialog.request.reason}</p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {actionDialog.type === "approve" ? "Notes (optional)" : "Rejection Reason *"}
                </label>
                <Textarea
                  placeholder={actionDialog.type === "approve" ? "Add any notes..." : "Explain why the request is rejected..."}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setActionDialog(null)}>
                  Cancel
                </Button>
                {actionDialog.type === "approve" ? (
                  <Button onClick={handleApprove} disabled={isProcessing}>
                    {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isAdmin && actionDialog.request.status === "pending_manager" 
                      ? "Approve & Complete" 
                      : isDeptHead && !isAdmin 
                        ? "Approve & Forward to Admin" 
                        : "Approve"}
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={handleReject} disabled={isProcessing}>
                    {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Reject
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
