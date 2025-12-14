import { MainLayout } from "@/components/layout/MainLayout";
import { Bell, AlertTriangle, CheckCircle2, Info, Clock } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const notifications = [
  {
    id: 1,
    type: "warning",
    title: "IT Security Audit Overdue",
    message: "The IT Security Audit Report (CR-2024-006) is past its due date. Immediate action required.",
    timestamp: "2024-12-12T10:00:00",
    read: false
  },
  {
    id: 2,
    type: "info",
    title: "BSEC Report Due Soon",
    message: "BSEC Quarterly Compliance Report Q4 is due in 19 days. Please ensure all documentation is prepared.",
    timestamp: "2024-12-12T09:30:00",
    read: false
  },
  {
    id: 3,
    type: "success",
    title: "Report Approved",
    message: "Employee Training Compliance report has been approved by the CEO.",
    timestamp: "2024-12-11T16:45:00",
    read: true
  },
  {
    id: 4,
    type: "error",
    title: "Revision Required",
    message: "CSE Client Portfolio Report requires revision. Missing client declarations need to be addressed.",
    timestamp: "2024-12-09T11:45:00",
    read: true
  },
  {
    id: 5,
    type: "info",
    title: "New Employee Onboarded",
    message: "New employee added to the Priority Brokerage Services department.",
    timestamp: "2024-12-08T14:00:00",
    read: true
  }
];

const typeConfig = {
  warning: {
    icon: AlertTriangle,
    iconClass: "text-warning bg-warning/20",
    borderClass: "border-l-warning"
  },
  error: {
    icon: AlertTriangle,
    iconClass: "text-destructive bg-destructive/20",
    borderClass: "border-l-destructive"
  },
  success: {
    icon: CheckCircle2,
    iconClass: "text-success bg-success/20",
    borderClass: "border-l-success"
  },
  info: {
    icon: Info,
    iconClass: "text-accent bg-accent/20",
    borderClass: "border-l-accent"
  }
};

const NotificationsPage = () => {
  return (
    <MainLayout 
      title="Notifications" 
      subtitle="Stay updated with compliance alerts and activities"
    >
      <div className="space-y-4">
        {notifications.map((notification, index) => {
          const config = typeConfig[notification.type as keyof typeof typeConfig];
          const Icon = config.icon;
          
          return (
            <div
              key={notification.id}
              className={cn(
                "glass-card rounded-xl p-5 border-l-4 transition-all duration-300 hover:shadow-elevated animate-slide-up",
                config.borderClass,
                !notification.read && "bg-secondary/50"
              )}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-start gap-4">
                <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", config.iconClass)}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{notification.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{notification.message}</p>
                    </div>
                    {!notification.read && (
                      <span className="flex h-2 w-2 rounded-full bg-primary" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(notification.timestamp), "MMM d, yyyy 'at' h:mm a")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </MainLayout>
  );
};

export default NotificationsPage;
