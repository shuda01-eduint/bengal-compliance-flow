import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  FileText, 
  Download, 
  Clock, 
  Calendar,
  TrendingUp,
  AlertTriangle,
  Shield,
  Users,
  PieChart,
  DollarSign
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";

interface ReportType {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  frequency: string;
}

const reportTypes: ReportType[] = [
  { 
    id: 'daily-utilization', 
    name: 'Daily Margin Utilization', 
    description: 'Daily summary of margin utilization across all accounts',
    icon: TrendingUp,
    frequency: 'Daily'
  },
  { 
    id: 'margin-calls', 
    name: 'Margin Call Issued Report', 
    description: 'List of all margin calls issued during the period',
    icon: AlertTriangle,
    frequency: 'On-demand'
  },
  { 
    id: 'maintenance-compliance', 
    name: 'Maintenance Margin Compliance', 
    description: 'Compliance status of maintenance margin requirements',
    icon: Shield,
    frequency: 'Daily'
  },
  { 
    id: 'risk-rating', 
    name: 'Client Risk Rating Summary', 
    description: 'Risk classification summary of all margin clients',
    icon: Users,
    frequency: 'Weekly'
  },
  { 
    id: 'concentration', 
    name: 'Concentration Risk Report', 
    description: 'Client and security concentration analysis',
    icon: PieChart,
    frequency: 'Weekly'
  },
  { 
    id: 'revenue-risk', 
    name: 'Margin Revenue vs Risk', 
    description: 'Revenue generated vs risk exposure analysis',
    icon: DollarSign,
    frequency: 'Monthly'
  },
];

interface GeneratedReport {
  id: string;
  name: string;
  generatedAt: string;
  period: string;
  status: 'ready' | 'generating' | 'failed';
  size: string;
}

const mockGeneratedReports: GeneratedReport[] = [
  { 
    id: '1', 
    name: 'Daily Margin Utilization', 
    generatedAt: '2024-01-25 09:30 AM', 
    period: '24 Jan 2024',
    status: 'ready',
    size: '245 KB'
  },
  { 
    id: '2', 
    name: 'Margin Call Issued Report', 
    generatedAt: '2024-01-25 08:15 AM', 
    period: '20-24 Jan 2024',
    status: 'ready',
    size: '128 KB'
  },
  { 
    id: '3', 
    name: 'Concentration Risk Report', 
    generatedAt: '2024-01-24 05:00 PM', 
    period: 'Week 4, Jan 2024',
    status: 'ready',
    size: '512 KB'
  },
  { 
    id: '4', 
    name: 'Client Risk Rating Summary', 
    generatedAt: '2024-01-25 10:00 AM', 
    period: 'Jan 2024',
    status: 'generating',
    size: '-'
  },
];

export function ReportsTab() {
  const [fromDate, setFromDate] = useState<Date>();
  const [toDate, setToDate] = useState<Date>();
  const [generatedReports, setGeneratedReports] = useState<GeneratedReport[]>(mockGeneratedReports);

  const handleGenerateReport = (report: ReportType) => {
    if (!fromDate) {
      toast.error('Please select a date range');
      return;
    }

    const newReport: GeneratedReport = {
      id: Date.now().toString(),
      name: report.name,
      generatedAt: format(new Date(), 'yyyy-MM-dd hh:mm a'),
      period: toDate 
        ? `${format(fromDate, 'dd MMM yyyy')} - ${format(toDate, 'dd MMM yyyy')}`
        : format(fromDate, 'dd MMM yyyy'),
      status: 'generating',
      size: '-'
    };

    setGeneratedReports(prev => [newReport, ...prev]);
    toast.success(`Generating ${report.name}...`);

    // Simulate report generation
    setTimeout(() => {
      setGeneratedReports(prev => 
        prev.map(r => 
          r.id === newReport.id 
            ? { ...r, status: 'ready' as const, size: `${Math.floor(Math.random() * 500 + 100)} KB` }
            : r
        )
      );
      toast.success(`${report.name} is ready for download`);
    }, 3000);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ready':
        return <Badge className="bg-green-500/20 text-green-400">Ready</Badge>;
      case 'generating':
        return <Badge className="bg-yellow-500/20 text-yellow-400 animate-pulse">Generating...</Badge>;
      case 'failed':
        return <Badge className="bg-red-500/20 text-red-400">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Date Range Selector */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Report Period
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">From:</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[200px] justify-start text-left font-normal",
                      !fromDate && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, "PPP") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={fromDate}
                    onSelect={setFromDate}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">To:</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-[200px] justify-start text-left font-normal",
                      !toDate && "text-muted-foreground"
                    )}
                  >
                    <Calendar className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, "PPP") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={toDate}
                    onSelect={setToDate}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Available Reports */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Available Reports
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {reportTypes.map((report) => (
              <Card 
                key={report.id} 
                className="bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
                onClick={() => handleGenerateReport(report)}
              >
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <report.icon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-sm">{report.name}</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        {report.description}
                      </p>
                      <Badge variant="outline" className="mt-2 text-xs">
                        {report.frequency}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Generated Reports */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Generated Reports
          </CardTitle>
        </CardHeader>
        <CardContent>
          {generatedReports.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No reports generated yet</p>
              <p className="text-sm">Select a date range and click on a report type to generate</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Report Name</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Generated At</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {generatedReports.map((report) => (
                    <TableRow key={report.id}>
                      <TableCell className="font-medium">{report.name}</TableCell>
                      <TableCell className="text-muted-foreground">{report.period}</TableCell>
                      <TableCell className="text-muted-foreground">{report.generatedAt}</TableCell>
                      <TableCell>{report.size}</TableCell>
                      <TableCell>{getStatusBadge(report.status)}</TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={report.status !== 'ready'}
                          onClick={() => toast.success('Download started')}
                        >
                          <Download className="h-4 w-4 mr-1" />
                          Download
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
