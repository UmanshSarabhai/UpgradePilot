'use client';

import { AlertCircle, ListChecks, Lock, Package, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BrandMark, GoogleIcon } from '@/components/brand';
import { IconChip, type IconTone } from '@/components/icon-chip';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { loginHref } from '@/lib/auth';

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: 'Sign-in was cancelled.',
  invalid_state: 'The sign-in link expired. Try again.',
  exchange_failed: 'Google sign-in failed. Try again.',
  unverified_email: "Your Google account's email address is not verified.",
  not_configured: 'Google sign-in is not set up on this server yet.',
};

const FEATURES: { icon: typeof Package; tone: IconTone; title: string; text: string }[] = [
  { icon: Package, tone: 'sky', title: 'Lockfile-aware checks', text: 'Compares the versions you actually have installed with the latest releases.' },
  { icon: Sparkles, tone: 'violet', title: 'Rules plus cited AI analysis', text: 'Risk ratings come from rules, with AI notes that link to their sources.' },
  { icon: ListChecks, tone: 'emerald', title: 'An ordered upgrade plan', text: 'Work through the upgrades in a safe order, then export the plan.' },
];

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
    <div className="w-full max-w-3xl overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm md:grid md:grid-cols-2">
      <div className="hidden flex-col gap-6 border-r bg-gradient-to-b from-indigo-50/70 to-transparent p-8 md:flex">
        <BrandMark />
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">Know what is safe to upgrade</h2>
          <p className="text-sm text-muted-foreground">
            Scan a public GitHub repository and get a risk-rated plan for its outdated npm dependencies.
          </p>
        </div>
        <ul className="space-y-4">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex items-start gap-3">
              <IconChip icon={f.icon} tone={f.tone} />
              <div className="min-w-0">
                <p className="text-sm font-medium">{f.title}</p>
                <p className="text-sm text-muted-foreground">{f.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col justify-center gap-5 p-6 sm:p-8">
        <BrandMark className="md:hidden" />
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">Use your Google account to scan repositories and keep your upgrade plans.</p>
        </div>
        {authError && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden />
            <AlertDescription>{authError}</AlertDescription>
          </Alert>
        )}
        <Button
          variant="outline"
          size="lg"
          className="w-full border-border bg-white font-medium text-slate-800 hover:bg-muted/40 hover:text-slate-900"
          onClick={signIn}
        >
          <GoogleIcon />
          Continue with Google
        </Button>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          We only receive your name and email address from Google.
        </p>
      </div>
    </div>
  );
}
