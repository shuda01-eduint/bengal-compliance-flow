import { MainLayout } from "@/components/layout/MainLayout";
import { EmployeeCard } from "@/components/employees/EmployeeCard";
import { EmployeeFilters } from "@/components/employees/EmployeeFilters";
import { EmployeeAgentCodes } from "@/components/employees/EmployeeAgentCodes";
import { UserManagementTab } from "@/components/organization/UserManagementTab";
import { AgentCard } from "@/components/agents/AgentCard";
import { AgentFilters } from "@/components/agents/AgentFilters";
import { AgentImportDialog } from "@/components/agents/AgentImportDialog";
import { AgentListItem } from "@/components/agents/AgentListItem";
import { AgentCodesTable } from "@/components/trade-history/AgentCodesTable";
import { useAllEmployees, useEmployeeFilterOptions } from "@/hooks/useEmployeesPaginated";
import { useAllAgents, useUniqueRMs } from "@/hooks/useAgentsPaginated";
import { departments } from "@/data/employees";
import { useState, useMemo } from "react";
import { Mail, Phone, User, Building2, Users, ChevronRight, UserCog, Loader2, Briefcase, Link } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const EmployeesPage = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  
  // Agent state
  const [agentSearchQuery, setAgentSearchQuery] = useState("");
  const [selectedRM, setSelectedRM] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [agentViewMode, setAgentViewMode] = useState<"grid" | "list">("grid");
  
  // Use new paginated hooks
  const { data: employees = [], isLoading } = useAllEmployees();
  const { data: agents = [], isLoading: isLoadingAgents } = useAllAgents();
  const { data: rmOptions = [] } = useUniqueRMs();

  const filteredEmployees = useMemo(() => {
    return employees.filter((employee) => {
      const matchesSearch = 
        employee.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        employee.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        employee.designation.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesDepartment = 
        selectedDepartment === "all" || 
        employee.department === selectedDepartment;

      return matchesSearch && matchesDepartment;
    });
  }, [employees, searchQuery, selectedDepartment]);

  const rmOptionsList = useMemo(() => {
    return rmOptions.map(rm => rm.rmName).filter((name): name is string => Boolean(name));
  }, [rmOptions]);

  const filteredAgents = useMemo(() => {
    return agents.filter((agent) => {
      const matchesSearch = 
        agent.name.toLowerCase().includes(agentSearchQuery.toLowerCase()) ||
        agent.agent_id.toLowerCase().includes(agentSearchQuery.toLowerCase()) ||
        (agent.rm_name?.toLowerCase().includes(agentSearchQuery.toLowerCase()) ?? false);
      
      const matchesRM = 
        selectedRM === "all" || 
        agent.rm_name === selectedRM;
      
      const matchesStatus = 
        selectedStatus === "all" || 
        agent.status === selectedStatus;

      return matchesSearch && matchesRM && matchesStatus;
    });
  }, [agents, agentSearchQuery, selectedRM, selectedStatus]);

  const agentStats = useMemo(() => {
    const total = agents.length;
    const active = agents.filter(a => a.status === "Active").length;
    const uniqueRMs = new Set(agents.map(a => a.rm_id)).size;
    return { total, active, uniqueRMs };
  }, [agents]);

  return (
    <MainLayout 
      title="Organization" 
      subtitle="Manage employees, departments, agents and users"
    >
      <Tabs defaultValue="employees" className="space-y-4 lg:space-y-6">
        <div className="overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0">
          <TabsList className="inline-flex w-auto min-w-full sm:min-w-0">
            <TabsTrigger value="employees" className="flex items-center gap-1 lg:gap-2 text-xs lg:text-sm px-2 lg:px-3">
              <Users className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
              <span className="hidden sm:inline">Employees</span>
              <span className="sm:hidden">Staff</span>
            </TabsTrigger>
            <TabsTrigger value="departments" className="flex items-center gap-1 lg:gap-2 text-xs lg:text-sm px-2 lg:px-3">
              <Building2 className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
              <span className="hidden sm:inline">Departments</span>
              <span className="sm:hidden">Depts</span>
            </TabsTrigger>
            <TabsTrigger value="agents" className="flex items-center gap-1 lg:gap-2 text-xs lg:text-sm px-2 lg:px-3">
              <User className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
              Agents
            </TabsTrigger>
            <TabsTrigger value="agent-codes" className="flex items-center gap-1 lg:gap-2 text-xs lg:text-sm px-2 lg:px-3">
              <Link className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
              <span className="hidden sm:inline">Agent </span>Codes
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-1 lg:gap-2 text-xs lg:text-sm px-2 lg:px-3">
              <UserCog className="h-3.5 w-3.5 lg:h-4 lg:w-4" />
              Users
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Employees Tab */}
        <TabsContent value="employees" className="space-y-6">
          <EmployeeFilters
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selectedDepartment={selectedDepartment}
            onDepartmentChange={setSelectedDepartment}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredEmployees.map((employee, index) => (
                <EmployeeCard key={employee.id} employee={employee} index={index} />
              ))}
            </div>
          ) : (
            <div className="glass-card rounded-xl overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-secondary/50">
                    <th className="px-6 py-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Employee
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Department
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Location
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Agent Codes
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Contact
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredEmployees.map((employee) => (
                    <tr key={employee.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-primary">
                            <User className="h-4 w-4" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{employee.name}</p>
                            <p className="text-xs text-primary">{employee.designation}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {employee.department}
                      </td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">
                        {employee.branch}
                      </td>
                      <td className="px-6 py-4">
                        <EmployeeAgentCodes employeeId={employee.employee_id} compact />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4">
                          <a href={`mailto:${employee.email}`} className="text-muted-foreground hover:text-primary transition-colors">
                            <Mail className="h-4 w-4" />
                          </a>
                          {employee.corporate_phone && (
                            <a href={`tel:${employee.corporate_phone}`} className="text-muted-foreground hover:text-primary transition-colors">
                              <Phone className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {filteredEmployees.length === 0 && !isLoading && (
            <div className="glass-card rounded-xl p-12 text-center">
              <User className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">No employees found</h3>
              <p className="text-sm text-muted-foreground">Try adjusting your search or filter criteria</p>
            </div>
          )}
        </TabsContent>

        {/* Departments Tab */}
        <TabsContent value="departments">
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
                  <span>{dept.employeeCount} employees</span>
                </div>

                <div className="pt-4 border-t border-border">
                  <p className="text-xs text-muted-foreground">Department Head</p>
                  <p className="text-sm font-medium text-foreground mt-1">{dept.head}</p>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* Agents Tab */}
        <TabsContent value="agents" className="space-y-6">
          {/* Stats & Actions Header */}
          <div className="flex flex-col md:flex-row justify-between gap-4">
            <div className="flex flex-wrap gap-4">
              <div className="glass-card rounded-lg px-4 py-3">
                <p className="text-xs text-muted-foreground">Total Agents</p>
                <p className="text-2xl font-semibold text-foreground">{agentStats.total}</p>
              </div>
              <div className="glass-card rounded-lg px-4 py-3">
                <p className="text-xs text-muted-foreground">Active</p>
                <p className="text-2xl font-semibold text-green-600">{agentStats.active}</p>
              </div>
              <div className="glass-card rounded-lg px-4 py-3">
                <p className="text-xs text-muted-foreground">Unique RMs</p>
                <p className="text-2xl font-semibold text-foreground">{agentStats.uniqueRMs}</p>
              </div>
            </div>
            <AgentImportDialog />
          </div>

          <AgentFilters
            searchQuery={agentSearchQuery}
            onSearchChange={setAgentSearchQuery}
            selectedRM={selectedRM}
            onRMChange={setSelectedRM}
            selectedStatus={selectedStatus}
            onStatusChange={setSelectedStatus}
            viewMode={agentViewMode}
            onViewModeChange={setAgentViewMode}
            rmOptions={rmOptionsList}
          />

          {isLoadingAgents ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : agentViewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredAgents.map((agent, index) => (
                <AgentCard key={agent.id} agent={agent} index={index} />
              ))}
            </div>
          ) : (
            <div className="glass-card rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Commission</TableHead>
                    <TableHead>RM</TableHead>
                    <TableHead>Bank</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAgents.map((agent) => (
                    <AgentListItem key={agent.id} agent={agent} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {filteredAgents.length === 0 && !isLoadingAgents && (
            <div className="glass-card rounded-xl p-12 text-center">
              <Briefcase className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">No agents found</h3>
              <p className="text-sm text-muted-foreground">
                {agents.length === 0 
                  ? "Import agents from Excel to get started" 
                  : "Try adjusting your search or filter criteria"}
              </p>
            </div>
          )}
        </TabsContent>

        {/* Agent Codes Tab */}
        <TabsContent value="agent-codes">
          <AgentCodesTable />
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users">
          <UserManagementTab />
        </TabsContent>
      </Tabs>
    </MainLayout>
  );
};

export default EmployeesPage;
