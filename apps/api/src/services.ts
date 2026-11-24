import type { Bindings } from './env';
import { createHttpClient } from './lib/http';
import type { Logger } from './lib/logger';
import { createScanRunner } from './modules/orchestration/scan-runner';
import { createStages } from './modules/orchestration/stages';
import { createReleaseNotesService } from './modules/release-notes/release-notes-service';
import { createGitHubClient, GITHUB_HOSTS } from './modules/repository/github-client';
import { createRepositoryService } from './modules/repository/repository-service';
import { createD1Cache } from './modules/storage/d1-cache';
import { createScanStore } from './modules/storage/scan-store';
import { createNpmRegistry, NPM_HOSTS } from './modules/versions/npm-registry';

/** Wires modules to real infrastructure for one request or one queue message. `fetchImpl` is for tests. */
export function buildServices(env: Bindings, logger: Logger, fetchImpl?: typeof fetch) {
  const githubHttp = createHttpClient({ allowedHosts: GITHUB_HOSTS, logger, fetch: fetchImpl });
  const npmHttp = createHttpClient({
    allowedHosts: NPM_HOSTS,
    logger,
    fetch: fetchImpl,
    headers: { 'User-Agent': 'UpgradePilot' },
  });
  const github = createGitHubClient({ http: githubHttp, token: env.GITHUB_TOKEN });
  const repositories = createRepositoryService(github);
  const store = createScanStore(env.DB);
  const cache = createD1Cache(env.DB, logger);
  const stages = createStages({
    store,
    repositories,
    createRegistry: () => createNpmRegistry({ http: npmHttp, cache }),
    releaseNotes: createReleaseNotesService({ github }),
    logger,
  });
  return { repositories, store, runner: createScanRunner({ store, stages, logger }) };
}
