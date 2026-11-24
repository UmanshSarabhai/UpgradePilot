import { z } from 'zod';
import type { HttpClient } from '../../lib/http';

export const GITHUB_HOSTS = ['api.github.com', 'raw.githubusercontent.com'] as const;

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';
const BRANCH_PAGE_SIZE = 100;

const GitHubRepositorySchema = z.object({
  name: z.string(),
  full_name: z.string(),
  owner: z.object({ login: z.string() }),
  html_url: z.string(),
  description: z.string().nullable(),
  default_branch: z.string(),
  language: z.string().nullable(),
  stargazers_count: z.number(),
  archived: z.boolean(),
  private: z.boolean(),
});
export type GitHubRepository = z.infer<typeof GitHubRepositorySchema>;

const GitHubBranchSchema = z.object({
  name: z.string(),
  commit: z.object({ sha: z.string() }),
});
export type GitHubBranch = z.infer<typeof GitHubBranchSchema>;

const GitHubTreeSchema = z.object({
  sha: z.string(),
  truncated: z.boolean(),
  tree: z.array(
    z.object({
      path: z.string(),
      type: z.string(),
      size: z.number().optional(),
    }),
  ),
});

export interface TreeFile {
  path: string;
  size: number | undefined;
}

export interface GitHubClient {
  getRepository(owner: string, name: string): Promise<GitHubRepository>;
  /** First page of branches. `truncated` is true when a full page came back. */
  listBranches(owner: string, name: string): Promise<{ branches: GitHubBranch[]; truncated: boolean }>;
  getBranch(owner: string, name: string, branch: string): Promise<GitHubBranch>;
  /** All blobs at a commit. `truncated` is true when GitHub cut the listing short. */
  getTree(owner: string, name: string, commitSha: string): Promise<{ files: TreeFile[]; truncated: boolean }>;
  /** Raw file contents at a commit. Not counted against the GitHub API rate limit. */
  getFile(owner: string, name: string, commitSha: string, path: string, maxBytes: number): Promise<string>;
}

/** Encodes each path segment but keeps the slashes, for branch names and file paths. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function createGitHubClient({ http, token }: { http: HttpClient; token?: string | undefined }): GitHubClient {
  const apiHeaders: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'UpgradePilot',
  };
  if (token) apiHeaders.Authorization = `Bearer ${token}`;

  const repoPath = (owner: string, name: string) => `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

  return {
    getRepository: (owner, name) => http.getJson(repoPath(owner, name), GitHubRepositorySchema, { headers: apiHeaders }),

    async listBranches(owner, name) {
      const branches = await http.getJson(
        `${repoPath(owner, name)}/branches?per_page=${BRANCH_PAGE_SIZE}`,
        z.array(GitHubBranchSchema),
        { headers: apiHeaders },
      );
      return { branches, truncated: branches.length === BRANCH_PAGE_SIZE };
    },

    getBranch: (owner, name, branch) =>
      http.getJson(`${repoPath(owner, name)}/branches/${encodePath(branch)}`, GitHubBranchSchema, {
        headers: apiHeaders,
      }),

    async getTree(owner, name, commitSha) {
      const tree = await http.getJson(
        `${repoPath(owner, name)}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`,
        GitHubTreeSchema,
        // Big monorepos return several MB of tree JSON.
        { headers: apiHeaders, maxBytes: 20 * 1024 * 1024 },
      );
      return {
        files: tree.tree.filter((entry) => entry.type === 'blob').map((entry) => ({ path: entry.path, size: entry.size })),
        truncated: tree.truncated,
      };
    },

    getFile: (owner, name, commitSha, path, maxBytes) =>
      http.getText(
        `${RAW}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${encodeURIComponent(commitSha)}/${encodePath(path)}`,
        { headers: { 'User-Agent': 'UpgradePilot' }, maxBytes },
      ),
  };
}
