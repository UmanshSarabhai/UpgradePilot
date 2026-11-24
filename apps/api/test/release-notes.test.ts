import semver from 'semver';
import { describe, expect, it } from 'vitest';
import { UpstreamError } from '../src/lib/errors';
import { createReleaseNotesService } from '../src/modules/release-notes/release-notes-service';
import type { ReleaseNotesInput } from '../src/modules/release-notes/types';
import type { GitHubClient, GitHubRelease } from '../src/modules/repository/github-client';

function release(tag: string, over: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    tag_name: tag,
    html_url: `https://github.com/o/r/releases/tag/${tag}`,
    body: `notes for ${tag}`,
    draft: false,
    prerelease: false,
    published_at: null,
    ...over,
  };
}

const notFound = () => new UpstreamError('not_found', 'not found', { url: 'x' });

function fake(opts: {
  releases?: GitHubRelease[] | Error;
  files?: Record<string, string | Error>;
}) {
  const fetched: string[] = [];
  const unused = () => {
    throw new Error('not used');
  };
  const github: GitHubClient = {
    getRepository: unused,
    listBranches: unused,
    getBranch: unused,
    getTree: unused,
    async listReleases() {
      if (opts.releases instanceof Error) throw opts.releases;
      return opts.releases ?? [];
    },
    async getFile(_o, _n, _ref, path) {
      fetched.push(path);
      const file = opts.files?.[path];
      if (file === undefined) throw notFound();
      if (file instanceof Error) throw file;
      return file;
    },
  };
  return { service: createReleaseNotesService({ github }), fetched };
}

const base: ReleaseNotesInput = {
  packageName: 'pkg',
  currentVersion: '1.0.0',
  targetVersion: '2.0.0',
  upgradeType: 'minor',
  repository: { url: 'https://github.com/o/r', directory: null },
};

