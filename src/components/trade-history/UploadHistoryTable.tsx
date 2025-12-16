import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { FileText, Calendar, Hash, Clock } from "lucide-react";
import { format } from "date-fns";

interface FileUploadStats {
  file_name: string;
  record_count: number;
  unique_clients: number;
  total_value: number;
  first_upload: string;
  last_upload: string;
}

export const UploadHistoryTable = () => {
  const { data: uploadHistory, isLoading } = useQuery({
    queryKey: ["upload-history"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_trade_file_stats');
      
      if (error) throw error;
      
      return (data || []) as FileUploadStats[];
    },
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-BD", {
      style: "currency",
      currency: "BDT",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDateTime = (dateStr: string) => {
    return format(new Date(dateStr), "dd MMM yyyy, HH:mm");
  };

  const extractDateFromFilename = (filename: string) => {
    const match = filename.match(/^(\d{8})/);
    if (match) {
      const dateStr = match[1];
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      return `${day}/${month}/${year}`;
    }
    return null;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Upload History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Upload History
          <Badge variant="secondary" className="ml-2">
            {uploadHistory?.length || 0} files
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File Name</TableHead>
                <TableHead className="text-center">Trade Date</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead className="text-right">Unique Clients</TableHead>
                <TableHead className="text-right">Total Value</TableHead>
                <TableHead>First Upload</TableHead>
                <TableHead>Last Upload</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {uploadHistory?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No upload history found
                  </TableCell>
                </TableRow>
              ) : (
                uploadHistory?.map((file) => (
                  <TableRow key={file.file_name}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate max-w-[300px]" title={file.file_name}>
                          {file.file_name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">
                        <Calendar className="h-3 w-3 mr-1" />
                        {extractDateFromFilename(file.file_name) || "N/A"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Hash className="h-3 w-3 text-muted-foreground" />
                        {file.record_count.toLocaleString()}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {file.unique_clients.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatCurrency(file.total_value)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDateTime(file.first_upload)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDateTime(file.last_upload)}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {uploadHistory && uploadHistory.length > 0 && (
          <div className="mt-4 flex gap-4 text-sm text-muted-foreground">
            <div>
              Total Records: <span className="font-medium text-foreground">
                {uploadHistory.reduce((sum, f) => sum + f.record_count, 0).toLocaleString()}
              </span>
            </div>
            <div>
              Total Value: <span className="font-medium text-foreground">
                {formatCurrency(uploadHistory.reduce((sum, f) => sum + f.total_value, 0))}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
