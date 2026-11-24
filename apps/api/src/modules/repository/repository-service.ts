import type { Branch, InspectRepositoryResponse } from '@upgradepilot/shared';
import { AppError, UpstreamError } from '../../lib/errors';
import type { GitHubBranch, GitHubClient, GitHubRepository } from './github-client';
import { isValidBranchName, parseGitHubRepoUrl, type RepositoryRef } from './github-url';

/** Read-only view of a repository at one commit. The discovery module depends on this, not on GitHub. */
export interface RepositoryFiles {
  listFiles(): Promise<{ files: Array<{ path: string; size: number | undefined }>; truncated: boolean }>;
  /** Returns null when the file does not exist. Throws UpstreamError `too_large` above `maxBytes`. */
  readFile(path: string, maxBytes: number): Promise<string | null>;
}

export interface RepositoryService {
  inspect(url: string): Promise<InspectRepositoryResponse>;
  /** Looks up a public repository and resolves a branch to its head commit. */
  resolveBranch(ref: RepositoryRef, branch: string): Promise<{ repository: GitHubRepository; commitSha: string }>;
  filesAt(ref: RepositoryRef, commitSha: string): RepositoryFiles;
}

export function createRepositoryService(github: GitHubClient): RepositoryService {
  async function getPublicRepository(ref: RepositoryRef): Promise<GitHubRepository> {
    let repository: GitHubRepository;
    try {
      repository = await github.getRepository(ref.owner, ref.name);
    } catch (error) {
      if (error instanceof UpstreamError && error.kind === 'not_found') {
        throw new AppError(
          'REPOSITORY_NOT_FOUND',
          `Repository ${ref.owner}/${ref.name} was not found or is not public.`,
          404,
        );
      }
      throw error;
    }
    if (repository.private) {
      throw new AppError('REPOSITORY_NOT_PUBLIC', 'Only public repositories are supported.', 403);
    }
    return repository;
  }

  const toBranch = (branch: GitHubBranch, defaultBranch: string): Branch => ({
    name: branch.name,
    commitSha: branch.commit.sha,
    isDefault: branch.name === defaultBranch,
  });

  return {
    async inspect(url) {
      const ref = parseGitHubRepoUrl(url);
      const repository = await getPublicRepository(ref);
      const { branches, truncated } = await github.listBranches(repository.owner.login, repository.name);

      // Repos with more than one page of branches may not list the default branch. Fetch it so it is always offered.
      let all = branches;
      if (!branches.some((branch) => branch.name === repository.default_branch)) {
        all = [await github.getBranch(repository.owner.login, repository.name, repository.default_branch), ...branches];
      }
      const result = all
        .map((branch) => toBranch(branch, repository.default_branch))
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));

      return {
        repository: {
          owner: repository.owner.login,
          name: repository.name,
          fullName: repository.full_name,
          url: repository.html_url,
          description: repository.description,
          defaultBranch: repository.default_branch,
          primaryLanguage: repository.language,
          stars: repository.stargazers_count,
          archived: repository.archived,
        },
        branches: result,
        branchesTruncated: truncated,
      };
    },

    async resolveBranch(ref, branch) {
      if (!isValidBranchName(branch)) throw new AppError('VALIDATION_ERROR', 'Branch name is not valid.', 400);
      const repository = await getPublicRepository(ref);
      try {
        const head = await github.getBranch(repository.owner.login, repository.name, branch);
        return { repository, commitSha: head.commit.sha };
      } catch (error) {
        if (error instanceof UpstreamError && error.kind === 'not_found') {
          throw new AppError('BRANCH_NOT_FOUND', `Branch "${branch}" was not found.`, 404);
        }
        throw error;
      }
    },

    filesAt(ref, commitSha) {
      return {
        listFiles: () => github.getTree(ref.owner, ref.name, commitSha),
        async readFile(path, maxBytes) {
          try {
            return await github.getFile(ref.owner, ref.name, commitSha, path, maxBytes);
          } catch (error) {
            if (error instanceof UpstreamError && error.kind === 'not_found') return null;
            throw error;
          }
        },
      };
    },
  };
}
