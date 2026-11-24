'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ScanStatusBadge } from '@/components/badges';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatRelative } from '@/lib/format';
import { useRepositories } from '@/lib/queries';
import { Pagination } from './pagination';

export function RepositoryList() {
  const [page, setPage] = useState(1);
  const { data, error, isPending, refetch } = useRepositories(page);

  if (isPending) return <LoadingRows />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (data.items.length === 0 && page === 1) {
    return (
      <EmptyState
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
            <TableRow key={repo.id}>
              <TableCell>
                <Link href={`/repository/?id=${encodeURIComponent(repo.id)}`} className="font-medium text-primary underline-offset-4 hover:underline">
                  {repo.owner}/{repo.name}
                </Link>
              </TableCell>
              <TableCell>{repo.primaryLanguage ?? '-'}</TableCell>
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
              <TableCell className="text-right">{repo.lastScan ? repo.lastScan.totals.outdated : '-'}</TableCell>
              <TableCell className="text-right">{repo.lastScan ? repo.lastScan.totals.highRisk : '-'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Pagination page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
    </div>
  );
}
