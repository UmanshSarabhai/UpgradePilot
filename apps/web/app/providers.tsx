'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthGate } from '@/components/auth/auth-gate';
import { ApiError } from '@/lib/api';
import { ME_KEY } from '@/lib/auth';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => {
    // An expired session shows up as a 401 on any request: drop to the sign-in screen.
    const onError = (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) client.setQueryData(ME_KEY, null);
    };
    const client: QueryClient = new QueryClient({
        queryCache: new QueryCache({ onError }),
        mutationCache: new MutationCache({ onError }),
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            // 4xx answers (not found, report not ready) will not change on retry.
            retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
          },
        },
      });
    return client;
  });
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider><AuthGate>{children}</AuthGate></TooltipProvider>
    </QueryClientProvider>
  );
}
