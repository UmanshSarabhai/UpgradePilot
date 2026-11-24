'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useLogout, useMe } from '@/lib/auth';

function initialsOf(label: string): string {
  const parts = label.split(/[\s@.]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : label.slice(0, 2);
  return letters.toUpperCase();
}

function UserMenu() {
  const me = useMe();
  const logout = useLogout();
  const user = me.data;
  if (!user) return null;
  const label = user.name || user.email;
  return (
    <div className="ml-auto flex items-center gap-2">
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium"
        aria-hidden
      >
        {initialsOf(label)}
      </span>
      <span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:inline">{label}</span>
      <Button variant="outline" size="sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
        Sign out
      </Button>
    </div>
  );
}

export function SiteHeader() {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="font-semibold tracking-tight">
          UpgradePilot
        </Link>
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Dashboard
          </Link>
          <Link href="/repositories/" className="hover:text-foreground">
            Repositories
          </Link>
        </nav>
        <UserMenu />
      </div>
    </header>
  );
}
