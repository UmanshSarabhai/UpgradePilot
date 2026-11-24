'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboard } from '@/lib/queries';

export function StatCards() {
  const { data, isPending } = useDashboard();
  const totals = data?.totals;
  const stats = [
    { label: 'Repositories analysed', value: totals?.repositories },
    { label: 'Dependencies scanned', value: totals?.dependencies },
    { label: 'Outdated', value: totals?.outdated },
    { label: 'High-risk upgrades', value: totals?.highRisk },
  ];
  return (
    <section aria-label="Totals" className="space-y-2">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
            </CardHeader>
            <CardContent>
              {isPending ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <p className="text-2xl font-semibold tabular-nums">{stat.value !== undefined ? stat.value.toLocaleString() : '-'}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Counts use the latest completed scan of each repository.</p>
    </section>
  );
}
