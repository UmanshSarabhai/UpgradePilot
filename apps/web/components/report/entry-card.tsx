import type { Finding, ReportEntry } from '@upgradepilot/shared';
import { OriginBadge, RecommendationBadge, RiskBadge, UpgradeTypeBadge } from '@/components/badges';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { pluralize } from '@/lib/format';
import { SafeLink, isHttpUrl } from '@/components/safe-link';

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h4 className="text-sm font-semibold">{children}</h4>;
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

function Collapsible({ summary, children, open }: { summary: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-md border px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">{summary}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

export function EntryCard({ entry }: { entry: ReportEntry }) {
  const { analysis } = entry;
  return (
    <Card>
      <CardHeader className="gap-2">
        <CardTitle className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-mono break-all">{entry.packageName}</span>
          <span className="font-mono text-sm font-normal text-muted-foreground">
            {entry.currentVersion} → {entry.targetVersion}
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
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
            <span className="font-medium">Deprecated:</span> {entry.deprecation}
          </p>
        )}

        {entry.advisoriesFixed.length > 0 && (
          <section className="space-y-1.5">
            <SubHeading>Advisories fixed</SubHeading>
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
            <SubHeading>Why update</SubHeading>
            <FindingList items={entry.reasons} />
          </section>
        )}

        {entry.risks.length > 0 && (
          <section className="space-y-1.5">
            <SubHeading>What could break</SubHeading>
            <FindingList items={entry.risks} />
          </section>
        )}

        <section className="space-y-1.5">
          <SubHeading>AI summary</SubHeading>
          {analysis ? (
            <div className="space-y-2">
              <p className="break-words">{analysis.summary}</p>
              <p className="text-xs text-muted-foreground">
                Confidence {Math.round(analysis.confidence * 100)}% · <span className="font-mono">{analysis.provider}/{analysis.model}</span>
              </p>
              {analysis.inconclusive && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
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
            <SubHeading>Deprecated features</SubHeading>
            <FindingList items={analysis.deprecatedFeatures} />
          </section>
        )}

        {analysis && analysis.migrationSteps.length > 0 && (
          <section className="space-y-1.5">
            <SubHeading>Migration steps</SubHeading>
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
          <Collapsible summary={`Potentially affected files (${analysis.potentiallyAffectedFiles.length})`}>
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
          <Collapsible summary={`Evidence (${pluralize(entry.evidence.length, 'source')})`}>
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
