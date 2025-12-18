import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { User, Phone, Mail, Building, CreditCard, Calendar, Edit, Users, UserCheck } from "lucide-react";
import { CommissionChangeRequestDialog } from "./CommissionChangeRequestDialog";
import { AssignmentChangeRequestDialog } from "./AssignmentChangeRequestDialog";

type Investor = {
  id: string;
  investor_code: string;
  investor_name: string;
  investor_type: string | null;
  bo_id: string | null;
  father_spouse_name: string | null;
  mother_name: string | null;
  home_address: string | null;
  date_of_birth: string | null;
  cell_no: string | null;
  email: string | null;
  account_open_date: string | null;
  bank_account_no: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  status: string | null;
  trader: string | null;
  account_type: string | null;
  interest_rate: number | null;
  brokerage_commission: number | null;
};

interface InvestorDetailDialogProps {
  investor: Investor | null;
  onClose: () => void;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return dateStr;
  }
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value || "-"}</span>
    </div>
  );
}

export function InvestorDetailDialog({ investor, onClose }: InvestorDetailDialogProps) {
  const [showChangeRequestDialog, setShowChangeRequestDialog] = useState(false);
  const [showRMChangeDialog, setShowRMChangeDialog] = useState(false);
  const [showAgentChangeDialog, setShowAgentChangeDialog] = useState(false);
  
  // Fetch RM assignments
  const { data: rmAssignments = [] } = useQuery({
    queryKey: ['rm-assignments', investor?.investor_code],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investor_rm_assignments')
        .select('*')
        .eq('investor_code', investor!.investor_code);
      if (error) throw error;
      return data || [];
    },
    enabled: !!investor,
  });

  // Fetch Agent assignments
  const { data: agentAssignments = [] } = useQuery({
    queryKey: ['agent-assignments', investor?.investor_code],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('investor_agent_assignments')
        .select('*')
        .eq('investor_code', investor!.investor_code);
      if (error) throw error;
      return data || [];
    },
    enabled: !!investor,
  });

  if (!investor) return null;

  return (
    <Dialog open={!!investor} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{investor.investor_name}</span>
            <Badge variant={investor.status === "Active" ? "default" : "destructive"}>
              {investor.status || "Unknown"}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Personal Information */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <User className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Personal Information</h3>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-sm">
              <DetailRow label="Code No" value={investor.investor_code} />
              <DetailRow label="BO ID" value={investor.bo_id} />
              <DetailRow label="Investor Type" value={investor.investor_type} />
              <DetailRow label="Father/Spouse Name" value={investor.father_spouse_name} />
              <DetailRow label="Mother Name" value={investor.mother_name} />
              <DetailRow label="Date of Birth" value={formatDate(investor.date_of_birth)} />
              <DetailRow label="Home Address" value={investor.home_address} />
            </div>
          </div>

          <Separator />

          {/* RM Assignments */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">RM Assignments</h3>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => setShowRMChangeDialog(true)}
                title="Request RM Change"
              >
                <Edit className="h-3 w-3" />
              </Button>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-sm">
              {rmAssignments.length > 0 ? (
                rmAssignments.map((rm, idx) => (
                  <div key={idx} className="flex justify-between py-1.5 border-b last:border-0 border-border/50">
                    <div>
                      <span className="font-medium">{rm.rm_name || rm.rm_email}</span>
                      {rm.department && (
                        <span className="text-muted-foreground ml-2">({rm.department})</span>
                      )}
                    </div>
                    <Badge variant="secondary">{rm.percentage}%</Badge>
                  </div>
                ))
              ) : (
                <span className="text-muted-foreground">No RM assigned</span>
              )}
            </div>
          </div>

          <Separator />

          {/* Agent Assignments */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Agent Assignments</h3>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => setShowAgentChangeDialog(true)}
                title="Request Agent Change"
              >
                <Edit className="h-3 w-3" />
              </Button>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-sm">
              {agentAssignments.length > 0 ? (
                agentAssignments.map((agent, idx) => (
                  <div key={idx} className="flex justify-between py-1.5 border-b last:border-0 border-border/50">
                    <div>
                      <span className="font-medium">{agent.agent_id}</span>
                      {agent.agent_name && (
                        <span className="text-muted-foreground ml-2">({agent.agent_name})</span>
                      )}
                    </div>
                    <Badge variant="secondary">{agent.percentage}%</Badge>
                  </div>
                ))
              ) : (
                <span className="text-muted-foreground">No Agent assigned</span>
              )}
            </div>
          </div>

          <Separator />

          {/* Contact Information */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Phone className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Contact Information</h3>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-sm">
              <DetailRow label="Cell No." value={investor.cell_no} />
              <DetailRow 
                label="Email" 
                value={investor.email ? (
                  <a href={`mailto:${investor.email}`} className="text-primary hover:underline">
                    {investor.email}
                  </a>
                ) : null} 
              />
            </div>
          </div>

          <Separator />

          {/* Bank Details */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Building className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Bank Details</h3>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-sm">
              <DetailRow label="Bank Name" value={investor.bank_name} />
              <DetailRow label="Branch" value={investor.bank_branch} />
              <DetailRow label="Account No." value={investor.bank_account_no} />
            </div>
          </div>

          <Separator />

          {/* Account Information */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Account Information</h3>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-sm">
              <DetailRow label="Account Type" value={investor.account_type} />
              <DetailRow label="Trader" value={investor.trader} />
              <DetailRow label="Account Open Date" value={formatDate(investor.account_open_date)} />
              <DetailRow 
                label="Interest Rate" 
                value={investor.interest_rate != null ? `${investor.interest_rate}%` : null} 
              />
              <DetailRow 
                label="Brokerage Commission" 
                value={
                  <div className="flex items-center gap-2">
                    <span>{investor.brokerage_commission != null ? `${investor.brokerage_commission} (${(investor.brokerage_commission * 100).toFixed(4)}%)` : "-"}</span>
                    <Button 
                      size="icon" 
                      variant="ghost" 
                      className="h-6 w-6"
                      onClick={() => setShowChangeRequestDialog(true)}
                      title="Request Commission Change"
                    >
                      <Edit className="h-3 w-3" />
                    </Button>
                  </div>
                } 
              />
            </div>
          </div>
        </div>

        {/* Commission Change Request Dialog */}
        <CommissionChangeRequestDialog
          open={showChangeRequestDialog}
          onClose={() => setShowChangeRequestDialog(false)}
          investorCode={investor.investor_code}
          investorName={investor.investor_name}
          currentCommission={investor.brokerage_commission}
        />

        {/* RM Assignment Change Dialog */}
        <AssignmentChangeRequestDialog
          open={showRMChangeDialog}
          onClose={() => setShowRMChangeDialog(false)}
          investorCode={investor.investor_code}
          investorName={investor.investor_name}
          changeType="rm"
          currentAssignments={rmAssignments.map(rm => ({
            rm_email: rm.rm_email,
            rm_name: rm.rm_name || '',
            department: rm.department || '',
            percentage: rm.percentage,
          }))}
        />

        {/* Agent Assignment Change Dialog */}
        <AssignmentChangeRequestDialog
          open={showAgentChangeDialog}
          onClose={() => setShowAgentChangeDialog(false)}
          investorCode={investor.investor_code}
          investorName={investor.investor_name}
          changeType="agent"
          currentAssignments={agentAssignments.map(agent => ({
            agent_id: agent.agent_id,
            agent_name: agent.agent_name || '',
            percentage: agent.percentage,
          }))}
        />
      </DialogContent>
    </Dialog>
  );
}