describe('release notes service', () => {
  it.each([
    'git+https://github.com/o/r.git',
    'https://github.com/o/r',
    'git://github.com/o/r.git',
    'git+ssh://git@github.com/o/r.git',
    'git@github.com:o/r.git',
    'github:o/r',
    'o/r',
  ])('normalises %s to o/r', async (url) => {
    const { service } = fake({ releases: [release('v1.5.0')] });
    const out = await service.collect({ ...base, repository: { url, directory: null } });
    expect(out[0]?.retrievalStatus).toBe('ok');
    expect(out[0]?.sourceUrl).toContain('github.com/o/r/');
  });

  it('skips a non-GitHub repository with a single item', async () => {
    const { service, fetched } = fake({});
    const out = await service.collect({ ...base, repository: { url: 'https://gitlab.com/o/r', directory: null } });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      sourceType: 'github_release',
      retrievalStatus: 'skipped',
      sourceUrl: 'https://gitlab.com/o/r',
    });
    expect(fetched).toEqual([]);
  });

  it('parses monorepo tags and ignores other packages', async () => {
    const { service } = fake({
      releases: [release('pkg@1.2.0'), release('other@1.3.0'), release('@scope/pkg@1.4.0'), release('v1.1.0')],
    });
    const out = await service.collect({ ...base, repository: { url: 'o/r', directory: null } });
    const releases = out.filter((e) => e.sourceType === 'github_release');
    expect(releases.map((e) => e.version)).toEqual(['1.2.0', '1.1.0']);

    const scoped = fake({ releases: [release('@scope/pkg@1.4.0'), release('pkg@1.2.0')] });
    const out2 = await scoped.service.collect({ ...base, packageName: '@scope/pkg' });
    expect(out2.filter((e) => e.sourceType === 'github_release').map((e) => e.version)).toEqual(['1.4.0']);
  });

  it('keeps (current, target], newest first, and skips drafts and prereleases', async () => {
    const { service } = fake({
      releases: [
        release('v1.0.0'),
        release('v1.5.0'),
        release('v2.0.0'),
        release('v2.0.1'),
        release('v1.6.0', { draft: true }),
        release('v1.7.0', { prerelease: true }),
      ],
    });
    const out = await service.collect(base);
    expect(out.filter((e) => e.sourceType === 'github_release').map((e) => e.version)).toEqual(['2.0.0', '1.5.0']);
  });

  it('reports not_found when no release is in range', async () => {
    const { service } = fake({ releases: [release('v0.9.0')] });
    const out = await service.collect(base);
    expect(out[0]).toMatchObject({
      sourceType: 'github_release',
      retrievalStatus: 'not_found',
      sourceUrl: 'https://github.com/o/r/releases',
    });
  });

  it('extracts only in-range changelog sections across heading styles', async () => {
    const changelog = [
      '# Changelog',
      '## [3.0.0] - 2024-03-01',
      'too new',
      '## [2.0.0] - 2024-02-01',
      'two body',
      '### Fixes',
      'a fix',
      '## v1.5.0',
      'one five',
      '### @scope/pkg@1.2.0',
      'one two',
      '## 1.0.0',
      'current, excluded',
    ].join('\n');
    const { service } = fake({ files: { 'CHANGELOG.md': changelog } });
    const out = await service.collect(base);
    const item = out.find((e) => e.sourceType === 'changelog');
    expect(item).toMatchObject({
      retrievalStatus: 'ok',
      version: '2.0.0',
      sourceUrl: 'https://github.com/o/r/blob/HEAD/CHANGELOG.md',
    });
    expect(item?.contentExcerpt).toContain('two body');
    expect(item?.contentExcerpt).toContain('a fix');
    expect(item?.contentExcerpt).toContain('one five');
    expect(item?.contentExcerpt).toContain('one two');
    expect(item?.contentExcerpt).not.toContain('too new');
    expect(item?.contentExcerpt).not.toContain('current, excluded');
    expect(item?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('falls back from the package directory to the root changelog', async () => {
    const { service, fetched } = fake({ files: { 'CHANGELOG.md': '## 1.5.0\nroot notes' } });
    const out = await service.collect({ ...base, repository: { url: 'o/r', directory: 'packages/pkg' } });
    expect(fetched).toEqual(['packages/pkg/CHANGELOG.md', 'CHANGELOG.md']);
    expect(out.find((e) => e.sourceType === 'changelog')?.contentExcerpt).toContain('root notes');
  });

  it('fetches migration guides only for major upgrades', async () => {
    const files = { 'UPGRADING.md': 'upgrade steps' };
    const minor = fake({ files });
    await minor.service.collect(base);
    expect(minor.fetched).toEqual(['CHANGELOG.md']);

    const major = fake({ files });
    const out = await major.service.collect({ ...base, upgradeType: 'major' });
    expect(major.fetched).toEqual(['CHANGELOG.md', 'MIGRATION.md', 'UPGRADING.md']);
    expect(out.find((e) => e.sourceType === 'migration_guide')).toMatchObject({
      retrievalStatus: 'ok',
      contentExcerpt: 'upgrade steps',
    });
  });

  it('propagates rate_limited errors', async () => {
    const { service } = fake({ releases: new UpstreamError('rate_limited', 'slow down', { url: 'x' }) });
    await expect(service.collect(base)).rejects.toMatchObject({ kind: 'rate_limited' });
  });

  it('records a failed source and still returns the others', async () => {
    const { service } = fake({
      releases: new UpstreamError('http_error', 'boom', { url: 'x' }),
      files: { 'CHANGELOG.md': new UpstreamError('too_large', 'big', { url: 'x' }) },
    });
    const out = await service.collect({ ...base, upgradeType: 'major' });
    expect(out.map((e) => [e.sourceType, e.retrievalStatus])).toEqual([
      ['github_release', 'failed'],
      ['changelog', 'too_large'],
      ['migration_guide', 'not_found'],
    ]);
    expect(out[0]?.errorMessage).toBe('boom');
  });

  it('caps excerpts per item and in total, keeping hashes', async () => {
    const big = 'x'.repeat(10_000);
    const { service } = fake({
      releases: ['v1.1.0', 'v1.2.0', 'v1.3.0'].map((t) => release(t, { body: big })),
      files: { 'MIGRATION.md': big, 'CHANGELOG.md': `## 2.0.0\n${big}` },
    });
    const out = await service.collect({ ...base, upgradeType: 'major' });
    const excerpts = out.map((e) => e.contentExcerpt);
    expect(excerpts.every((x) => x === null || x.length <= 6000)).toBe(true);
    expect(excerpts.reduce((n, x) => n + (x?.length ?? 0), 0)).toBeLessThanOrEqual(16_000);
    expect(out.find((e) => e.sourceType === 'migration_guide')?.contentExcerpt?.endsWith('\n[truncated]')).toBe(true);
    // Migration 6000 + changelog 6000 + newest release 4000; the rest get no excerpt.
    const releases = out.filter((e) => e.sourceType === 'github_release');
    expect(releases.map((e) => e.version)).toEqual(['1.3.0', '1.2.0', '1.1.0']);
    expect(releases[0]?.contentExcerpt).not.toBeNull();
    expect(releases[1]?.contentExcerpt).toBeNull();
    expect(releases[1]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps at most 20 releases: up to 10 majors first, then the newest others, newest first', async () => {
    const tags: string[] = [];
    for (let major = 1; major <= 12; major++) tags.push(`v${major}.0.0`);
    for (let minor = 1; minor <= 30; minor++) tags.push(`v12.${minor}.0`);
    const { service } = fake({ releases: tags.map((t) => release(t)) });
    const out = await service.collect({ ...base, currentVersion: '0.5.0', targetVersion: '12.30.0', upgradeType: 'major' });
    const versions = out.filter((e) => e.sourceType === 'github_release').map((e) => e.version);
    expect(versions).toHaveLength(20);
    // 10 newest majors (3.0.0 to 12.0.0) plus the 10 newest other releases (12.21.0 to 12.30.0).
    expect(versions[0]).toBe('12.30.0');
    expect(versions).toContain('3.0.0');
    expect(versions).not.toContain('2.0.0');
    expect(versions).not.toContain('12.20.0');
    expect(versions).toEqual(
      [...versions].sort((a, b) => semver.rcompare(a ?? '', b ?? '')),
    );
  });

  it('skips very long changelog lines without slow regex work', async () => {
    const long = '#' + ' 1.2.3.4.5.6.7.8.9.'.repeat(5_300);
    expect(long.length).toBeGreaterThan(100_000);
    const changelog = `# Changelog\n\n## 2.0.0\n\nNew stuff\n\n${long}\n\n## 1.1.0\n\nOld\n\n## 1.0.0\n`;
    const { service } = fake({ files: { 'CHANGELOG.md': changelog } });
    const start = performance.now();
    const out = await service.collect(base);
    expect(performance.now() - start).toBeLessThan(100);
    expect(out.find((e) => e.sourceType === 'changelog')?.retrievalStatus).toBe('ok');
  });

  it('gives excerpt budget to major releases before newer minor ones', async () => {
    const big = 'x'.repeat(6_000);
    const { service } = fake({ releases: ['v3.2.0', 'v3.1.0', 'v3.0.0', 'v2.0.0'].map((t) => release(t, { body: big })) });
    const out = await service.collect({ ...base, currentVersion: '1.5.0', targetVersion: '3.2.0', upgradeType: 'major' });
    const withExcerpt = out.filter((e) => e.sourceType === 'github_release' && e.contentExcerpt !== null).map((e) => e.version);
    expect(withExcerpt).toEqual(['3.2.0', '3.0.0', '2.0.0']);
  });
});
