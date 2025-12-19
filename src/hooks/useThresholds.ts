import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { StatusTag } from "@/components/ceo-dashboard/ExecutiveHealthTile";

export interface Threshold {
  id: string;
  tile_key: string;
  tile_name: string;
  metric_type: string;
  warning_threshold: number | null;
  critical_threshold: number | null;
  threshold_direction: "above" | "below";
  wow_warning_threshold: number | null;
  wow_critical_threshold: number | null;
  mom_warning_threshold: number | null;
  mom_critical_threshold: number | null;
  is_enabled: boolean;
}

export function computeStatus(
  value: number | undefined,
  threshold: Threshold | undefined,
  weekChange?: number,
  monthChange?: number
): StatusTag {
  if (!threshold || !threshold.is_enabled || value === undefined) {
    return "neutral";
  }

  const { warning_threshold, critical_threshold, threshold_direction } = threshold;

  // Check main value thresholds
  if (warning_threshold !== null && critical_threshold !== null) {
    if (threshold_direction === "above") {
      // Bad when value is above threshold
      if (value >= critical_threshold) return "critical";
      if (value >= warning_threshold) return "warning";
    } else {
      // Bad when value is below threshold (default)
      if (value <= critical_threshold) return "critical";
      if (value <= warning_threshold) return "warning";
    }
  }

  // Check WoW change thresholds
  if (weekChange !== undefined && threshold.wow_warning_threshold !== null && threshold.wow_critical_threshold !== null) {
    if (threshold_direction === "above") {
      if (weekChange >= threshold.wow_critical_threshold) return "critical";
      if (weekChange >= threshold.wow_warning_threshold) return "warning";
    } else {
      if (weekChange <= threshold.wow_critical_threshold) return "critical";
      if (weekChange <= threshold.wow_warning_threshold) return "warning";
    }
  }

  // Check MoM change thresholds
  if (monthChange !== undefined && threshold.mom_warning_threshold !== null && threshold.mom_critical_threshold !== null) {
    if (threshold_direction === "above") {
      if (monthChange >= threshold.mom_critical_threshold) return "critical";
      if (monthChange >= threshold.mom_warning_threshold) return "warning";
    } else {
      if (monthChange <= threshold.mom_critical_threshold) return "critical";
      if (monthChange <= threshold.mom_warning_threshold) return "warning";
    }
  }

  return "on-track";
}

export function useThresholds() {
  const queryClient = useQueryClient();

  const { data: thresholds, isLoading, error } = useQuery({
    queryKey: ["ceo-dashboard-thresholds"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ceo_dashboard_thresholds")
        .select("*")
        .order("tile_name");
      
      if (error) throw error;
      return (data || []) as Threshold[];
    },
  });

  const thresholdsMap = thresholds?.reduce((acc, t) => {
    acc[t.tile_key] = t;
    return acc;
  }, {} as Record<string, Threshold>) || {};

  const updateThreshold = useMutation({
    mutationFn: async (threshold: Partial<Threshold> & { id: string }) => {
      const { id, ...updates } = threshold;
      const { data, error } = await supabase
        .from("ceo_dashboard_thresholds")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ceo-dashboard-thresholds"] });
    },
  });

  const getStatus = (
    tileKey: string,
    value: number | undefined,
    weekChange?: number,
    monthChange?: number
  ): StatusTag => {
    return computeStatus(value, thresholdsMap[tileKey], weekChange, monthChange);
  };

  return {
    thresholds,
    thresholdsMap,
    isLoading,
    error,
    updateThreshold,
    getStatus,
    computeStatus,
  };
}
