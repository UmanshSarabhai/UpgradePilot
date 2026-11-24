'use client';

import type { AffectedFile, Advisory, DependencyDetail, Finding, FindingOrigin } from '@upgradepilot/shared';
import { BookOpen, Bug, Layers, RefreshCw, ArrowUpCircle, ShieldAlert, ShieldCheck, Sparkles, Loader2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { IconChip, type IconTone } from '@/components/icon-chip';
import type { LucideIcon } from 'lucide-react';
import { AnalysisStatusBadge, OriginBadge, RecommendationBadge, RiskBadge, UpgradeTypeBadge } from '@/components/badges';
import { ErrorState, LoadingRows } from '@/components/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { UNRESOLVED_REASON_LABEL } from '@/lib/format';
import { useDependencyDetail, useReanalyze } from '@/lib/queries';
import { SafeLink, isHttpUrl } from '@/components/safe-link';

const mono = (value: string | null | undefined) =>
  value ? <span className="font-mono">{value}</span> : <span className="text-muted-foreground">-</span>;

function Section({ title, icon, tone, children }: { title: string; icon?: LucideIcon; tone?: IconTone; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {icon && <IconChip icon={icon} tone={tone} size="sm" />}
        {title}
      </h3>
      {children}
    </section>
  );
}

/** One AI or rule finding. Unverified claims are marked and never linked. */
function FindingItem({ text, origin, sourceUrl }: { text: string; origin: FindingOrigin; sourceUrl: string | null }) {
  const unverified = origin === 'unverified';
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-start gap-2">
        <OriginBadge origin={origin} />
        <span className={unverified ? 'min-w-0 flex-1 italic text-muted-foreground' : 'min-w-0 flex-1'}>{text}</span>
      </div>
      {!unverified && isHttpUrl(sourceUrl) && (
        <SafeLink href={sourceUrl} className="text-xs">
          Source
        </SafeLink>
      )}
      {unverified && <p className="text-xs text-amber-800">The cited source was not in the evidence given to the model.</p>}
    </div>
  );
}

function FindingList({ title, items, ordered }: { title: string; items: Finding[]; ordered?: boolean }) {
  if (items.length === 0) return null;
  const List = ordered ? 'ol' : 'ul';
  return (
    <Section title={title}>
      <List className={ordered ? 'list-decimal space-y-2 pl-5 text-sm' : 'space-y-2 text-sm'}>
        {items.map((item, i) => (
          <li key={i}>
            <FindingItem text={item.text} origin={item.origin} sourceUrl={item.sourceUrl} />
          </li>
        ))}
      </List>
    </Section>
  );
}

