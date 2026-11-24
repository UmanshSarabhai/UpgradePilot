import { Suspense } from 'react';
import { LoadingRows } from '@/components/states';
import { ScanView } from '@/components/scan/scan-view';

export default function ScanPage() {
  return (
    <Suspense fallback={<LoadingRows rows={6} />}>
      <ScanView />
    </Suspense>
  );
}
