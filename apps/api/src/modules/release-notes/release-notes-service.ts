import semver from 'semver';
import { UpstreamError } from '../../lib/errors';
import { sha256Hex } from '../../lib/hash';
import type { GitHubClient } from '../repository/github-client';
import { parseGitHubRepoUrl, type RepositoryRef } from '../repository/github-url';
import type { ReleaseEvidence, ReleaseNotesInput, ReleaseNotesService } from './types';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const TOTAL_EXCERPT_CHARS = 16_000;
const ITEM_EXCERPT_CHARS = 6_000;
const TRUNCATED = '\n[truncated]';
const MAX_RELEASE_ITEMS = 20;
const MAX_MAJOR_RELEASES = 10;
/** Changelog lines longer than this are never run through a regex (ReDoS guard). */
const MAX_HEADING_LINE_CHARS = 200;

/** An evidence item plus the full content its excerpt is cut from. */
interface Draft {
  evidence: ReleaseEvidence;
  content: string | null;
}

/** Turns the forms npm accepts in `repository.url` into something parseGitHubRepoUrl understands. */
function toHttpsUrl(raw: string): string {
  const url = raw.trim().replace(/^git\+/, '');
  const scp = /^git@([^:/]+):(.+)$/.exec(url);
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  if (/^github:/.test(url)) return `https://github.com/${url.slice('github:'.length)}`;
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`;
  return url.replace(/^(?:git|ssh):\/\/(?:git@)?/, 'https://');
}

function parseRepository(raw: string): RepositoryRef | null {
  try {
    return parseGitHubRepoUrl(toHttpsUrl(raw));
  } catch {
    return null;
  }
}

function inRange(version: string | null, input: ReleaseNotesInput): version is string {
  return (
    version !== null &&
    semver.valid(input.currentVersion) !== null &&
    semver.valid(input.targetVersion) !== null &&
    semver.gt(version, input.currentVersion) &&
    semver.lte(version, input.targetVersion)
  );
}

/** `v1.2.3`, `1.2.3` or `<package>@1.2.3`. The prefix must be this package. */
function versionFromTag(tag: string, packageName: string): string | null {
  const at = tag.lastIndexOf('@');
  let rest = tag;
  if (at > 0) {
    if (tag.slice(0, at) !== packageName) return null;
    rest = tag.slice(at + 1);
  }
  return semver.valid(rest.replace(/^v/, ''));
}

/** Keeps the sections whose heading names a version in range. Returns null when none match. */
function extractChangelogSections(markdown: string, input: ReleaseNotesInput): string | null {
  const lines = markdown.split('\n');
  const headings: { index: number; level: number; version: string | null }[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.length > MAX_HEADING_LINE_CHARS) continue;
    const m = /^(#{1,3})\s+(.*?)\r?$/.exec(line);
    if (!m) continue;
    const found = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(m[2] ?? '');
    headings.push({ index, level: (m[1] ?? '').length, version: found ? semver.valid(found[0]) : null });
  }

  const sections: string[] = [];
  let resumeAt = 0;
  for (const [i, h] of headings.entries()) {
    if (h.index < resumeAt || !inRange(h.version, input)) continue;
    const next = headings.slice(i + 1).find((n) => n.version !== null && n.level <= h.level);
    const end = next ? next.index : lines.length;
    sections.push(lines.slice(h.index, end).join('\n').trimEnd());
    resumeAt = end;
  }
  return sections.length > 0 ? sections.join('\n\n') : null;
}

function cleanDirectory(directory: string | null | undefined): string | null {
  if (!directory) return null;
  const segments = directory.split('/').filter((s) => s !== '' && s !== '.');
  // `..` would let the manifest point the fetch at another path in the repository host.
  if (segments.length === 0 || segments.includes('..')) return null;
  return segments.join('/');
}

function candidates(directory: string | null, files: string[]): string[] {
  return directory ? [...files.map((f) => `${directory}/${f}`), ...files] : files;
}

export function createReleaseNotesService({ github }: { github: GitHubClient }): ReleaseNotesService {
  async function collectReleases(repo: RepositoryRef, input: ReleaseNotesInput): Promise<Draft[]> {
    const pageUrl = `https://github.com/${repo.owner}/${repo.name}/releases`;
    const drafts: Draft[] = [];
    try {
      const releases = await github.listReleases(repo.owner, repo.name);
      const matched = releases
        .filter((r) => !r.draft && !r.prerelease)
        .map((r) => ({ release: r, version: versionFromTag(r.tag_name, input.packageName) }))
        .filter((m): m is { release: typeof m.release; version: string } => inRange(m.version, input))
        .sort((a, b) => semver.rcompare(a.version, b.version));
      // Keep at most MAX_RELEASE_ITEMS: major releases (x.0.0, at most MAX_MAJOR_RELEASES) first, then the newest others.
      const isMajor = (m: { version: string }) => semver.minor(m.version) === 0 && semver.patch(m.version) === 0;
      const majors = matched.filter(isMajor).slice(0, MAX_MAJOR_RELEASES);
      const others = matched.filter((m) => !isMajor(m)).slice(0, MAX_RELEASE_ITEMS - majors.length);
      const kept = [...majors, ...others].sort((a, b) => semver.rcompare(a.version, b.version));
      for (const { release, version } of kept) {
        const body = release.body ?? '';
        drafts.push({
          content: body,
          evidence: {
            sourceType: 'github_release',
            sourceUrl: release.html_url,
            version,
            retrievalStatus: 'ok',
            contentHash: await sha256Hex(body),
            contentExcerpt: null,
            errorMessage: null,
          },
        });
      }
      if (drafts.length === 0) {
        drafts.push(emptyDraft('github_release', pageUrl, 'not_found', 'No published release in this version range.'));
      }
    } catch (error) {
      drafts.push(failureDraft('github_release', pageUrl, error));
    }
    return drafts;
  }

  /** First candidate that exists. Returns the path tried last when none do. */
  async function firstFile(repo: RepositoryRef, paths: string[]): Promise<{ path: string; content: string | null }> {
    let path = paths[0] ?? '';
    for (const candidate of paths) {
      path = candidate;
      try {
        return { path, content: await github.getFile(repo.owner, repo.name, 'HEAD', path, MAX_FILE_BYTES) };
      } catch (error) {
        if (error instanceof UpstreamError && error.kind === 'not_found') continue;
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { attemptedPath: path });
      }
    }
    return { path, content: null };
  }

  const blobUrl = (repo: RepositoryRef, path: string) => `https://github.com/${repo.owner}/${repo.name}/blob/HEAD/${path}`;

  async function collectChangelog(repo: RepositoryRef, input: ReleaseNotesInput, directory: string | null): Promise<Draft> {
    const paths = candidates(directory, ['CHANGELOG.md']);
    let url = blobUrl(repo, paths[paths.length - 1] ?? 'CHANGELOG.md');
    try {
      const { path, content } = await firstFile(repo, paths);
      url = blobUrl(repo, path);
      if (content === null) return emptyDraft('changelog', url, 'not_found', 'No CHANGELOG.md found.');
      const sections = extractChangelogSections(content, input);
      if (sections === null) {
        return emptyDraft('changelog', url, 'not_found', 'CHANGELOG.md has no section in this version range.');
      }
      return {
        content: sections,
        evidence: {
          sourceType: 'changelog',
          sourceUrl: url,
          version: input.targetVersion,
          retrievalStatus: 'ok',
          contentHash: await sha256Hex(sections),
          contentExcerpt: null,
          errorMessage: null,
        },
      };
    } catch (error) {
      return failureDraft('changelog', attemptedUrl(error, repo, url), error);
    }
  }

  async function collectMigration(repo: RepositoryRef, directory: string | null): Promise<Draft> {
    const paths = candidates(directory, ['MIGRATION.md', 'UPGRADING.md']);
    let url = blobUrl(repo, paths[paths.length - 1] ?? 'MIGRATION.md');
    try {
      const { path, content } = await firstFile(repo, paths);
      url = blobUrl(repo, path);
      if (content === null) return emptyDraft('migration_guide', url, 'not_found', 'No migration guide found.');
      return {
        content,
        evidence: {
          sourceType: 'migration_guide',
          sourceUrl: url,
          version: null,
          retrievalStatus: 'ok',
          contentHash: await sha256Hex(content),
          contentExcerpt: null,
          errorMessage: null,
        },
      };
    } catch (error) {
      return failureDraft('migration_guide', attemptedUrl(error, repo, url), error);
    }
  }

  function attemptedUrl(error: unknown, repo: RepositoryRef, fallback: string): string {
    const path = (error as { attemptedPath?: unknown }).attemptedPath;
    return typeof path === 'string' ? blobUrl(repo, path) : fallback;
  }

  return {
    async collect(input) {
      const raw = input.repository?.url ?? null;
      const repo = raw === null ? null : parseRepository(raw);
      if (repo === null) {
        return [
          {
            sourceType: 'github_release',
            sourceUrl: raw ?? `https://www.npmjs.com/package/${input.packageName}`,
            version: null,
            retrievalStatus: 'skipped',
            contentHash: null,
            contentExcerpt: null,
            errorMessage: raw === null ? 'The package declares no repository.' : 'The repository is not hosted on GitHub.',
          },
        ];
      }

      const directory = cleanDirectory(input.repository?.directory);
      // Fetched one after another to keep GitHub request bursts small.
      const releases = await collectReleases(repo, input);
      const changelog = await collectChangelog(repo, input, directory);
      const migration = input.upgradeType === 'major' ? await collectMigration(repo, directory) : null;

      // Budget goes to the migration guide, then the changelog, then major releases (x.0.0, where breaking changes
      // are announced), then the other releases. Within each group, newest first (sort is stable).
      const isMajorRelease = (draft: Draft) => {
        const version = draft.evidence.version;
        return version !== null && semver.minor(version) === 0 && semver.patch(version) === 0;
      };
      const releasesByPriority = [...releases].sort((a, b) => Number(isMajorRelease(b)) - Number(isMajorRelease(a)));
      let remaining = TOTAL_EXCERPT_CHARS;
      for (const draft of [...(migration ? [migration] : []), changelog, ...releasesByPriority]) {
        if (draft.content === null) continue;
        const room = Math.min(ITEM_EXCERPT_CHARS, remaining);
        if (room <= TRUNCATED.length) continue;
        const excerpt =
          draft.content.length <= room ? draft.content : draft.content.slice(0, room - TRUNCATED.length) + TRUNCATED;
        draft.evidence.contentExcerpt = excerpt;
        remaining -= excerpt.length;
      }

      return [...releases, changelog, ...(migration ? [migration] : [])].map((d) => d.evidence);
    },
  };
}

function emptyDraft(
  sourceType: ReleaseEvidence['sourceType'],
  sourceUrl: string,
  retrievalStatus: ReleaseEvidence['retrievalStatus'],
  errorMessage: string,
): Draft {
  return {
    content: null,
    evidence: { sourceType, sourceUrl, version: null, retrievalStatus, contentHash: null, contentExcerpt: null, errorMessage },
  };
}

/** Rate limits propagate so the scan runner can reschedule. Everything else becomes an item. */
function failureDraft(sourceType: ReleaseEvidence['sourceType'], sourceUrl: string, error: unknown): Draft {
  if (error instanceof UpstreamError && error.kind === 'rate_limited') throw error;
  const message = error instanceof Error ? error.message : String(error);
  const tooLarge = error instanceof UpstreamError && error.kind === 'too_large';
  return emptyDraft(sourceType, sourceUrl, tooLarge ? 'too_large' : 'failed', message);
}
