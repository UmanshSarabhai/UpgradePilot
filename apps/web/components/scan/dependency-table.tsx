'use client';

import {
  DependencyTypeSchema,
  RecommendationSchema,
  RiskLevelSchema,
  UpgradeTypeSchema,
  type DependencyListQuery,
  type DependencyRow,
} from '@upgradepilot/shared';
import { useEffect, useState } from 'react';
import { RecommendationBadge, RiskBadge, UpgradeTypeBadge } from '@/components/badges';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DEPENDENCY_TYPE_LABEL, UNRESOLVED_REASON_LABEL } from '@/lib/format';
import { useDependencies } from '@/lib/queries';
import { DependencySheet } from './dependency-sheet';

const PAGE_SIZE = 50;
const ALL = 'all';

type Filters = {
  q: string;
  upgradeType: string;
  riskLevel: string;
  dependencyType: string;
  recommendation: string;
  sort: NonNullable<DependencyListQuery['sort']>;
};

const DEFAULT_FILTERS: Filters = { q: '', upgradeType: ALL, riskLevel: ALL, dependencyType: ALL, recommendation: ALL, sort: 'name' };

const SORT_OPTIONS: { value: Filters['sort']; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'upgradeType', label: 'Upgrade type' },
  { value: 'riskLevel', label: 'Risk' },
];

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const withAll = (values: readonly string[], label?: (v: string) => string) => [
  { value: ALL, label: 'All' },
  ...values.map((v) => ({ value: v, label: label ? label(v) : v.replace('_', ' ') })),
];

function pick<T>(value: string): T | undefined {
  return value === ALL ? undefined : (value as T);
}

function CurrentVersion({ row }: { row: DependencyRow }) {
  if (row.currentVersion) return <span className="font-mono">{row.currentVersion}</span>;
  const reason = row.unresolvedReason ? UNRESOLVED_REASON_LABEL[row.unresolvedReason] : 'Installed version could not be determined';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help text-muted-foreground underline decoration-dotted underline-offset-2">unresolved</span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export function DependencyTable({ scanId, active, completed }: { scanId: string; active: boolean; completed: boolean }) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [debouncedQ, setDebouncedQ] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const next = filters.q.trim();
    if (next === debouncedQ) return;
    const timer = setTimeout(() => {
      setDebouncedQ(next);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.q, debouncedQ]);

  const update = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const query: Partial<DependencyListQuery> = {
    page,
    pageSize: PAGE_SIZE,
    sort: filters.sort,
    q: debouncedQ || undefined,
    upgradeType: pick(filters.upgradeType),
    riskLevel: pick(filters.riskLevel),
    dependencyType: pick(filters.dependencyType),
    recommendation: pick(filters.recommendation),
  };
  const list = useDependencies(scanId, query, { poll: active });

  const filtered =
    debouncedQ !== '' ||
    filters.upgradeType !== ALL ||
    filters.riskLevel !== ALL ||
    filters.dependencyType !== ALL ||
    filters.recommendation !== ALL;
  const clear = () => {
    setFilters(DEFAULT_FILTERS);
    setDebouncedQ('');
    setPage(1);
  };

  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="dep-search" className="text-xs text-muted-foreground">
            Search packages
          </Label>
          <Input
            id="dep-search"
            type="search"
            placeholder="Package name"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          />
        </div>
        <FilterSelect
          label="Upgrade type"
          value={filters.upgradeType}
          onChange={(v) => update({ upgradeType: v })}
          options={withAll(UpgradeTypeSchema.options)}
        />
        <FilterSelect
          label="Risk level"
          value={filters.riskLevel}
          onChange={(v) => update({ riskLevel: v })}
          options={withAll(RiskLevelSchema.options)}
        />
        <FilterSelect
          label="Dependency type"
          value={filters.dependencyType}
          onChange={(v) => update({ dependencyType: v })}
          options={withAll(DependencyTypeSchema.options, (v) => DEPENDENCY_TYPE_LABEL[v as keyof typeof DEPENDENCY_TYPE_LABEL])}
        />
        <FilterSelect
          label="Recommendation"
          value={filters.recommendation}
          onChange={(v) => update({ recommendation: v })}
          options={withAll(RecommendationSchema.options)}
        />
        <FilterSelect
          label="Sort by"
          value={filters.sort}
          onChange={(v) => update({ sort: v as Filters['sort'] })}
          options={SORT_OPTIONS}
        />
      </div>

      {list.isPending ? (
        <LoadingRows rows={8} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No dependencies match these filters"
            action={
              <Button variant="outline" size="sm" onClick={clear}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={active ? 'No dependencies yet' : 'No dependencies found'}
            description={active ? 'Rows appear here as the scan discovers them.' : 'This scan did not find any npm dependencies.'}
          />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Package</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Latest</TableHead>
                  <TableHead>Upgrade</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Recommendation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((row) => (
                  <TableRow
                    key={row.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open details for ${row.name}`}
                    className="cursor-pointer focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() => setSelectedId(row.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedId(row.id);
                      }
                    }}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{row.name}</span>
                        {row.isDeprecated && (
                          <span className="rounded border border-amber-200 bg-amber-50 px-1 text-xs text-amber-800">deprecated</span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.manifestPath}
                        {row.registryName && row.registryName !== row.name && (
                          <>
                            {' · alias of '}
                            <span className="font-mono">{row.registryName}</span>
                          </>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <CurrentVersion row={row} />
                    </TableCell>
                    <TableCell className="font-mono">{row.latestVersion ?? <span className="text-muted-foreground">-</span>}</TableCell>
                    <TableCell>
                      <UpgradeTypeBadge type={row.upgradeType} />
                    </TableCell>
                    <TableCell>
                      <RiskBadge level={row.riskLevel} />
                    </TableCell>
                    <TableCell>
                      <RecommendationBadge recommendation={row.recommendation} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground" aria-live="polite">
              Page {page} of {pageCount} · {total} dependencies
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      <DependencySheet scanId={scanId} dependencyId={selectedId} completed={completed} onClose={() => setSelectedId(null)} />
    </div>
  );
}
