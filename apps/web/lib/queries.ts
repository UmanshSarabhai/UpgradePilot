'use client';

import {
  type CreateScanRequest,
  CreateScanResponseSchema,
  DashboardResponseSchema,
  DependencyDetailSchema,
  type DependencyListQuery,
  DependencyListResponseSchema,
  InspectRepositoryResponseSchema,
  type ReanalyzeRequest,
  ReportSchema,
  RepositoryListResponseSchema,
  ScanHistoryResponseSchema,
  ScanSchema,
  type ScanStatus,
} from '@upgradepilot/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiGet, apiPost, toQuery } from './api';

/** How often to poll a scan that is still running. */
export const POLL_MS = 2000;

export function isActiveStatus(status: ScanStatus | undefined): boolean {
  return status !== undefined && status !== 'COMPLETED' && status !== 'FAILED';
}

export const queryKeys = {
  dashboard: ['dashboard'] as const,
  repositories: (page: number) => ['repositories', page] as const,
  history: (repositoryId: string, page: number) => ['history', repositoryId, page] as const,
  scan: (scanId: string) => ['scan', scanId] as const,
  dependencies: (scanId: string, query: Partial<DependencyListQuery>) => ['dependencies', scanId, query] as const,
  dependency: (scanId: string, dependencyId: string) => ['dependency', scanId, dependencyId] as const,
  report: (scanId: string) => ['report', scanId] as const,
};

export function useDashboard() {
  return useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: () => apiGet('/api/dashboard', DashboardResponseSchema),
    // Keep "recent scans" progress fresh while any of them is running.
    refetchInterval: (query) => (query.state.data?.recentScans.some((s) => isActiveStatus(s.status)) ? POLL_MS : false),
  });
}

export function useRepositories(page: number) {
  return useQuery({
    queryKey: queryKeys.repositories(page),
    queryFn: () => apiGet(`/api/repositories${toQuery({ page, pageSize: 20 })}`, RepositoryListResponseSchema),
    placeholderData: keepPreviousData,
  });
}

export function useScanHistory(repositoryId: string | null, page: number) {
  return useQuery({
    queryKey: queryKeys.history(repositoryId ?? '', page),
    queryFn: () =>
      apiGet(`/api/repositories/${encodeURIComponent(repositoryId ?? '')}/scans${toQuery({ page, pageSize: 20 })}`, ScanHistoryResponseSchema),
    enabled: !!repositoryId,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (query.state.data?.items.some((s) => isActiveStatus(s.status)) ? POLL_MS : false),
  });
}

/** Polls every POLL_MS while the scan is running. */
export function useScan(scanId: string | null) {
  return useQuery({
    queryKey: queryKeys.scan(scanId ?? ''),
    queryFn: () => apiGet(`/api/scans/${encodeURIComponent(scanId ?? '')}`, ScanSchema),
    enabled: !!scanId,
    refetchInterval: (query) => (isActiveStatus(query.state.data?.status) ? POLL_MS : false),
  });
}

/** Pass `poll: true` while the scan is running so rows fill in as stages complete. */
export function useDependencies(scanId: string | null, query: Partial<DependencyListQuery>, options: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.dependencies(scanId ?? '', query),
    queryFn: () =>
      apiGet(
        `/api/scans/${encodeURIComponent(scanId ?? '')}/dependencies${toQuery({ ...query })}`,
        DependencyListResponseSchema,
      ),
    enabled: !!scanId,
    placeholderData: keepPreviousData,
    refetchInterval: options.poll ? POLL_MS : false,
  });
}

export function useDependencyDetail(scanId: string | null, dependencyId: string | null) {
  return useQuery({
    queryKey: queryKeys.dependency(scanId ?? '', dependencyId ?? ''),
    queryFn: () =>
      apiGet(
        `/api/scans/${encodeURIComponent(scanId ?? '')}/dependencies/${encodeURIComponent(dependencyId ?? '')}`,
        DependencyDetailSchema,
      ),
    enabled: !!scanId && !!dependencyId,
  });
}

/** The report exists only once the scan is COMPLETED; pass `enabled` accordingly. */
export function useReport(scanId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.report(scanId ?? ''),
    queryFn: () => apiGet(`/api/scans/${encodeURIComponent(scanId ?? '')}/report`, ReportSchema),
    enabled: !!scanId && enabled,
  });
}

/** URL to download the Markdown report (the API sets Content-Disposition). */
export function markdownReportUrl(scanId: string): string {
  return `/api/scans/${encodeURIComponent(scanId)}/report?format=markdown`;
}

export function useInspectRepository() {
  return useMutation({
    mutationFn: (url: string) => apiPost('/api/repositories/inspect', { url }, InspectRepositoryResponseSchema),
  });
}

export function useCreateScan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateScanRequest) =>
      // A fresh key per click: a double click reuses the scan instead of creating two.
      apiPost('/api/scans', input, CreateScanResponseSchema, { 'Idempotency-Key': crypto.randomUUID() }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.dashboard });
      void client.invalidateQueries({ queryKey: ['repositories'] });
      void client.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

export function useReanalyze(scanId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ReanalyzeRequest) =>
      apiPost(
        `/api/scans/${encodeURIComponent(scanId)}/reanalyze`,
        input,
        z.object({ scanId: z.string(), status: z.string() }),
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.scan(scanId) });
      void client.invalidateQueries({ queryKey: ['dependencies', scanId] });
      void client.invalidateQueries({ queryKey: ['dependency', scanId] });
      void client.removeQueries({ queryKey: queryKeys.report(scanId) });
    },
  });
}
