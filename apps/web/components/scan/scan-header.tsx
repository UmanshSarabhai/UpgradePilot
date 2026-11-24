'use client';

import type { Scan } from '@upgradepilot/shared';
import { AlertCircle, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { ScanStatusBadge } from '@/components/badges';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { formatDate, shortSha } from '@/lib/format';
import { isActiveStatus } from '@/lib/queries';
import { isHttpUrl } from '@/components/safe-link';

export function ScanHeader({ scan }: { scan: Scan }) {
  const active = isActiveStatus(scan.status);
  const { repository } = scan;
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="flex min-w-0 items-center gap-2 text-xl font-semibold">
          <Link href={`/repository/?id=${encodeURIComponent(repository.id)}`} className="truncate hover:underline">
            {repository.owner}/{repository.name}
          </Link>
          {isHttpUrl(repository.url) && (
            <a
              href={repository.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${repository.owner}/${repository.name} on GitHub`}
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-4" aria-hidden />
            </a>
          )}
        </h1>
        <ScanStatusBadge status={scan.status} />
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <div className="flex gap-1.5">
          <dt>Branch</dt>
          <dd className="font-mono text-foreground">{scan.branch}</dd>
        </div>
        {scan.commitSha && (
          <div className="flex gap-1.5">
            <dt>Commit</dt>
            <dd className="font-mono text-foreground">{shortSha(scan.commitSha)}</dd>
          </div>
        )}
        {scan.startedAt && (
          <div className="flex gap-1.5">
            <dt>Started</dt>
            <dd className="text-foreground">{formatDate(scan.startedAt)}</dd>
          </div>
        )}
        {scan.completedAt && (
          <div className="flex gap-1.5">
            <dt>Completed</dt>
            <dd className="text-foreground">{formatDate(scan.completedAt)}</dd>
          </div>
        )}
      </dl>

      {active && (
        <div className="space-y-1.5" role="status">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{scan.currentStage ?? 'Starting'}</span>
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
