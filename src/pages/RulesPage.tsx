import { MainLayout } from "@/components/layout/MainLayout";
import { Shield, FileCheck, AlertCircle, Clock, CheckCircle2 } from "lucide-react";

const complianceRules = [
  {
    id: "BSEC-001",
    title: "Quarterly Financial Reporting",
    description: "Submit comprehensive financial reports to BSEC within 30 days of quarter end",
    authority: "BSEC",
    frequency: "Quarterly",
    penalty: "BDT 50,000 - 500,000",
    status: "active"
  },
  {
    id: "DSE-001",
    title: "Daily Trading Volume Report",
    description: "Report daily trading volumes and client positions by end of business",
    authority: "DSE",
    frequency: "Daily",
    penalty: "Warning to Suspension",
    status: "active"
  },
  {
    id: "AML-001",
    title: "Anti-Money Laundering Compliance",
    description: "Maintain KYC documentation and report suspicious transactions within 24 hours",
    authority: "BFIU",
    frequency: "Ongoing",
    penalty: "License Revocation",
    status: "active"
  },
  {
    id: "INT-001",
    title: "Internal Audit Requirements",
    description: "Conduct quarterly internal audits of trading operations and client accounts",
    authority: "Internal",
    frequency: "Quarterly",
    penalty: "N/A",
    status: "active"
  },
  {
    id: "CSE-001",
    title: "Client Portfolio Compliance",
    description: "Monthly verification of client portfolio limits and margin requirements",
    authority: "CSE",
    frequency: "Monthly",
    penalty: "BDT 25,000 - 100,000",
    status: "active"
  },
  {
    id: "BSEC-002",
    title: "Employee Training Certification",
    description: "All trading personnel must complete annual compliance training certification",
    authority: "BSEC",
    frequency: "Annual",
    penalty: "Trading Restrictions",
    status: "active"
  }
];

const RulesPage = () => {
  return (
    <MainLayout 
      title="Compliance Rules" 
      subtitle="Regulatory requirements and internal compliance policies"
    >
      <div className="space-y-4">
        {complianceRules.map((rule, index) => (
          <div
            key={rule.id}
            className="glass-card rounded-xl p-6 hover:shadow-elevated transition-all duration-300 animate-slide-up"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-start gap-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl btn-gradient-gold flex-shrink-0">
                <Shield className="h-6 w-6 text-primary-foreground" />
              </div>
              
              <div className="flex-1">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xs font-medium text-primary bg-primary/20 px-2 py-1 rounded">
                        {rule.id}
                      </span>
                      <span className="text-xs text-muted-foreground bg-secondary px-2 py-1 rounded">
                        {rule.authority}
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold text-foreground">{rule.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{rule.description}</p>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-success bg-success/20 px-2 py-1 rounded">
                    <CheckCircle2 className="h-3 w-3" />
                    Active
                  </span>
                </div>

                <div className="flex items-center gap-6 mt-4 pt-4 border-t border-border">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Frequency:</span>
                    <span className="text-sm font-medium text-foreground">{rule.frequency}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    <span className="text-sm text-muted-foreground">Penalty:</span>
                    <span className="text-sm font-medium text-foreground">{rule.penalty}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </MainLayout>
  );
};

export default RulesPage;
