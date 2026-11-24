'use client';

import type { Scan } from '@upgradepilot/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useReport } from '@/lib/queries';

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card size="sm">
      <CardContent className="space-y-0.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="font-mono text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function CompletedSummary({ scanId }: { scanId: string }) {
  const report = useReport(scanId, true);
  if (report.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-busy="true" aria-label="Loading summary">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }
  // The table below still works without the report, so a failed summary is not worth an error block.
  if (report.isError) return null;
  const t = report.data.totals;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat label="Dependencies" value={t.dependencies} />
      <Stat label="Outdated" value={t.outdated} hint={`${t.patch} patch · ${t.minor} minor · ${t.major} major`} />
      <Stat label="High risk" value={t.highRisk} />
      <Stat label="Security fixes" value={t.securityFixes} />
      <Stat label="Unresolved" value={t.unresolved} />
    </div>
  );
}

export function DiscoverySummary({ scan }: { scan: Scan }) {
  const d = scan.discovery;
  if (!d) return null;
  const parsed = d.manifests.filter((m) => m.status === 'parsed').length;
  return (
    <Card size="sm">
      <CardContent className="space-y-2 text-sm">
        <p className="font-medium">Discovery so far</p>
        <ul className="space-y-1 text-muted-foreground">
          <li>
            <span className="font-mono text-foreground">{parsed}</span> of {d.manifests.length} manifests parsed
          </li>
          <li>
            <span className="font-mono text-foreground">{d.skippedManifests.length}</span> manifests skipped
          </li>
          {d.treeTruncated && <li>The repository tree was too large and was truncated.</li>}
        </ul>
        {d.warnings.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-amber-800">
            {d.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
