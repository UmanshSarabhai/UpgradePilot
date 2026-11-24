'use client';

import { AlertCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { loginHref } from '@/lib/auth';

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Sign-in was cancelled.',
  invalid_state: 'The sign-in link expired. Try again.',
  exchange_failed: 'Google sign-in failed. Try again.',
  unverified_email: "Your Google account's email address is not verified.",
  not_configured: 'Google sign-in is not set up on this server yet.',
};

export function SignInScreen() {
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('auth_error');
    if (code) setAuthError(AUTH_ERROR_MESSAGES[code] ?? 'Sign-in failed. Try again.');
  }, []);

  function signIn() {
    window.location.assign(loginHref(window.location.pathname + window.location.search));
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">UpgradePilot</CardTitle>
        <CardDescription>Scan public GitHub repositories and get a plan for upgrading their outdated dependencies.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {authError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{authError}</AlertDescription>
          </Alert>
        )}
        <Button className="w-full" onClick={signIn}>
          Sign in with Google
        </Button>
        <p className="text-xs text-muted-foreground">We only receive your name and email address from Google.</p>
      </CardContent>
    </Card>
  );
}
