'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ReportView } from '@/components/report/report-view';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError } from '@/lib/api';
import { isActiveStatus, useScan } from '@/lib/queries';
import { DependencyTable } from './dependency-table';
import { ScanHeader } from './scan-header';
import { CompletedSummary, DiscoverySummary } from './scan-summary';

function BackToDashboard() {
  return (
    <Button asChild variant="outline" size="sm">
      <Link href="/">Back to dashboard</Link>
    </Button>
  );
}

export function ScanView() {
  const id = useSearchParams().get('id');
  const scan = useScan(id);
  const [tab, setTab] = useState('dependencies');

  if (!id) {
    return <EmptyState title="No scan selected" description="Open a scan from the dashboard." action={<BackToDashboard />} />;
  }
  if (scan.isPending) return <LoadingRows rows={6} />;
  if (scan.isError) {
    if (scan.error instanceof ApiError && scan.error.status === 404) {
      return <EmptyState title="Scan not found" description="It may have been removed, or the link is wrong." action={<BackToDashboard />} />;
    }
    return <ErrorState error={scan.error} onRetry={() => void scan.refetch()} />;
  }

  const data = scan.data;
  const active = isActiveStatus(data.status);
  const completed = data.status === 'COMPLETED';

  return (
    <div className="space-y-6">
      <ScanHeader scan={data} />
      {completed && <CompletedSummary scanId={id} />}
      {active && <DiscoverySummary scan={data} />}

      <Tabs value={completed ? tab : 'dependencies'} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
          <TabsTrigger value="report" disabled={!completed}>
            Report
          </TabsTrigger>
        </TabsList>
        <TabsContent value="dependencies" className="pt-4">
          <DependencyTable scanId={id} active={active} completed={completed} />
        </TabsContent>
        <TabsContent value="report" className="pt-4">
          <ReportView scanId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
