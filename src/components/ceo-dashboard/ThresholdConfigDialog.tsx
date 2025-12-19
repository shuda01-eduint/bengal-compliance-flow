import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Threshold, useThresholds } from "@/hooks/useThresholds";
import { toast } from "sonner";
import { Loader2, AlertTriangle, AlertCircle, CheckCircle } from "lucide-react";

interface ThresholdConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ThresholdConfigDialog({ open, onOpenChange }: ThresholdConfigDialogProps) {
  const { thresholds, updateThreshold, isLoading } = useThresholds();
  const [editedThresholds, setEditedThresholds] = useState<Record<string, Partial<Threshold>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (thresholds && open) {
      const initial: Record<string, Partial<Threshold>> = {};
      thresholds.forEach((t) => {
        initial[t.id] = { ...t };
      });
      setEditedThresholds(initial);
    }
  }, [thresholds, open]);

  const handleChange = (id: string, field: keyof Threshold, value: any) => {
    setEditedThresholds((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value,
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const promises = Object.entries(editedThresholds).map(([id, updates]) =>
        updateThreshold.mutateAsync({ id, ...updates })
      );
      await Promise.all(promises);
      toast.success("Thresholds updated successfully");
      onOpenChange(false);
    } catch (error) {
      toast.error("Failed to update thresholds");
      console.error(error);
    } finally {
      setSaving(false);
    }
  };

  const formatNumber = (val: number | null | undefined): string => {
    if (val === null || val === undefined) return "";
    return val.toString();
  };

  const parseNumber = (val: string): number | null => {
    if (val === "" || val === undefined) return null;
    const num = parseFloat(val);
    return isNaN(num) ? null : num;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Configure Alert Thresholds</DialogTitle>
          <DialogDescription>
            Set warning and critical thresholds for each dashboard tile. Status colors will update automatically based on these values.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-6">
              {thresholds?.map((threshold) => {
                const edited = editedThresholds[threshold.id] || threshold;
                return (
                  <div key={threshold.id} className="space-y-4 p-4 rounded-lg bg-secondary/30">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <h4 className="font-medium">{threshold.tile_name}</h4>
                        <Badge variant="outline" className="text-xs">
                          {threshold.metric_type}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`enabled-${threshold.id}`} className="text-sm text-muted-foreground">
                          Enabled
                        </Label>
                        <Switch
                          id={`enabled-${threshold.id}`}
                          checked={edited.is_enabled ?? true}
                          onCheckedChange={(checked) => handleChange(threshold.id, "is_enabled", checked)}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 text-warning" />
                          Warning
                        </Label>
                        <Input
                          type="number"
                          value={formatNumber(edited.warning_threshold)}
                          onChange={(e) => handleChange(threshold.id, "warning_threshold", parseNumber(e.target.value))}
                          placeholder="Warning"
                          className="h-9"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs flex items-center gap-1">
                          <AlertCircle className="h-3 w-3 text-destructive" />
                          Critical
                        </Label>
                        <Input
                          type="number"
                          value={formatNumber(edited.critical_threshold)}
                          onChange={(e) => handleChange(threshold.id, "critical_threshold", parseNumber(e.target.value))}
                          placeholder="Critical"
                          className="h-9"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs">Direction</Label>
                        <Select
                          value={edited.threshold_direction || "below"}
                          onValueChange={(v) => handleChange(threshold.id, "threshold_direction", v)}
                        >
                          <SelectTrigger className="h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="below">Alert when below</SelectItem>
                            <SelectItem value="above">Alert when above</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-end">
                        <div className="flex gap-1">
                          <div className="w-4 h-4 rounded-full bg-success" title="On Track" />
                          <div className="w-4 h-4 rounded-full bg-warning" title="Warning" />
                          <div className="w-4 h-4 rounded-full bg-destructive" title="Critical" />
                        </div>
                      </div>
                    </div>

                    <Separator className="my-2" />

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">WoW Warning %</Label>
                        <Input
                          type="number"
                          value={formatNumber(edited.wow_warning_threshold)}
                          onChange={(e) => handleChange(threshold.id, "wow_warning_threshold", parseNumber(e.target.value))}
                          placeholder="-5"
                          className="h-9"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">WoW Critical %</Label>
                        <Input
                          type="number"
                          value={formatNumber(edited.wow_critical_threshold)}
                          onChange={(e) => handleChange(threshold.id, "wow_critical_threshold", parseNumber(e.target.value))}
                          placeholder="-10"
                          className="h-9"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">MoM Warning %</Label>
                        <Input
                          type="number"
                          value={formatNumber(edited.mom_warning_threshold)}
                          onChange={(e) => handleChange(threshold.id, "mom_warning_threshold", parseNumber(e.target.value))}
                          placeholder="-10"
                          className="h-9"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">MoM Critical %</Label>
                        <Input
                          type="number"
                          value={formatNumber(edited.mom_critical_threshold)}
                          onChange={(e) => handleChange(threshold.id, "mom_critical_threshold", parseNumber(e.target.value))}
                          placeholder="-20"
                          className="h-9"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || isLoading}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
