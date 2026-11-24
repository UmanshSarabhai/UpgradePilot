'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { RepositoryDetail } from '@/components/repositories/repository-detail';
import { LoadingRows } from '@/components/states';

function RepositoryContent() {
  const id = useSearchParams().get('id');
  return <RepositoryDetail id={id} />;
}

export default function RepositoryPage() {
  return (
    <Suspense fallback={<LoadingRows />}>
      <RepositoryContent />
    </Suspense>
  );
}
