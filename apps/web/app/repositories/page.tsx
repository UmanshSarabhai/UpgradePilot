import { FolderGit2 } from 'lucide-react';
import { IconChip } from '@/components/icon-chip';
import { RepositoryList } from '@/components/repositories/repository-list';

export default function RepositoriesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <IconChip icon={FolderGit2} tone="indigo" size="lg" />
        <div className="space-y-0.5">
          <h1 className="text-xl font-semibold">Repositories</h1>
          <p className="text-sm text-muted-foreground">Every repository you have scanned, with the result of its latest scan.</p>
        </div>
      </div>
      <RepositoryList />
    </div>
  );
}
