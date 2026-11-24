'use client';

import type { Report, ReportGroup } from '@upgradepilot/shared';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { OriginBadge } from '@/components/badges';
import { EmptyState, ErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api';
import { UNRESOLVED_REASON_LABEL, pluralize, shortSha } from '@/lib/format';
import { markdownReportUrl, useReport } from '@/lib/queries';
import { UpgradeTypeBadge } from '@/components/badges';
import { EntryCard } from './entry-card';
import { SafeLink, isHttpUrl } from '@/components/safe-link';

const GROUP_LABEL: Record<ReportGroup, string> = { highRisk: 'High risk', review: 'Review', safe: 'Safe' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function downloadJson(report: Report) {
  const slug = (s: string) => s.replace(/[^\w.-]/g, '_');
  const { owner, name, commitSha } = report.repository;
  const filename = `upgradepilot-${slug(owner)}-${slug(name)}-${slug(shortSha(commitSha) || 'unknown')}.json`;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Checklist({ items }: { items: Report['migrationChecklist'] }) {
  // Local state only, not persisted.
  const [done, setDone] = useState<Set<number>>(new Set());
  const toggle = (i: number, checked: boolean) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (checked) next.add(i);
      else next.delete(i);
      return next;
    });
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3 rounded-md border px-3 py-2 text-sm">
          <Checkbox id={`check-${i}`} checked={done.has(i)} onCheckedChange={(c) => toggle(i, c === true)} className="mt-0.5" />
          <label htmlFor={`check-${i}`} className="min-w-0 flex-1 cursor-pointer">
            <span className="font-mono text-xs text-muted-foreground">{item.packageName}</span>
            <span className={`block break-words ${done.has(i) ? 'text-muted-foreground line-through' : ''}`}>{item.step}</span>
          </label>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <OriginBadge origin={item.origin} />
            {isHttpUrl(item.sourceUrl) && (
              <SafeLink href={item.sourceUrl} className="text-xs">
                Source
              </SafeLink>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function UnresolvedTable({ rows }: { rows: Report['unresolved'] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Package</TableHead>
          <TableHead>Manifest</TableHead>
          <TableHead>Declared range</TableHead>
          <TableHead>Reason</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            <TableCell className="font-mono">{r.packageName}</TableCell>
            <TableCell className="font-mono text-xs">{r.manifestPath}</TableCell>
            <TableCell className="font-mono text-xs">{r.declaredRange}</TableCell>
            <TableCell className="whitespace-normal">
              {(UNRESOLVED_REASON_LABEL as Record<string, string>)[r.reason] ?? r.reason}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ReportBody({ scanId, report }: { scanId: string; report: Report }) {
  const { groups, ai } = report;
  const hasUpgrades = groups.highRisk.length + groups.review.length + groups.safe.length > 0;
  const aiLine = ai.provider
    ? `AI analysis: ${ai.provider}/${ai.model ?? 'unknown model'}, ${ai.analyzed} analysed, ${ai.skipped} skipped, ${ai.failed} failed`
    : 'AI analysis: off';

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={markdownReportUrl(scanId)} download>
            <Download aria-hidden /> Download Markdown
          </a>
        </Button>
        <Button variant="outline" size="sm" onClick={() => downloadJson(report)}>
          <Download aria-hidden /> Download JSON
        </Button>
      </div>

      <Section title="Executive summary">
        <p className="text-sm break-words">{report.executiveSummary}</p>
        <p className="text-sm text-muted-foreground">
          {aiLine}
          {ai.note ? `. ${ai.note}` : ''}
        </p>
      </Section>

      {!hasUpgrades && <EmptyState title="Everything is up to date" description="No dependency has a newer version to upgrade to." />}

      {report.upgradePlan.length > 0 && (
        <Section title="Upgrade plan">
          <ol className="space-y-2">
            {report.upgradePlan.map((item) => (
              <li key={item.order} className="flex items-start gap-3 rounded-md border px-3 py-2 text-sm">
                <span className="w-6 shrink-0 text-right font-mono text-muted-foreground">{item.order}</span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono font-medium break-all">{item.packageName}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {item.from} → {item.to}
                    </span>
                    <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">{GROUP_LABEL[item.group]}</span>
                  </div>
                  <p className="text-muted-foreground break-words">{item.reason}</p>
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {groups.highRisk.length > 0 && (
        <Section title="High-risk migrations">
          <div className="space-y-4">
            {groups.highRisk.map((e) => (
              <EntryCard key={`${e.packageName}@${e.targetVersion}`} entry={e} />
            ))}
          </div>
        </Section>
      )}

      {groups.review.length > 0 && (
        <Section title="Review before upgrading">
          <div className="space-y-4">
            {groups.review.map((e) => (
              <EntryCard key={`${e.packageName}@${e.targetVersion}`} entry={e} />
            ))}
          </div>
        </Section>
      )}

      {groups.safe.length > 0 && (
        <Section title="Safe candidates">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Package</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.safe.map((e) => (
                <TableRow key={`${e.packageName}@${e.targetVersion}`}>
                  <TableCell className="font-mono">{e.packageName}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {e.currentVersion} → {e.targetVersion}
                  </TableCell>
                  <TableCell>
                    <UpgradeTypeBadge type={e.upgradeType} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {e.advisoriesFixed.length > 0
                      ? `Fixes ${pluralize(e.advisoriesFixed.length, 'advisory', 'advisories')}`
                      : (e.reasons[0]?.text ?? '')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {report.migrationChecklist.length > 0 && (
        <Section title="Migration checklist">
          <Checklist items={report.migrationChecklist} />
        </Section>
      )}

      {report.unresolved.length > 0 && (
        <Section title="Unresolved dependencies">
          {report.unresolved.length > 10 ? (
            <details className="rounded-md border px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">Show {report.unresolved.length} unresolved dependencies</summary>
              <div className="mt-2">
                <UnresolvedTable rows={report.unresolved} />
              </div>
            </details>
          ) : (
            <UnresolvedTable rows={report.unresolved} />
          )}
        </Section>
      )}

      {report.warnings.length > 0 && (
        <Section title="Warnings">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {report.warnings.map((w, i) => (
              <li key={i} className="break-words">
                {w}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export function ReportView({ scanId }: { scanId: string }) {
  const { data, error, isPending, refetch } = useReport(scanId, true);

  if (isPending) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading report">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (error) {
    if (error instanceof ApiError && error.status === 409) return <p className="text-sm text-muted-foreground">The report is not ready yet.</p>;
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }
  return <ReportBody scanId={scanId} report={data} />;
}
