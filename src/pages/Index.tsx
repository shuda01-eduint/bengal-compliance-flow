import { MainLayout } from "@/components/layout/MainLayout";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { ComplianceChart } from "@/components/dashboard/ComplianceChart";
import { RecentActivity } from "@/components/dashboard/RecentActivity";
import { UpcomingDeadlines } from "@/components/dashboard/UpcomingDeadlines";
import { complianceMetrics } from "@/data/complianceData";
import { 
  FileText, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  TrendingUp,
  Users
} from "lucide-react";
import { employees } from "@/data/employees";

const Index = () => {
  return (
    <MainLayout 
      title="Compliance Dashboard" 
      subtitle="UCB Stock Brokerage Limited - Real-time compliance overview"
    >
      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <MetricCard
          title="Total Reports"
          value={complianceMetrics.totalReports}
          subtitle="Active compliance reports"
          icon={FileText}
          variant="primary"
          delay={0}
        />
        <MetricCard
          title="Compliance Rate"
          value={`${complianceMetrics.complianceRate}%`}
          subtitle="Reports on track"
          icon={TrendingUp}
          trend={{ value: 2.5, isPositive: true }}
          variant="success"
          delay={100}
        />
        <MetricCard
          title="Pending Review"
          value={complianceMetrics.pending + complianceMetrics.submitted}
          subtitle="Awaiting action"
          icon={Clock}
          variant="warning"
          delay={200}
        />
        <MetricCard
          title="Overdue Reports"
          value={complianceMetrics.overdue}
          subtitle="Requires immediate attention"
          icon={AlertTriangle}
          variant="destructive"
          delay={300}
        />
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <MetricCard
          title="Total Employees"
          value={employees.length}
          subtitle="Active workforce"
          icon={Users}
          delay={400}
        />
        <MetricCard
          title="Approved This Month"
          value={complianceMetrics.approved}
          subtitle="Successfully processed"
          icon={CheckCircle2}
          variant="success"
          delay={500}
        />
        <MetricCard
          title="Avg. Processing Time"
          value={`${complianceMetrics.avgProcessingDays} days`}
          subtitle="Report completion"
          icon={Clock}
          delay={600}
        />
      </div>

      {/* Charts and Activity Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <ComplianceChart />
        <RecentActivity />
      </div>

      {/* Upcoming Deadlines */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <UpcomingDeadlines />
        <div className="glass-card rounded-xl p-6 animate-slide-up" style={{ animationDelay: "500ms" }}>
          <h3 className="text-lg font-semibold font-serif text-foreground mb-4">Regulatory Bodies</h3>
          <div className="space-y-4">
            {[
              { name: "BSEC", fullName: "Bangladesh Securities & Exchange Commission", reports: 2 },
              { name: "DSE", fullName: "Dhaka Stock Exchange", reports: 1 },
              { name: "CSE", fullName: "Chittagong Stock Exchange", reports: 1 },
            ].map((body, index) => (
              <div 
                key={body.name}
                className="flex items-center justify-between p-4 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg btn-gradient-gold">
                    <span className="text-sm font-bold text-primary-foreground">{body.name.charAt(0)}</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{body.name}</p>
                    <p className="text-xs text-muted-foreground">{body.fullName}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-foreground">{body.reports}</p>
                  <p className="text-xs text-muted-foreground">Active Reports</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default Index;
