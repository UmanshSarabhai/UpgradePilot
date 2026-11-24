import { RepositoryList } from '@/components/repositories/repository-list';

export default function RepositoriesPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Repositories</h1>
        <p className="text-sm text-muted-foreground">Every repository you have scanned, with the result of its latest scan.</p>
      </div>
      <RepositoryList />
    </div>
  );
}
