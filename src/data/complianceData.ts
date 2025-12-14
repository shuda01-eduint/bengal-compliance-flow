export interface ComplianceReport {
  id: string;
  title: string;
  type: "regulatory" | "internal" | "audit" | "bsec" | "dse" | "cse";
  status: "pending" | "submitted" | "approved" | "requires_revision" | "overdue";
  dueDate: string;
  submittedDate?: string;
  assignedTo: string;
  department: string;
  priority: "low" | "medium" | "high" | "critical";
  description: string;
}

export interface PostReportActivity {
  id: string;
  reportId: string;
  action: "created" | "updated" | "submitted" | "reviewed" | "approved" | "rejected" | "comment";
  performedBy: string;
  timestamp: string;
  details: string;
  department: string;
}

export const complianceReports: ComplianceReport[] = [
  {
    id: "CR-2024-001",
    title: "BSEC Quarterly Compliance Report Q4",
    type: "bsec",
    status: "pending",
    dueDate: "2024-12-31",
    assignedTo: "Mohammed Rahmat Pasha",
    department: "Executive",
    priority: "critical",
    description: "Quarterly compliance report for Bangladesh Securities and Exchange Commission"
  },
  {
    id: "CR-2024-002",
    title: "DSE Trading Volume Report",
    type: "dse",
    status: "submitted",
    dueDate: "2024-12-15",
    submittedDate: "2024-12-10",
    assignedTo: "Tahmidur Rahman",
    department: "Institutional Sales",
    priority: "high",
    description: "Weekly trading volume and activity report for DSE"
  },
  {
    id: "CR-2024-003",
    title: "Internal Audit - Retail Operations",
    type: "audit",
    status: "approved",
    dueDate: "2024-12-01",
    submittedDate: "2024-11-28",
    assignedTo: "Md. Toiubulla Chowdhury",
    department: "Retail Sales",
    priority: "medium",
    description: "Internal audit of retail sales operations and compliance"
  },
  {
    id: "CR-2024-004",
    title: "CSE Client Portfolio Report",
    type: "cse",
    status: "requires_revision",
    dueDate: "2024-12-20",
    submittedDate: "2024-12-08",
    assignedTo: "Mohammad Monjurul Alam",
    department: "Chattogram",
    priority: "high",
    description: "Monthly client portfolio compliance report for CSE"
  },
  {
    id: "CR-2024-005",
    title: "AML/KYC Compliance Review",
    type: "regulatory",
    status: "pending",
    dueDate: "2024-12-25",
    assignedTo: "Belal Hossain",
    department: "Settlement & Support Services",
    priority: "critical",
    description: "Anti-Money Laundering and Know Your Customer compliance review"
  },
  {
    id: "CR-2024-006",
    title: "IT Security Audit Report",
    type: "internal",
    status: "overdue",
    dueDate: "2024-12-05",
    assignedTo: "Moinul Islam",
    department: "IT",
    priority: "critical",
    description: "Annual IT security and infrastructure audit"
  },
  {
    id: "CR-2024-007",
    title: "Employee Training Compliance",
    type: "internal",
    status: "approved",
    dueDate: "2024-11-30",
    submittedDate: "2024-11-25",
    assignedTo: "A. K. M. Iqbell Hossain",
    department: "HR",
    priority: "medium",
    description: "Quarterly employee training and certification compliance report"
  },
  {
    id: "CR-2024-008",
    title: "Risk Management Assessment",
    type: "regulatory",
    status: "submitted",
    dueDate: "2024-12-18",
    submittedDate: "2024-12-12",
    assignedTo: "Sazzad Mahmud",
    department: "Finance and Accounts",
    priority: "high",
    description: "Comprehensive risk management and mitigation assessment"
  }
];

export const postReportActivities: PostReportActivity[] = [
  {
    id: "ACT-001",
    reportId: "CR-2024-002",
    action: "submitted",
    performedBy: "Tahmidur Rahman",
    timestamp: "2024-12-10T14:30:00",
    details: "DSE Trading Volume Report submitted for review",
    department: "Institutional Sales"
  },
  {
    id: "ACT-002",
    reportId: "CR-2024-003",
    action: "approved",
    performedBy: "Mohammed Rahmat Pasha",
    timestamp: "2024-12-02T09:15:00",
    details: "Internal Audit Report approved by CEO",
    department: "Retail Sales"
  },
  {
    id: "ACT-003",
    reportId: "CR-2024-004",
    action: "rejected",
    performedBy: "Compliance Officer",
    timestamp: "2024-12-09T11:45:00",
    details: "CSE Report requires revision - missing client declarations",
    department: "Chattogram"
  },
  {
    id: "ACT-004",
    reportId: "CR-2024-001",
    action: "updated",
    performedBy: "Mohammed Rahmat Pasha",
    timestamp: "2024-12-11T16:00:00",
    details: "Added Q4 financial statements to BSEC report",
    department: "Executive"
  },
  {
    id: "ACT-005",
    reportId: "CR-2024-005",
    action: "comment",
    performedBy: "Belal Hossain",
    timestamp: "2024-12-12T10:30:00",
    details: "KYC documentation for new clients pending verification",
    department: "Settlement & Support Services"
  },
  {
    id: "ACT-006",
    reportId: "CR-2024-008",
    action: "submitted",
    performedBy: "Sazzad Mahmud",
    timestamp: "2024-12-12T15:20:00",
    details: "Risk Management Assessment submitted ahead of deadline",
    department: "Finance and Accounts"
  },
  {
    id: "ACT-007",
    reportId: "CR-2024-006",
    action: "comment",
    performedBy: "Moinul Islam",
    timestamp: "2024-12-06T09:00:00",
    details: "IT Security Audit delayed - awaiting external auditor availability",
    department: "IT"
  },
  {
    id: "ACT-008",
    reportId: "CR-2024-007",
    action: "reviewed",
    performedBy: "HR Manager",
    timestamp: "2024-11-26T14:00:00",
    details: "Training compliance report reviewed and forwarded for approval",
    department: "HR"
  }
];

export const complianceMetrics = {
  totalReports: 8,
  pending: 2,
  submitted: 2,
  approved: 2,
  requiresRevision: 1,
  overdue: 1,
  complianceRate: 87.5,
  avgProcessingDays: 3.2,
  upcomingDeadlines: 4
};
