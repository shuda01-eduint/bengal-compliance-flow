import { MainLayout } from "@/components/layout/MainLayout";
import { departments } from "@/data/employees";
import { Building2, Users, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const DepartmentsPage = () => {
  return (
    <MainLayout 
      title="Departments" 
      subtitle="Overview of all organizational departments"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {departments.map((dept, index) => (
          <div
            key={dept.name}
            className="glass-card rounded-xl p-6 hover:shadow-elevated transition-all duration-300 cursor-pointer group animate-slide-up"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/20 text-primary group-hover:btn-gradient-gold group-hover:text-primary-foreground transition-all">
                <Building2 className="h-6 w-6" />
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
            </div>
            
            <h3 className="text-lg font-semibold font-serif text-foreground mb-2">{dept.name}</h3>
            
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
              <Users className="h-4 w-4" />
              <span>{dept.count} employees</span>
            </div>

            <div className="pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground">Department Head</p>
              <p className="text-sm font-medium text-foreground mt-1">{dept.head}</p>
            </div>
          </div>
        ))}
      </div>
    </MainLayout>
  );
};

export default DepartmentsPage;
