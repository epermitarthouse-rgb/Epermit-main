import { useState } from 'react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Mail,
  Clock,
  ChevronDown,
  ChevronUp,
  History,
  Users,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { useReportDeliveryLogs } from '@/hooks/useReportDeliveryLogs';

interface ReportDeliveryHistoryProps {
  reportId?: string;
}

export function ReportDeliveryHistory({ reportId }: ReportDeliveryHistoryProps) {
  const { logs, loading, retrying, retryFailedEmails } = useReportDeliveryLogs(reportId);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());

  const toggleExpand = (logId: string) => {
    setExpandedLogs(prev => {
      const next = new Set(prev);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-600" />;
      case 'partial':
        return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-600" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return <Badge variant="default" className="bg-green-600">Success</Badge>;
      case 'partial':
        return <Badge variant="default" className="bg-yellow-600">Partial</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return null;
    }
  };

  const handleRetry = (logId: string, failedEmails?: string[]) => {
    retryFailedEmails(logId, failedEmails);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed rounded-lg">
        <History className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-muted-foreground">No delivery history yet.</p>
        <p className="text-sm text-muted-foreground mt-1">
          Reports will appear here after they are sent.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <AnimatePresence mode="popLayout">
        {logs.map((log, index) => {
          const hasFailedEmails = log.failed_emails && log.failed_emails.length > 0;
          const isRetrying = retrying === log.id;

          return (
            <motion.div
              key={log.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ delay: index * 0.03 }}
            >
              <Card>
                <Collapsible
                  open={expandedLogs.has(log.id)}
                  onOpenChange={() => toggleExpand(log.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {getStatusIcon(log.status)}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium truncate">{log.report_name}</h3>
                            {getStatusBadge(log.status)}
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground mt-1">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {format(new Date(log.sent_at), 'MMM d, yyyy h:mm a')}
                            </span>
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {log.successful_count}/{log.recipient_count} delivered
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {hasFailedEmails && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRetry(log.id, log.failed_emails);
                            }}
                            disabled={isRetrying}
                            className="text-xs"
                          >
                            {isRetrying ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3 mr-1" />
                            )}
                            Retry Failed
                          </Button>
                        )}
                        <CollapsibleTrigger asChild>
                          <Button variant="ghost" size="sm">
                            {expandedLogs.has(log.id) ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </CollapsibleTrigger>
                      </div>
                    </div>

                    <CollapsibleContent>
                      <div className="mt-4 pt-4 border-t space-y-3">
                        <div>
                          <p className="text-sm font-medium mb-2 flex items-center gap-2">
                            <Mail className="h-4 w-4" />
                            Recipients ({log.recipient_count})
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {log.recipient_emails.map((email) => {
                              const isFailed = log.failed_emails?.includes(email);
                              return (
                                <div key={email} className="flex items-center gap-1">
                                  <Badge
                                    variant={isFailed ? 'destructive' : 'secondary'}
                                    className="text-xs"
                                  >
                                    {email}
                                    {isFailed && (
                                      <XCircle className="h-3 w-3 ml-1" />
                                    )}
                                  </Badge>
                                  {isFailed && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0"
                                      onClick={() => handleRetry(log.id, [email])}
                                      disabled={isRetrying}
                                      title={`Retry sending to ${email}`}
                                    >
                                      {isRetrying ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                      ) : (
                                        <RefreshCw className="h-3 w-3" />
                                      )}
                                    </Button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {log.error_message && (
                          <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md p-3">
                            <p className="text-sm text-red-700 dark:text-red-400">
                              {log.error_message}
                            </p>
                          </div>
                        )}

                        <div className="grid grid-cols-3 gap-4 text-center">
                          <div className="bg-muted/50 rounded-md p-2">
                            <p className="text-lg font-semibold text-primary">{log.recipient_count}</p>
                            <p className="text-xs text-muted-foreground">Total</p>
                          </div>
                          <div className="bg-green-50 dark:bg-green-950/30 rounded-md p-2">
                            <p className="text-lg font-semibold text-green-600">{log.successful_count}</p>
                            <p className="text-xs text-green-600">Delivered</p>
                          </div>
                          <div className="bg-red-50 dark:bg-red-950/30 rounded-md p-2">
                            <p className="text-lg font-semibold text-red-600">{log.failed_count}</p>
                            <p className="text-xs text-red-600">Failed</p>
                          </div>
                        </div>

                        {hasFailedEmails && (
                          <div className="pt-2 border-t">
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => handleRetry(log.id, log.failed_emails)}
                              disabled={isRetrying}
                              className="w-full"
                            >
                              {isRetrying ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4 mr-2" />
                              )}
                              Retry All Failed Emails ({log.failed_count})
                            </Button>
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </CardContent>
                </Collapsible>
              </Card>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
