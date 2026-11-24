'use client';

import { LOGIN_PATH, LOGOUT_PATH, ME_PATH, MeResponseSchema, type User } from '@upgradepilot/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, apiGet } from './api';

export const ME_KEY = ['me'] as const;

/** The signed-in user, or null when signed out (a 401 is not an error). */
export function useMe() {
  return useQuery<User | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return (await apiGet(ME_PATH, MeResponseSchema)).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      let response: Response;
      try {
        response = await fetch(LOGOUT_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
      } catch {
        throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the UpgradePilot API.');
      }
      if (!response.ok) throw new ApiError(response.status, 'UNKNOWN', `Sign out failed with status ${response.status}.`);
    },
    // A full page load to the root drops every cached query and lands on the sign-in screen. Clearing the
    // cache in place is not enough: `clear()` detaches the gate's observer, so it kept showing the app.
    onSuccess: () => {
      queryClient.setQueryData(ME_KEY, null);
      window.location.replace('/');
    },
  });
}

/** Login URL. Only same-site paths (one leading slash) are passed as returnTo. */
export function loginHref(returnTo?: string): string {
  if (returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
    return `${LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`;
  }
  return LOGIN_PATH;
}
