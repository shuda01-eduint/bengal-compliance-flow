import { Employee } from "@/hooks/useEmployees";
import { Mail, Phone, MapPin, User } from "lucide-react";
import { EmployeeAgentCodes } from "./EmployeeAgentCodes";

interface EmployeeCardProps {
  employee: Employee;
  index: number;
}

export function EmployeeCard({ employee, index }: EmployeeCardProps) {
  return (
    <div 
      className="glass-card rounded-xl p-5 hover:shadow-elevated transition-all duration-300 animate-slide-up group"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/20 text-primary group-hover:btn-gradient-gold group-hover:text-primary-foreground transition-all">
          <User className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{employee.name}</h3>
          <p className="text-xs text-primary font-medium mt-0.5">{employee.designation}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{employee.department}</p>
        </div>
      </div>
      
      <div className="mt-4 space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="truncate">{employee.branch}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Mail className="h-3.5 w-3.5 flex-shrink-0" />
          <a href={`mailto:${employee.email}`} className="truncate hover:text-primary transition-colors">
            {employee.email}
          </a>
        </div>
        {employee.corporate_phone && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Phone className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{employee.corporate_phone}</span>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground">
          Reports to: <span className="text-foreground">{employee.manager || 'N/A'}</span>
        </p>
      </div>

      <EmployeeAgentCodes employeeId={employee.employee_id} />
    </div>
  );
}
