'use client';

import { CalendarClock, ChevronRight, FolderGit2, GitBranch, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { SafeLink } from '@/components/safe-link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { GitHubIcon } from '@/components/brand';
import { ScanStatusBadge } from '@/components/badges';
import { ExpiryBadge } from '@/components/expiry-badge';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api';
import { formatDate, shortSha } from '@/lib/format';
import { cn } from '@/lib/utils';
import { isActiveStatus, useCreateScan, useScanHistory } from '@/lib/queries';
import { LanguageDot } from './language-dot';
import { Pagination } from './pagination';

function NotFound() {
  return (
    <EmptyState
      icon={FolderGit2}
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
      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200">
              <GitHubIcon className="size-5" />
            </span>
            <div className="min-w-0 space-y-1.5">
              <h1 className="text-xl font-semibold break-all">
                {repo.owner}/{repo.name}
              </h1>
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <SafeLink href={repo.url}>View on GitHub</SafeLink>
                <span className="inline-flex items-center gap-1.5">
                  <GitBranch className="size-4" aria-hidden />
                  Default branch <span className="font-mono text-foreground">{repo.defaultBranch}</span>
                </span>
                {repo.primaryLanguage ? <LanguageDot language={repo.primaryLanguage} /> : <span>Language unknown</span>}
              </p>
            </div>
          </div>
          <Button onClick={rescan} disabled={createScan.isPending}>
            {createScan.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
            {createScan.isPending ? 'Starting scan...' : `Scan ${repo.defaultBranch} again`}
          </Button>
        </CardContent>
      </Card>

      {createScan.isError && (
        <Alert variant="destructive">
          <AlertDescription>{createScan.error.message}</AlertDescription>
        </Alert>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Scan history</h2>
        {data.items.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No scans yet" description="Start a scan to see its result here." />
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
                  <TableHead>Expires</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((scan) => (
                  <TableRow key={scan.id} className="hover:bg-muted/50">
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
                        {formatDate(scan.createdAt)}
                      </span>
                    </TableCell>
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
                    <TableCell className="text-right tabular-nums">{scan.totals.dependencies}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', scan.totals.outdated > 0 && 'font-medium text-amber-700')}>{scan.totals.outdated}</TableCell>
                    <TableCell className={cn('text-right tabular-nums', scan.totals.highRisk > 0 && 'font-medium text-red-700')}>{scan.totals.highRisk}</TableCell>
                    <TableCell>
                      <ExpiryBadge expiresAt={scan.expiresAt} compact />
                    </TableCell>
                    <TableCell>
                      <Link href={`/scan/?id=${encodeURIComponent(scan.id)}`} className="inline-flex items-center gap-0.5 rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                        View <ChevronRight className="size-4" aria-hidden />
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
