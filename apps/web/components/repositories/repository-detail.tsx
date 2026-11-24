'use client';

import Link from 'next/link';
import { SafeLink } from '@/components/safe-link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ScanStatusBadge } from '@/components/badges';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api';
import { formatDate, shortSha } from '@/lib/format';
import { isActiveStatus, useCreateScan, useScanHistory } from '@/lib/queries';
import { Pagination } from './pagination';

function NotFound() {
  return (
    <EmptyState
      title="Repository not found"
      description="This repository does not exist, or no id was given."
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/repositories/">Back to repositories</Link>
        </Button>
      }
    />
  );
}

export function RepositoryDetail({ id }: { id: string | null }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data, error, isPending, refetch } = useScanHistory(id, page);
  const createScan = useCreateScan();

  if (!id) return <NotFound />;
  if (isPending) return <LoadingRows />;
  if (error) {
    if (error instanceof ApiError && error.status === 404) return <NotFound />;
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }

  const repo = data.repository;
  const rescan = () =>
    createScan.mutate(
      { url: repo.url, branch: repo.defaultBranch },
      { onSuccess: (res) => router.push(`/scan/?id=${encodeURIComponent(res.scanId)}`) },
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold break-all">
            {repo.owner}/{repo.name}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <SafeLink href={repo.url}>View on GitHub</SafeLink>
            <span>
              Default branch <span className="font-mono">{repo.defaultBranch}</span>
            </span>
            <span>{repo.primaryLanguage ?? 'Language unknown'}</span>
          </p>
        </div>
        <Button onClick={rescan} disabled={createScan.isPending}>
          {createScan.isPending ? 'Starting scan...' : `Scan ${repo.defaultBranch} again`}
        </Button>
      </div>

      {createScan.isError && (
        <Alert variant="destructive">
          <AlertDescription>{createScan.error.message}</AlertDescription>
        </Alert>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Scan history</h2>
        {data.items.length === 0 ? (
          <EmptyState title="No scans yet" description="Start a scan to see its result here." />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Dependencies</TableHead>
                  <TableHead className="text-right">Outdated</TableHead>
                  <TableHead className="text-right">High risk</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((scan) => (
                  <TableRow key={scan.id}>
                    <TableCell>{formatDate(scan.createdAt)}</TableCell>
                    <TableCell>
                      {scan.branch}
                      {scan.commitSha && <span className="ml-2 font-mono text-xs text-muted-foreground">{shortSha(scan.commitSha)}</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-32 flex-col gap-1.5">
                        <span>
                          <ScanStatusBadge status={scan.status} />
                        </span>
                        {isActiveStatus(scan.status) && (
                          <div className="flex items-center gap-2">
                            <Progress value={scan.progress} aria-label="Scan progress" />
                            <span className="text-xs text-muted-foreground">{scan.progress}%</span>
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{scan.totals.dependencies}</TableCell>
                    <TableCell className="text-right">{scan.totals.outdated}</TableCell>
                    <TableCell className="text-right">{scan.totals.highRisk}</TableCell>
                    <TableCell>
                      <Link href={`/scan/?id=${encodeURIComponent(scan.id)}`} className="text-primary underline-offset-4 hover:underline">
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </section>
    </div>
  );
}
