import { NewScanCard } from '@/components/dashboard/new-scan-card';
import { RecentScansCard } from '@/components/dashboard/recent-scans-card';
import { StatCards } from '@/components/dashboard/stat-cards';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          UpgradePilot scans the npm dependencies of a public GitHub repository and reports outdated packages, upgrade risks and a plan.
        </p>
      </div>
      <StatCards />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="min-w-0 lg:col-span-2">
          <NewScanCard />
        </div>
        <div className="min-w-0 lg:col-span-3">
          <RecentScansCard />
        </div>
      </div>
    </div>
  );
}
