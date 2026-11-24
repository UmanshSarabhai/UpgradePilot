import { z } from 'zod';

export const InspectRepositoryRequestSchema = z.object({
  url: z.string().trim().min(1).max(500),
});
export type InspectRepositoryRequest = z.infer<typeof InspectRepositoryRequestSchema>;

export const RepositorySummarySchema = z.object({
  owner: z.string(),
  name: z.string(),
  fullName: z.string(),
  url: z.url(),
  description: z.string().nullable(),
  defaultBranch: z.string(),
  primaryLanguage: z.string().nullable(),
  stars: z.number().int().nonnegative(),
  archived: z.boolean(),
});
export type RepositorySummary = z.infer<typeof RepositorySummarySchema>;

export const BranchSchema = z.object({
  name: z.string(),
  commitSha: z.string(),
  isDefault: z.boolean(),
});
export type Branch = z.infer<typeof BranchSchema>;

export const InspectRepositoryResponseSchema = z.object({
  repository: RepositorySummarySchema,
  branches: z.array(BranchSchema),
  /** True when the repository has more branches than the first page returned. */
  branchesTruncated: z.boolean(),
});
export type InspectRepositoryResponse = z.infer<typeof InspectRepositoryResponseSchema>;
