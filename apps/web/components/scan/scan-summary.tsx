'use client';

import type { Scan } from '@upgradepilot/shared';
import { ArrowUpCircle, CircleHelp, FileSearch, Package, ShieldAlert, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react';
import { IconChip, type IconTone } from '@/components/icon-chip';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useReport } from '@/lib/queries';

function Stat({
  label,
  value,
  icon,
  tone,
  children,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: IconTone;
  children?: React.ReactNode;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-start gap-3">
        <IconChip icon={icon} tone={tone} />
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

function Chip({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${className}`}>{children}</span>;
}

export function CompletedSummary({ scanId }: { scanId: string }) {
  const report = useReport(scanId, true);
  if (report.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-busy="true" aria-label="Loading summary">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  // The table below still works without the report, so a failed summary is not worth an error block.
  if (report.isError) return null;
  const t = report.data.totals;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat label="Dependencies" value={t.dependencies} icon={Package} tone="sky" />
      <Stat label="Outdated" value={t.outdated} icon={ArrowUpCircle} tone="amber">
        <div className="flex flex-wrap gap-1 pt-0.5">
          <Chip className="bg-emerald-50 text-emerald-700">{t.patch} patch</Chip>
          <Chip className="bg-sky-50 text-sky-700">{t.minor} minor</Chip>
          <Chip className="bg-amber-50 text-amber-800">{t.major} major</Chip>
        </div>
      </Stat>
      <Stat label="High risk" value={t.highRisk} icon={ShieldAlert} tone="red" />
      <Stat label="Security fixes" value={t.securityFixes} icon={ShieldCheck} tone="emerald" />
      <Stat label="Unresolved" value={t.unresolved} icon={CircleHelp} tone="slate" />
    </div>
  );
}

export function DiscoverySummary({ scan }: { scan: Scan }) {
  const d = scan.discovery;
  if (!d) return null;
  const parsed = d.manifests.filter((m) => m.status === 'parsed').length;
  return (
    <Card size="sm">
      <CardContent className="flex items-start gap-3 text-sm">
        <IconChip icon={FileSearch} tone="sky" />
        <div className="min-w-0 space-y-2">
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
            <ul className="space-y-0.5 text-amber-800">
              {d.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
