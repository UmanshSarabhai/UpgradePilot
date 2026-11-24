import type { AnalysisStatus, FindingOrigin, Recommendation, RiskLevel, ScanStatus, UpgradeType } from '@upgradepilot/shared';
import { Badge } from '@/components/ui/badge';
import { SCAN_STATUS_LABEL } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Colour by meaning, shared across the app. Text always states the value, colour only reinforces it. */
const tone = {
  red: 'bg-red-50 text-red-700 border-red-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue: 'bg-sky-50 text-sky-700 border-sky-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  gray: 'bg-muted text-muted-foreground border-border',
} as const;

function ToneBadge({ color, children, className }: { color: keyof typeof tone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn('font-medium', tone[color], className)}>
      {children}
    </Badge>
  );
}

export function UpgradeTypeBadge({ type }: { type: UpgradeType | null }) {
  if (!type) return <ToneBadge color="gray">pending</ToneBadge>;
  const color = { major: 'red', minor: 'amber', patch: 'blue', up_to_date: 'green', unresolved: 'gray' } as const;
  return <ToneBadge color={color[type]}>{type === 'up_to_date' ? 'up to date' : type}</ToneBadge>;
}

export function RiskBadge({ level }: { level: RiskLevel | null }) {
  if (!level) return <span className="text-muted-foreground">-</span>;
  const color = { high: 'red', medium: 'amber', low: 'green', unknown: 'gray' } as const;
  return <ToneBadge color={color[level]}>{level} risk</ToneBadge>;
}

export function RecommendationBadge({ recommendation }: { recommendation: Recommendation | null }) {
  if (!recommendation) return <span className="text-muted-foreground">-</span>;
  const color = { upgrade: 'green', investigate: 'amber', defer: 'gray' } as const;
  return <ToneBadge color={color[recommendation]}>{recommendation}</ToneBadge>;
}

export function ScanStatusBadge({ status }: { status: ScanStatus }) {
  const color = status === 'COMPLETED' ? 'green' : status === 'FAILED' ? 'red' : 'blue';
  return <ToneBadge color={color}>{SCAN_STATUS_LABEL[status]}</ToneBadge>;
}

/** Marks where a finding came from: rule-based, AI with a cited source, or an AI claim we could not verify. */
export function OriginBadge({ origin }: { origin: FindingOrigin }) {
  if (origin === 'deterministic') return <ToneBadge color="gray">rule</ToneBadge>;
  if (origin === 'ai') return <ToneBadge color="violet">AI</ToneBadge>;
  return <ToneBadge color="amber">unverified AI claim</ToneBadge>;
}

export function AnalysisStatusBadge({ status }: { status: AnalysisStatus | null }) {
  if (!status) return null;
  const label: Record<AnalysisStatus, string> = {
    pending: 'AI pending',
    pending_force: 'AI pending',
    completed: 'AI analysed',
    not_needed: 'AI not needed',
    skipped: 'AI skipped',
    insufficient_evidence: 'No release text',
    failed: 'AI failed',
  };
  const color = status === 'completed' ? 'violet' : status === 'failed' ? 'red' : 'gray';
  return <ToneBadge color={color}>{label[status]}</ToneBadge>;
}
