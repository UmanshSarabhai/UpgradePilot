import Link from 'next/link';

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
      </div>
    </header>
  );
}
