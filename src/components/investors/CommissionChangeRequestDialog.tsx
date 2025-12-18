import { useState } from "react";
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
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface CommissionChangeRequestDialogProps {
  open: boolean;
  onClose: () => void;
  investorCode: string;
  investorName: string;
  currentCommission: number | null;
}

export function CommissionChangeRequestDialog({
  open,
  onClose,
  investorCode,
  investorName,
  currentCommission,
}: CommissionChangeRequestDialogProps) {
  const { user } = useAuth();
  const [requestedCommission, setRequestedCommission] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!user) {
      toast.error("You must be logged in to submit a request");
      return;
    }

    const commissionValue = parseFloat(requestedCommission);
    if (isNaN(commissionValue) || commissionValue < 0 || commissionValue > 1) {
      toast.error("Commission rate must be between 0 and 1 (e.g., 0.0025 for 0.25%)");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from("commission_change_requests")
        .insert({
          investor_code: investorCode,
          investor_name: investorName,
          current_commission: currentCommission,
          requested_commission: commissionValue,
          reason: reason.trim() || null,
          requested_by: user.id,
          requested_by_email: user.email || "",
        });

      if (error) throw error;

      toast.success("Commission change request submitted successfully");
      onClose();
      setRequestedCommission("");
      setReason("");
    } catch (error: any) {
      console.error("Error submitting request:", error);
      toast.error(error.message || "Failed to submit request");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatCommission = (value: number | null) => {
    if (value === null) return "Not set";
    return `${value} (${(value * 100).toFixed(4)}%)`;
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request Commission Rate Change</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Investor</Label>
            <div className="text-sm text-muted-foreground bg-muted/30 p-2 rounded">
              {investorCode} - {investorName}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Current Commission Rate</Label>
            <div className="text-sm text-muted-foreground bg-muted/30 p-2 rounded">
              {formatCommission(currentCommission)}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="requestedCommission">New Commission Rate *</Label>
            <Input
              id="requestedCommission"
              type="number"
              step="0.0001"
              min="0"
              max="1"
              placeholder="e.g., 0.0025 for 0.25%"
              value={requestedCommission}
              onChange={(e) => setRequestedCommission(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">
              Enter as decimal (e.g., 0.0025 = 0.25%, 0.004 = 0.4%)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Reason for Change</Label>
            <Textarea
              id="reason"
              placeholder="Explain why the commission rate needs to be changed..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
