import { createHttpClient } from './lib/http';
import type { Logger } from './lib/logger';
import type { Bindings } from './env';
import { createGitHubClient, GITHUB_HOSTS } from './modules/repository/github-client';
import { createRepositoryService } from './modules/repository/repository-service';

/** Wires modules to real infrastructure for one request. */
export function buildServices(env: Bindings, logger: Logger) {
  const githubHttp = createHttpClient({ allowedHosts: GITHUB_HOSTS, logger });
  const github = createGitHubClient({ http: githubHttp, token: env.GITHUB_TOKEN });
  return { repositories: createRepositoryService(github) };
}
