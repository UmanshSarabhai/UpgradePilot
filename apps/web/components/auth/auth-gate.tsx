'use client';

import { Loader2 } from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { ErrorState } from '@/components/states';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/auth';
import { SignInScreen } from './sign-in-screen';

/** Shell used when there is no signed-in user: the header (without user controls) plus centred content. */
function Shell({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return (
    <>
      <SiteHeader minimal />
      <main
        className={`mx-auto w-full max-w-6xl flex-1 px-4 py-6 ${
          center
            ? 'flex items-start justify-center pt-10 sm:pt-20 bg-[radial-gradient(60rem_30rem_at_50%_-10%,var(--color-indigo-50),transparent)]'
            : ''
        }`}
      >
        {children}
      </main>
    </>
  );
}

/**
 * Wraps the whole app, header included. Signed in: renders children (the layout's own header and page).
 * Otherwise renders its own header plus a loading, error or sign-in view.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const me = useMe();

  if (me.isPending) {
    return (
      <Shell center>
        <div className="flex w-full max-w-sm flex-col items-center gap-5 pt-8" role="status" aria-busy="true" aria-label="Loading">
          <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
          <p className="text-sm text-muted-foreground">Checking your session</p>
          <div className="w-full space-y-3">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      </Shell>
    );
  }
  if (me.isError) {
    return (
      <Shell>
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      </Shell>
    );
  }
  if (me.data === null) {
    return (
      <Shell center>
        <SignInScreen />
      </Shell>
    );
  }
  return <>{children}</>;
}
