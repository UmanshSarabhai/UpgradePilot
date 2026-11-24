import type { Finding, ReportEntry } from '@upgradepilot/shared';
import type { LucideIcon } from 'lucide-react';
import { OriginBadge, RecommendationBadge, RiskBadge, UpgradeTypeBadge } from '@/components/badges';
import { ArrowRight, ArrowUpCircle, BookOpen, ChevronRight, FileCode, ListChecks, ShieldAlert, Sparkles, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { pluralize } from '@/lib/format';
import { SafeLink, isHttpUrl } from '@/components/safe-link';
import { cn } from '@/lib/utils';
import { GROUP_STYLE } from './group-style';

function SubHeading({ icon: Icon, className, children }: { icon: LucideIcon; className?: string; children: React.ReactNode }) {
  return (
    <h4 className="flex items-center gap-1.5 text-sm font-semibold">
      <Icon className={cn('size-4 text-muted-foreground', className)} aria-hidden />
      {children}
    </h4>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <span className="inline-flex items-center gap-2">
      <span>Confidence</span>
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" role="presentation">
        <span className="block h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} />
      </span>
      <span className="font-medium text-foreground">{pct}%</span>
    </span>
  );
}

function FindingList({ items }: { items: Finding[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex flex-wrap items-start gap-x-2 gap-y-1">
          <OriginBadge origin={item.origin} />
          <span className="min-w-0 flex-1 break-words">{item.text}</span>
          {isHttpUrl(item.sourceUrl) && <SafeLink href={item.sourceUrl}>Source</SafeLink>}
        </li>
      ))}
    </ul>
  );
}

function Collapsible({ icon: Icon, summary, children, open }: { icon: LucideIcon; summary: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-md border px-3 py-2 transition-colors open:bg-muted/30 hover:bg-muted/30">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

export function EntryCard({ entry }: { entry: ReportEntry }) {
  const { analysis } = entry;
  return (
    <Card className={cn('border-l-4 transition-shadow hover:shadow-md', GROUP_STYLE[entry.group].border)}>
      <CardHeader className="gap-2">
        <CardTitle className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-mono break-all">{entry.packageName}</span>
          <span className="inline-flex items-center gap-1.5 font-mono text-sm font-normal text-muted-foreground">
            {entry.currentVersion}
            <ArrowRight className="size-3.5" aria-hidden />
            {entry.targetVersion}
          </span>
          <UpgradeTypeBadge type={entry.upgradeType} />
          <RiskBadge level={entry.riskLevel} />
          <RecommendationBadge recommendation={entry.recommendation} />
        </CardTitle>
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {entry.manifests.map((m, i) => (
            <li key={i} className="break-all">
              <span className="font-mono">{m.path}</span> · {m.dependencyType} · declared{' '}
              <span className="font-mono">{m.declaredRange}</span>
            </li>
          ))}
        </ul>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {entry.deprecation && (
          <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span><span className="font-medium">Deprecated:</span> {entry.deprecation}</span>
          </p>
        )}

        {entry.advisoriesFixed.length > 0 && (
          <section className="space-y-1.5">
            <SubHeading icon={ShieldAlert} className="text-emerald-600">Advisories fixed</SubHeading>
            <ul className="space-y-1.5">
              {entry.advisoriesFixed.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge variant="outline">{a.severity}</Badge>
                  <SafeLink href={a.url}>{a.title}</SafeLink>
                </li>
              ))}
            </ul>
          </section>
        )}

        {entry.reasons.length > 0 && (
          <section className="space-y-1.5">
            <SubHeading icon={ArrowUpCircle} className="text-indigo-600">Why update</SubHeading>
            <FindingList items={entry.reasons} />
          </section>
        )}

        {entry.risks.length > 0 && (
          <section className="space-y-1.5">
            <SubHeading icon={ShieldAlert} className="text-red-600">What could break</SubHeading>
            <FindingList items={entry.risks} />
          </section>
        )}

        <section className="space-y-1.5">
          <SubHeading icon={Sparkles} className="text-violet-600">AI summary</SubHeading>
          {analysis ? (
            <div className="space-y-2">
              <p className="break-words">{analysis.summary}</p>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <ConfidenceBar value={analysis.confidence} />
                <span className="font-mono">{analysis.provider}/{analysis.model}</span>
              </p>
              {analysis.inconclusive && (
                <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Inconclusive. The release text was not enough to judge this upgrade.
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">{entry.analysisNote ?? 'No AI analysis for this upgrade.'}</p>
          )}
        </section>

        {analysis && analysis.deprecatedFeatures.length > 0 && (
          <section className="space-y-1.5">
            <SubHeading icon={TriangleAlert} className="text-amber-600">Deprecated features</SubHeading>
            <FindingList items={analysis.deprecatedFeatures} />
          </section>
        )}

        {analysis && analysis.migrationSteps.length > 0 && (
          <section className="space-y-1.5">
            <SubHeading icon={ListChecks} className="text-indigo-600">Migration steps</SubHeading>
            <ol className="list-decimal space-y-1.5 pl-5">
              {analysis.migrationSteps.map((s, i) => (
                <li key={i} className="pl-1">
                  <span className="mr-2 break-words">{s.text}</span>
                  <OriginBadge origin={s.origin} />
                  {isHttpUrl(s.sourceUrl) && (
                    <>
                      {' '}
                      <SafeLink href={s.sourceUrl}>Source</SafeLink>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {analysis && analysis.potentiallyAffectedFiles.length > 0 && (
          <Collapsible icon={FileCode} summary={`Potentially affected files (${analysis.potentiallyAffectedFiles.length})`}>
            <ul className="space-y-1.5">
              {analysis.potentiallyAffectedFiles.map((f, i) => (
                <li key={i} className="flex flex-wrap items-start gap-x-2 gap-y-1">
                  <OriginBadge origin={f.origin} />
                  <span className="min-w-0 flex-1 break-words">
                    <span className="font-mono break-all">{f.path}</span>
                    <span className="text-muted-foreground"> · {f.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Collapsible>
        )}

        {entry.evidence.length > 0 && (
          <Collapsible icon={BookOpen} summary={`Evidence (${pluralize(entry.evidence.length, 'source')})`}>
            <ul className="space-y-1.5">
              {entry.evidence.map((e, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge variant="outline">{e.sourceType.replace(/_/g, ' ')}</Badge>
                  {e.version && <span className="font-mono text-xs">{e.version}</span>}
                  <span className="text-xs text-muted-foreground">{e.retrievalStatus.replace(/_/g, ' ')}</span>
                  <SafeLink href={e.sourceUrl}>{e.sourceUrl}</SafeLink>
                </li>
              ))}
            </ul>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}
