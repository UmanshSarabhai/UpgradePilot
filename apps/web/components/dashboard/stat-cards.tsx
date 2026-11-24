'use client';

import { ArrowUpCircle, FolderGit2, Package, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { IconChip } from '@/components/icon-chip';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboard } from '@/lib/queries';

export function StatCards() {
  const { data, isPending } = useDashboard();
  const totals = data?.totals;
  const stats = [
    { label: 'Repositories analysed', value: totals?.repositories, icon: FolderGit2, tone: 'indigo' as const },
    { label: 'Dependencies scanned', value: totals?.dependencies, icon: Package, tone: 'sky' as const },
    { label: 'Outdated', value: totals?.outdated, icon: ArrowUpCircle, tone: 'amber' as const },
    { label: 'High-risk upgrades', value: totals?.highRisk, icon: ShieldAlert, tone: 'red' as const },
  ];
  return (
    <section aria-label="Totals" className="space-y-2">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} size="sm" className="transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-3">
              <IconChip icon={stat.icon} tone={stat.tone} size="lg" />
              <div className="min-w-0">
                {isPending ? (
                  <Skeleton className="h-9 w-16" />
                ) : (
                  <p className="text-3xl font-semibold tabular-nums">{stat.value !== undefined ? stat.value.toLocaleString() : '-'}</p>
                )}
                <p className="text-sm text-muted-foreground">{stat.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Counts use the latest completed scan of each repository.</p>
    </section>
  );
}
