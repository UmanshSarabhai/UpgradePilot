'use client';

import { FolderGit2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { GitHubIcon } from '@/components/brand';
import { ScanStatusBadge } from '@/components/badges';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRepositories } from '@/lib/queries';
import { LanguageDot } from './language-dot';
import { Pagination } from './pagination';

export function RepositoryList() {
  const [page, setPage] = useState(1);
  const { data, error, isPending, refetch } = useRepositories(page);

  if (isPending) return <LoadingRows />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (data.items.length === 0 && page === 1) {
    return (
      <EmptyState
        icon={FolderGit2}
        title="No repositories yet"
        description="Scan a public GitHub repository from the dashboard to see it here."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/">Go to the dashboard</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Repository</TableHead>
            <TableHead>Language</TableHead>
            <TableHead className="text-right">Scans</TableHead>
            <TableHead>Last scan</TableHead>
            <TableHead className="text-right">Outdated</TableHead>
            <TableHead className="text-right">High risk</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((repo) => (
            <TableRow key={repo.id} className="hover:bg-muted/50">
              <TableCell>
                <Link href={`/repository/?id=${encodeURIComponent(repo.id)}`} className="inline-flex items-center gap-2 rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                  <GitHubIcon className="text-muted-foreground" />
                  {repo.owner}/{repo.name}
                </Link>
              </TableCell>
              <TableCell>
                <LanguageDot language={repo.primaryLanguage} />
              </TableCell>
              <TableCell className="text-right">{repo.scanCount}</TableCell>
              <TableCell>
                {repo.lastScan ? (
                  <span className="inline-flex items-center gap-2">
                    <ScanStatusBadge status={repo.lastScan.status} />
                    <span className="text-muted-foreground">{formatRelative(repo.lastScan.createdAt)}</span>
                  </span>
                ) : (
                  '-'
                )}
              </TableCell>
              <TableCell className={cn('text-right tabular-nums', repo.lastScan && repo.lastScan.totals.outdated > 0 && 'font-medium text-amber-700')}>
                {repo.lastScan ? repo.lastScan.totals.outdated : '-'}
              </TableCell>
              <TableCell className={cn('text-right tabular-nums', repo.lastScan && repo.lastScan.totals.highRisk > 0 && 'font-medium text-red-700')}>
                {repo.lastScan ? repo.lastScan.totals.highRisk : '-'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </div>
  );
}
