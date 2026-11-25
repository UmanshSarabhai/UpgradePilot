'use client';

import type { Scan } from '@upgradepilot/shared';
import { AlertCircle, CalendarClock, GitBranch, GitCommitHorizontal, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { ScanStatusBadge } from '@/components/badges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { formatDate, shortSha } from '@/lib/format';
import { isActiveStatus } from '@/lib/queries';
import { isHttpUrl } from '@/components/safe-link';
import { GitHubIcon } from '@/components/brand';
import { ExpiryBadge } from '@/components/expiry-badge';

export function ScanHeader({ scan }: { scan: Scan }) {
  const active = isActiveStatus(scan.status);
  const { repository } = scan;
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex min-w-0 items-center gap-2 text-2xl font-semibold tracking-tight">
          <Link href={`/repository/?id=${encodeURIComponent(repository.id)}`} className="truncate rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            {repository.owner}/{repository.name}
          </Link>
          {isHttpUrl(repository.url) && (
            <a
              href={repository.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${repository.owner}/${repository.name} on GitHub`}
              className="shrink-0 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <GitHubIcon className="size-5" />
            </a>
          )}
        </h1>
        <ScanStatusBadge status={scan.status} />
        <ExpiryBadge expiresAt={scan.expiresAt} />
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <dt className="sr-only">Branch</dt>
          <GitBranch className="size-4" aria-hidden />
          <dd className="font-mono text-foreground">{scan.branch}</dd>
        </div>
        {scan.commitSha && (
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Commit</dt>
            <GitCommitHorizontal className="size-4" aria-hidden />
            <dd className="font-mono text-foreground">{shortSha(scan.commitSha)}</dd>
          </div>
        )}
        {scan.startedAt && (
          <div className="flex items-center gap-1.5">
            <CalendarClock className="size-4" aria-hidden />
            <dt>Started</dt>
            <dd className="text-foreground">{formatDate(scan.startedAt)}</dd>
          </div>
        )}
        {scan.completedAt && (
          <div className="flex items-center gap-1.5">
            <CalendarClock className="size-4" aria-hidden />
            <dt>Completed</dt>
            <dd className="text-foreground">{formatDate(scan.completedAt)}</dd>
          </div>
        )}
      </dl>

      {active && (
        <div className="space-y-2 rounded-xl border bg-card p-4 shadow-xs" role="status">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 font-medium">
              <Loader2 className="size-4 shrink-0 animate-spin text-indigo-600 motion-reduce:animate-none" aria-hidden />
              <span className="truncate">{scan.currentStage ?? 'Starting'}</span>
            </span>
            <span className="font-mono text-muted-foreground">{scan.progress}%</span>
          </div>
          <Progress value={scan.progress} aria-label="Scan progress" />
          {scan.errorMessage && <p className="text-sm text-muted-foreground">{scan.errorMessage}</p>}
        </div>
      )}

      {scan.status === 'FAILED' && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden />
          <AlertTitle>Scan failed</AlertTitle>
          <AlertDescription>{scan.errorMessage ?? 'The scan failed without an error message.'}</AlertDescription>
        </Alert>
      )}
    </header>
  );
}
