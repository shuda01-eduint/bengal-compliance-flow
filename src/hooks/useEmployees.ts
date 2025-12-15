import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface Employee {
  id: string;
  employee_id: string;
  name: string;
  designation: string;
  department: string;
  branch: string;
  joining_date: string;
  email: string;
  status: string;
  manager: string | null;
  bank_account: string | null;
  serial_number: number | null;
  date_of_confirmation: string | null;
  date_of_promotion: string | null;
  date_of_birth: string | null;
  service_year: number | null;
  service_month: number | null;
  service_date: number | null;
  increment_date: string | null;
  release_date: string | null;
  performance_2019: string | null;
  performance_2020: string | null;
  religion: string | null;
  employment_category: string | null;
  marital_status: string | null;
  upay_number: string | null;
  personal_phone: string | null;
  corporate_phone: string | null;
  nid_number: string | null;
  father_name: string | null;
  mother_name: string | null;
  spouse_name: string | null;
  blood_group: string | null;
  old_email: string | null;
  tin_number: string | null;
  functional_designation: string | null;
  category: string | null;
  gender: string | null;
  nationality: string | null;
  present_address: string | null;
  permanent_address: string | null;
  passport_number: string | null;
  highest_degree: string | null;
  employment_status: string | null;
  created_at: string;
  updated_at: string;
}

export type EmployeeInsert = Omit<Employee, "id" | "created_at" | "updated_at">;

export const useEmployees = () => {
  return useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("*")
        .order("employee_id", { ascending: true });

      if (error) throw error;
      return data as Employee[];
    },
  });
};

export const useAddEmployee = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (employee: EmployeeInsert) => {
      const { data, error } = await supabase
        .from("employees")
        .insert(employee)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast({ title: "Employee added", description: "The employee has been added successfully." });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });
};

export const useUpdateEmployee = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Employee> & { id: string }) => {
      const { data, error } = await supabase
        .from("employees")
        .update(updates)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast({ title: "Employee updated", description: "The employee has been updated successfully." });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });
};

export const useDeleteEmployee = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("employees").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast({ title: "Employee deleted", description: "The employee has been deleted successfully." });
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Error", description: error.message });
    },
  });
};