function AffectedFiles({ files }: { files: AffectedFile[] }) {
  if (files.length === 0) return null;
  return (
    <Section title="Potentially affected files">
      <ul className="space-y-2 text-sm">
        {files.map((f, i) => (
          <li key={i} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <OriginBadge origin={f.origin} />
              <span className="break-all font-mono text-xs">{f.path}</span>
            </div>
            <p className={f.origin === 'unverified' ? 'italic text-muted-foreground' : 'text-muted-foreground'}>{f.reason}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Advisories({ advisories }: { advisories: Advisory[] | null }) {
  if (advisories === null) {
    return (
      <Section title="Security advisories" icon={ShieldCheck} tone="emerald">
        <p className="text-sm text-muted-foreground">Advisories could not be checked for this package.</p>
      </Section>
    );
  }
  if (advisories.length === 0) return null;
  return (
    <Section title="Security advisories" icon={Bug} tone="amber">
      <ul className="space-y-2 text-sm">
        {advisories.map((a) => (
          <li key={a.id} className="space-y-1 rounded-md border p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={a.severity === 'critical' || a.severity === 'high' ? 'border-red-200 bg-red-50 text-red-700' : ''}>
                {a.severity}
              </Badge>
              <span className="font-medium">{a.title}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Vulnerable range <span className="font-mono">{a.vulnerableVersions}</span>
            </p>
            <SafeLink href={a.url} className="text-xs">
              Advisory
            </SafeLink>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Reanalyze({ scanId, dependencyId }: { scanId: string; dependencyId: string }) {
  const [force, setForce] = useState(false);
  const mutation = useReanalyze(scanId);
  return (
    <section className="space-y-3 rounded-xl border bg-muted/30 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <IconChip icon={RefreshCw} tone="indigo" size="sm" />
        Re-analyse
      </h3>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Checkbox id="reanalyze-force" checked={force} onCheckedChange={(v) => setForce(v === true)} />
          <Label htmlFor="reanalyze-force" className="text-sm font-normal">
            Ignore cached result
          </Label>
        </div>
        <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ dependencyIds: [dependencyId], force })}>
          {mutation.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
          {mutation.isPending ? 'Queuing...' : 'Re-run analysis'}
        </Button>
      </div>
      {mutation.isError && (
        <Alert variant="destructive">
          <AlertDescription>{mutation.error.message}</AlertDescription>
        </Alert>
      )}
      {mutation.isSuccess && (
        <p className="text-sm text-muted-foreground" role="status">
          Analysis queued. This page will update as the scan runs again.
        </p>
      )}
    </section>
  );
}

function Body({ data, scanId, completed }: { data: DependencyDetail; scanId: string; completed: boolean }) {
  const { dependency: dep, riskDetails, advisories, analysis, analysisNote, evidence } = data;
  const canReanalyze = completed && (dep.upgradeType === 'patch' || dep.upgradeType === 'minor' || dep.upgradeType === 'major');
  const reasons = riskDetails?.reasons ?? [];
  const factors = riskDetails?.factors ?? [];

  return (
    <div className="space-y-5">
      <Section title="Versions" icon={Layers} tone="slate">
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div className="min-w-0 rounded-md border bg-muted/30 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Declared range</dt>
            <dd className="break-words">{mono(dep.declaredRange)}</dd>
          </div>
          <div className="min-w-0 rounded-md border bg-muted/30 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Installed</dt>
            <dd className="break-words">
            {dep.currentVersion ? (
              <>
                {mono(dep.currentVersion)}
                {dep.currentVersionSource && <span className="text-muted-foreground"> from {dep.currentVersionSource}</span>}
              </>
            ) : (
              <span className="text-muted-foreground">
                unresolved{dep.unresolvedReason ? `: ${UNRESOLVED_REASON_LABEL[dep.unresolvedReason]}` : ''}
              </span>
            )}
          </dd>
          </div>
          <div className="min-w-0 rounded-md border bg-muted/30 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Latest</dt>
            <dd className="break-words">{mono(dep.latestVersion)}</dd>
          </div>
          <div className="min-w-0 rounded-md border bg-muted/30 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Latest in range</dt>
            <dd className="break-words">{mono(dep.latestInRangeVersion)}</dd>
          </div>
          <div className="min-w-0 rounded-md border bg-muted/30 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Latest compatible</dt>
            <dd className="break-words">{mono(dep.latestCompatibleVersion)}</dd>
          </div>
          <div className="min-w-0 rounded-md border bg-muted/30 px-3 py-2">
            <dt className="text-xs text-muted-foreground">Target</dt>
            <dd className="break-words">{mono(dep.targetVersion)}</dd>
          </div>
        </dl>
        {dep.isDeprecated && (
          <Alert>
            <TriangleAlert aria-hidden />
            <AlertDescription>Deprecated{dep.deprecationMessage ? `: ${dep.deprecationMessage}` : '.'}</AlertDescription>
          </Alert>
        )}
        {dep.registryError && (
          <p className="text-sm text-muted-foreground">
            Registry error: <span className="font-mono">{dep.registryError}</span>
          </p>
        )}
      </Section>

      {reasons.length > 0 && (
        <Section title="Why update" icon={ArrowUpCircle} tone="emerald">
          <ul className="space-y-2 text-sm">
            {reasons.map((r, i) => (
              <li key={i} className="space-y-1">
                <p>{r.message}</p>
                <SafeLink href={r.sourceUrl} className="text-xs">
                  Source
                </SafeLink>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {factors.length > 0 && (
        <Section title="What could break" icon={ShieldAlert} tone="red">
          <ul className="space-y-2 text-sm">
            {factors.map((f, i) => (
              <li key={i}>
                <FindingItem text={`${f.message} (${f.level})`} origin={f.origin} sourceUrl={f.sourceUrl} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Advisories advisories={advisories} />

      <Separator />

      <Section title="AI analysis" icon={Sparkles} tone="violet">
        {analysis ? (
          <div className="space-y-4">
            <div className="space-y-1.5 text-xs text-muted-foreground">
              <p className="font-mono">
                {analysis.provider} / {analysis.model}
              </p>
              <div className="flex items-center gap-3">
                <span>Confidence</span>
                <Progress value={Math.round(analysis.confidence * 100)} aria-label="AI confidence" className="max-w-40" />
                <span className="font-mono text-foreground">{Math.round(analysis.confidence * 100)}%</span>
              </div>
            </div>
            {analysis.inconclusive && (
              <Alert>
                <AlertDescription>Inconclusive. The model said the evidence was not enough to judge this upgrade.</AlertDescription>
              </Alert>
            )}
            <p className="text-sm">{analysis.summary}</p>
            <FindingList title="Breaking changes" items={analysis.breakingChanges} />
            <FindingList title="Deprecated features" items={analysis.deprecatedFeatures} />
            <FindingList title="Migration steps" items={analysis.migrationSteps} ordered />
            <FindingList title="Compatibility concerns" items={analysis.compatibilityConcerns} />
            <AffectedFiles files={analysis.potentiallyAffectedFiles} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{analysisNote ?? 'No AI analysis for this dependency.'}</p>
        )}
      </Section>

      {evidence.length > 0 && (
        <Section title="Evidence" icon={BookOpen} tone="sky">
          <ul className="space-y-3 text-sm">
            {evidence.map((e, i) => (
              <li key={i} className="space-y-1 rounded-md border p-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{e.sourceType.replace(/_/g, ' ')}</span>
                  {e.version && <span className="font-mono text-xs">{e.version}</span>}
                  <Badge variant="outline">{e.retrievalStatus.replace(/_/g, ' ')}</Badge>
                </div>
                <div className="break-all text-xs">
                  {isHttpUrl(e.sourceUrl) ? (
                    <SafeLink href={e.sourceUrl}>{e.sourceUrl}</SafeLink>
                  ) : (
                    <span className="text-muted-foreground">{e.sourceUrl}</span>
                  )}
                </div>
                {e.excerpt && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Show excerpt</summary>
                    <p className="mt-1 text-muted-foreground">Third-party text, shown as written</p>
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono">{e.excerpt}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {canReanalyze && <Reanalyze key={dep.id} scanId={scanId} dependencyId={dep.id} />}
    </div>
  );
}

export function DependencySheet({
  scanId,
  dependencyId,
  completed,
  onClose,
}: {
  scanId: string;
  dependencyId: string | null;
  completed: boolean;
  onClose: () => void;
}) {
  const detail = useDependencyDetail(scanId, dependencyId);
  const dep = detail.data?.dependency;
  return (
    <Sheet open={dependencyId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="break-all">{dep?.name ?? 'Dependency details'}</SheetTitle>
          <SheetDescription className="font-mono">
            {dep ? `${dep.currentVersion ?? 'unresolved'} → ${dep.targetVersion ?? dep.latestVersion ?? 'none'}` : 'Loading'}
          </SheetDescription>
          {dep && (
            <div className="flex flex-wrap gap-2 pt-1">
              <UpgradeTypeBadge type={dep.upgradeType} />
              <RiskBadge level={dep.riskLevel} />
              <RecommendationBadge recommendation={dep.recommendation} />
              <AnalysisStatusBadge status={dep.analysisStatus} />
            </div>
          )}
        </SheetHeader>
        <div className="px-4 pb-6">
          {detail.isPending ? (
            <LoadingRows rows={6} />
          ) : detail.isError ? (
            <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
          ) : (
            <Body data={detail.data} scanId={scanId} completed={completed} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
