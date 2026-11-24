'use client';

import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowLeft, GitBranch, Link2, Loader2, Play, Search, Star } from 'lucide-react';
import { GitHubIcon } from '@/components/brand';
import { SafeLink } from '@/components/safe-link';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiError } from '@/lib/api';
import { useCreateScan, useInspectRepository } from '@/lib/queries';

function errorMessage(error: unknown): string {
  return error instanceof ApiError || error instanceof Error ? error.message : 'Something went wrong.';
}

export function NewScanCard() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const inspect = useInspectRepository();
  const createScan = useCreateScan();
  const result = inspect.data;

  function onCheck(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || inspect.isPending) return;
    inspect.mutate(trimmed, {
      onSuccess: (data) => setBranch(data.repository.defaultBranch),
    });
  }

  function onStart() {
    if (!result || !branch) return;
    createScan.mutate(
      { url: result.repository.url, branch },
      { onSuccess: (scan) => router.push(`/scan/?id=${encodeURIComponent(scan.scanId)}`) },
    );
  }

  function onReset() {
    inspect.reset();
    createScan.reset();
    setBranch('');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitHubIcon className="size-5" />
          New scan
        </CardTitle>
        <CardDescription>Check a public GitHub repository, pick a branch, then scan its npm dependencies.</CardDescription>
      </CardHeader>
      <CardContent>
        {!result ? (
          <form onSubmit={onCheck} className="space-y-3" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="repo-url">GitHub repository URL</Label>
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                className="pl-9"
                id="repo-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://github.com/expressjs/express"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-invalid={inspect.isError}
                aria-describedby={inspect.isError ? 'repo-url-error' : undefined}
              />
              </div>
              {inspect.isError && (
                <p id="repo-url-error" role="alert" className="text-sm text-destructive">
                  {errorMessage(inspect.error)}
                </p>
              )}
            </div>
            <Button type="submit" disabled={inspect.isPending || !url.trim()}>
              {inspect.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Search aria-hidden />}
              {inspect.isPending ? 'Checking repository...' : 'Check repository'}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3">
              <SafeLink href={result.repository.url} className="font-medium">
                {result.repository.fullName}
              </SafeLink>
              {result.repository.description && <p className="text-sm text-muted-foreground">{result.repository.description}</p>}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-indigo-500" aria-hidden />
                  {result.repository.primaryLanguage ?? 'Language unknown'}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Star className="size-3.5" aria-hidden />
                  {result.repository.stars.toLocaleString()} stars
                </span>
              </div>
              {result.repository.archived && (
                <p className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                  <AlertTriangle className="size-3.5" aria-hidden />
                  archived
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="branch-select">
                <GitBranch className="size-3.5 text-muted-foreground" aria-hidden />
                Branch
              </Label>
              <Select value={branch} onValueChange={setBranch} disabled={createScan.isPending}>
                <SelectTrigger id="branch-select" className="w-full">
                  <SelectValue placeholder="Select a branch" />
                </SelectTrigger>
                <SelectContent>
                  {result.branches.map((b) => (
                    <SelectItem key={b.name} value={b.name}>
                      {b.name}
                      {b.isDefault ? ' (default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {result.branchesTruncated && (
                <p className="text-xs text-muted-foreground">Only the first 100 branches are listed.</p>
              )}
            </div>

            {createScan.isError && (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage(createScan.error)}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={onStart} disabled={createScan.isPending || !branch}>
                {createScan.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Play aria-hidden />}
                {createScan.isPending ? 'Starting scan...' : 'Start scan'}
              </Button>
              <Button variant="ghost" onClick={onReset} disabled={createScan.isPending}>
                <ArrowLeft aria-hidden />
                Change repository
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
