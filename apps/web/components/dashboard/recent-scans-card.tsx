'use client';

import Link from 'next/link';
import { ChevronRight, GitBranch, History, ScanSearch } from 'lucide-react';
import { GitHubIcon } from '@/components/brand';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScanStatusBadge } from '@/components/badges';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { formatRelative, shortSha } from '@/lib/format';
import { isActiveStatus, useDashboard } from '@/lib/queries';

export function RecentScansCard() {
  const { data, isPending, isError, error, refetch } = useDashboard();
  const scans = data?.recentScans ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" aria-hidden />
          Recent scans
        </CardTitle>
        <Link href="/repositories/" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
          View all
          <ChevronRight aria-hidden />
        </Link>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <LoadingRows rows={5} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : scans.length === 0 ? (
          <EmptyState icon={ScanSearch} title="No scans yet" description="Start one with the New scan form to see results here." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repository</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Outdated</TableHead>
                  <TableHead className="text-right">High risk</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scans.map((scan) => (
                  <TableRow key={scan.id} className="transition-colors hover:bg-muted/50">
                    <TableCell>
                      <Link
                        href={`/repository/?id=${encodeURIComponent(scan.repository.id)}`}
                        className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
                      >
                        <GitHubIcon className="size-4 shrink-0 text-muted-foreground" />
                        {scan.repository.owner}/{scan.repository.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 font-mono text-xs">
                        <GitBranch className="size-3.5 text-muted-foreground" aria-hidden />
                        {scan.branch}
                      </span>
                      {scan.commitSha && <span className="ml-1.5 font-mono text-xs text-muted-foreground">{shortSha(scan.commitSha)}</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-32 flex-col gap-1.5">
                        <div>
                          <ScanStatusBadge status={scan.status} />
                        </div>
                        {isActiveStatus(scan.status) && (
                          <div className="flex items-center gap-2">
                            <Progress value={scan.progress} className="h-1 flex-1" aria-label={`Scan progress ${scan.progress}%`} />
                            <span className="text-xs tabular-nums text-muted-foreground">{scan.progress}%</span>
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className={cn('text-right tabular-nums', scan.totals.outdated > 0 && 'font-medium text-amber-700')}>{scan.totals.outdated}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', scan.totals.highRisk > 0 && 'font-medium text-red-700')}>{scan.totals.highRisk}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelative(scan.createdAt)}</TableCell>
                    <TableCell>
                      <Link
                        href={`/scan/?id=${encodeURIComponent(scan.id)}`}
                        className="inline-flex items-center text-sm text-primary underline-offset-4 hover:underline"
                        aria-label={`View scan of ${scan.repository.owner}/${scan.repository.name} on ${scan.branch}`}
                      >
                        View
                        <ChevronRight className="size-4" aria-hidden />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
