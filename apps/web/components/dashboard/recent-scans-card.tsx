'use client';

import Link from 'next/link';
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
      <CardHeader>
        <CardTitle>Recent scans</CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <LoadingRows rows={5} />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : scans.length === 0 ? (
          <EmptyState title="No scans yet" description="Start one with the New scan form to see results here." />
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
                  <TableRow key={scan.id}>
                    <TableCell>
                      <Link
                        href={`/repository/?id=${encodeURIComponent(scan.repository.id)}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {scan.repository.owner}/{scan.repository.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">{scan.branch}</span>
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
                    <TableCell className="text-right tabular-nums">{scan.totals.outdated}</TableCell>
                    <TableCell className="text-right tabular-nums">{scan.totals.highRisk}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatRelative(scan.createdAt)}</TableCell>
                    <TableCell>
                      <Link
                        href={`/scan/?id=${encodeURIComponent(scan.id)}`}
                        className="text-sm underline-offset-4 hover:underline"
                        aria-label={`View scan of ${scan.repository.owner}/${scan.repository.name} on ${scan.branch}`}
                      >
                        View
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
