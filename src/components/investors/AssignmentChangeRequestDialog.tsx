import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Users, UserCheck } from "lucide-react";

interface RMAssignment {
  rm_email: string;
  rm_name: string;
  department: string;
  percentage: number;
}

interface AgentAssignment {
  agent_id: string;
  agent_name: string;
  percentage: number;
}

interface AssignmentChangeRequestDialogProps {
  open: boolean;
  onClose: () => void;
  investorCode: string;
  investorName: string;
  changeType: 'rm' | 'agent';
  currentAssignments: RMAssignment[] | AgentAssignment[];
}

export function AssignmentChangeRequestDialog({
  open,
  onClose,
  investorCode,
  investorName,
  changeType,
  currentAssignments,
}: AssignmentChangeRequestDialogProps) {
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reason, setReason] = useState("");
  const [assignments, setAssignments] = useState<(RMAssignment | AgentAssignment)[]>(
    currentAssignments.length > 0 ? [...currentAssignments] : 
    changeType === 'rm' 
      ? [{ rm_email: '', rm_name: '', department: '', percentage: 100 }]
      : [{ agent_id: '', agent_name: '', percentage: 100 }]
  );

  // Fetch employees for RM dropdown
  const { data: employees = [] } = useQuery({
    queryKey: ['employees-for-rm'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employees')
        .select('employee_id, name, email, department')
        .eq('status', 'Active')
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: open && changeType === 'rm',
  });

  // Fetch departments
  const { data: departments = [] } = useQuery({
    queryKey: ['departments-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('departments')
        .select('id, name')
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: open && changeType === 'rm',
  });

  // Fetch agents from agent_codes
  const { data: agents = [] } = useQuery({
    queryKey: ['agents-for-assignment'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agent_codes')
        .select('agent_id, rm_id')
        .order('agent_id');
      if (error) throw error;
      // Get unique agent IDs
      const uniqueAgents = [...new Set((data || []).map(a => a.agent_id))];
      return uniqueAgents.map(id => ({ agent_id: id }));
    },
    enabled: open && changeType === 'agent',
  });

  const handleAddAssignment = () => {
    if (changeType === 'rm') {
      setAssignments([...assignments, { rm_email: '', rm_name: '', department: '', percentage: 0 }]);
    } else {
      setAssignments([...assignments, { agent_id: '', agent_name: '', percentage: 0 }]);
    }
  };

  const handleRemoveAssignment = (index: number) => {
    if (assignments.length > 1) {
      setAssignments(assignments.filter((_, i) => i !== index));
    }
  };

  const handleAssignmentChange = (index: number, field: string, value: string | number) => {
    const updated = [...assignments];
    if (changeType === 'rm' && field === 'rm_email') {
      const employee = employees.find(e => e.email === value);
      (updated[index] as RMAssignment) = {
        ...(updated[index] as RMAssignment),
        rm_email: value as string,
        rm_name: employee?.name || '',
        department: employee?.department || (updated[index] as RMAssignment).department,
      };
    } else {
      (updated[index] as any)[field] = value;
    }
    setAssignments(updated);
  };

  const totalPercentage = assignments.reduce((sum, a) => sum + (a.percentage || 0), 0);

  const handleSubmit = async () => {
    if (!user) {
      toast.error("Please login to submit a request");
      return;
    }

    if (totalPercentage !== 100) {
      toast.error("Total percentage must equal 100%");
      return;
    }

    // Validate assignments
    if (changeType === 'rm') {
      const rmAssignments = assignments as RMAssignment[];
      if (rmAssignments.some(a => !a.rm_email)) {
        toast.error("Please select an RM for all assignments");
        return;
      }
    } else {
      const agentAssignments = assignments as AgentAssignment[];
      if (agentAssignments.some(a => !a.agent_id)) {
        toast.error("Please select an Agent for all assignments");
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('id', user.id)
        .single();

      const { error } = await supabase
        .from('assignment_change_requests')
        .insert([{
          investor_code: investorCode,
          investor_name: investorName,
          change_type: changeType,
          current_assignments: currentAssignments as any,
          requested_assignments: assignments as any,
          reason,
          requested_by: user.id,
          requested_by_email: profile?.email || user.email || '',
        }]);

      if (error) throw error;

      toast.success(`${changeType === 'rm' ? 'RM' : 'Agent'} assignment change request submitted`);
      onClose();
      setReason("");
    } catch (error: any) {
      console.error('Error submitting request:', error);
      toast.error(error.message || "Failed to submit request");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {changeType === 'rm' ? <Users className="h-5 w-5" /> : <UserCheck className="h-5 w-5" />}
            Request {changeType === 'rm' ? 'RM' : 'Agent'} Assignment Change
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Investor: <span className="font-medium text-foreground">{investorCode} - {investorName}</span>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Assignments</Label>
              <Button type="button" variant="outline" size="sm" onClick={handleAddAssignment}>
                <Plus className="h-4 w-4 mr-1" /> Add
              </Button>
            </div>

            {assignments.map((assignment, index) => (
              <div key={index} className="flex gap-2 items-end p-3 bg-muted/30 rounded-lg">
                {changeType === 'rm' ? (
                  <>
                    <div className="flex-1 space-y-2">
                      <Label className="text-xs">RM</Label>
                      <Select
                        value={(assignment as RMAssignment).rm_email}
                        onValueChange={(v) => handleAssignmentChange(index, 'rm_email', v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select RM" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map((emp) => (
                            <SelectItem key={emp.email} value={emp.email}>
                              {emp.name} ({emp.email})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-28 space-y-2">
                      <Label className="text-xs">Department</Label>
                      <Select
                        value={(assignment as RMAssignment).department}
                        onValueChange={(v) => handleAssignmentChange(index, 'department', v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Dept" />
                        </SelectTrigger>
                        <SelectContent>
                          {departments.map((dept) => (
                            <SelectItem key={dept.id} value={dept.name}>
                              {dept.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex-1 space-y-2">
                      <Label className="text-xs">Agent ID</Label>
                      <Select
                        value={(assignment as AgentAssignment).agent_id}
                        onValueChange={(v) => handleAssignmentChange(index, 'agent_id', v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select Agent" />
                        </SelectTrigger>
                        <SelectContent>
                          {agents.map((agent) => (
                            <SelectItem key={agent.agent_id} value={agent.agent_id}>
                              {agent.agent_id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1 space-y-2">
                      <Label className="text-xs">Agent Name</Label>
                      <Input
                        className="h-9"
                        value={(assignment as AgentAssignment).agent_name}
                        onChange={(e) => handleAssignmentChange(index, 'agent_name', e.target.value)}
                        placeholder="Agent name"
                      />
                    </div>
                  </>
                )}
                <div className="w-20 space-y-2">
                  <Label className="text-xs">%</Label>
                  <Input
                    type="number"
                    className="h-9"
                    min={0}
                    max={100}
                    value={assignment.percentage}
                    onChange={(e) => handleAssignmentChange(index, 'percentage', Number(e.target.value))}
                  />
                </div>
                {assignments.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-destructive"
                    onClick={() => handleRemoveAssignment(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}

            <div className={`text-sm text-right ${totalPercentage === 100 ? 'text-green-600' : 'text-destructive'}`}>
              Total: {totalPercentage}%
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason for Change</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this change is needed..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting || totalPercentage !== 100}>
            {isSubmitting ? "Submitting..." : "Submit Request"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
