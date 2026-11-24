'use client';

import { FolderGit2, LayoutDashboard, Loader2, LogOut } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BrandMark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { useLogout, useMe } from '@/lib/auth';
import { cn } from '@/lib/utils';

function initialsOf(label: string): string {
  const parts = label.split(/[\s@.]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : label.slice(0, 2);
  return letters.toUpperCase();
}

type Section = 'dashboard' | 'repositories' | null;

function sectionOf(pathname: string | null): Section {
  if (!pathname) return null;
  if (pathname === '/' || pathname === '') return 'dashboard';
  if (pathname.startsWith('/repositories') || pathname.startsWith('/repository')) return 'repositories';
  return null;
}

function NavLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: LucideIcon; active: boolean }) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      <Icon className="size-4" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
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
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200"
        aria-hidden
      >
        {initialsOf(label)}
      </span>
      <span className="hidden min-w-0 max-w-48 flex-col leading-tight sm:flex">
        <span className="truncate text-sm font-medium">{label}</span>
        {user.name && <span className="truncate text-xs text-muted-foreground">{user.email}</span>}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        aria-label="Sign out"
      >
        {logout.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
        <span className="hidden sm:inline">{logout.isPending ? 'Signing out' : 'Sign out'}</span>
      </Button>
    </div>
  );
}

/** `minimal` shows only the brand (used when signed out). */
export function SiteHeader({ minimal = false }: { minimal?: boolean }) {
  const section = sectionOf(usePathname());
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:gap-6">
        <Link
          href="/"
          aria-label="UpgradePilot home"
          className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <BrandMark />
        </Link>
        {!minimal && (
          <nav aria-label="Main" className="flex items-center gap-1">
            <NavLink href="/" label="Dashboard" icon={LayoutDashboard} active={section === 'dashboard'} />
            <NavLink href="/repositories/" label="Repositories" icon={FolderGit2} active={section === 'repositories'} />
          </nav>
        )}
        {!minimal && <UserMenu />}
      </div>
    </header>
  );
}
