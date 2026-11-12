import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Octokit } from '@octokit/rest';
import { stringify as stringifyYaml } from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectCandidates, extractHnLinks, scoreCandidate } from '../src/discover.js';
import { needsReevaluation, type SeenFile } from '../src/seen.js';

const tempDirs: string[] = [];

function tempRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'crawler-test-'));
  tempDirs.push(dir);
  mkdirSync(path.join(dir, 'data', 'games'), { recursive: true });
  mkdirSync(path.join(dir, 'data', '_state'), { recursive: true });
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function oldGame(repoUrl: string): Record<string, unknown> {
  return {
    id: 'old--repo--root',
    slug: 'old-game',
    kind: 'demo',
    status: 'published',
    title: { zh: '旧作品' },
    summary: { zh: '已收录' },
    author: 'old',
    repo: { url: repoUrl },
    play: { url: `${repoUrl.replace('github.com', 'old.github.io')}/`, embeddable: true },
    media: { cover: 'media/old--repo--root/cover.webp' },
    genre: 'tech-demo',
    tags: [],
    controls: [],
    mobile: false,
    model: { name: 'fable-5.2', evidence: 'L1' },
    source: { discovered_by: 'seed', discovered_at: '2026-01-01' },
  };
}

function repoData(fullName: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const [owner, repo] = fullName.split('/');
  return {
    id: 1,
    name: repo,
    full_name: fullName,
    owner: {
      login: owner,
      avatar_url: `https://github.com/${owner}.png`,
      html_url: `https://github.com/${owner}`,
    },
    description: `Game ${repo}`,
    homepage: `https://${owner}.github.io/${repo}/`,
    license: { spdx_id: 'MIT' },
    topics: ['webgl-game'],
    stargazers_count: 12,
    default_branch: 'main',
    has_pages: true,
    pushed_at: '2026-02-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
    archived: false,
    ...extra,
  };
}

function mockClient(): Octokit {
  return {
    search: {
      code: vi.fn(async () => ({
        data: {
          items: [
            {
              path: 'demos/04-fps/index.html',
              repository: {
                full_name: 'alpha/game',
                html_url: 'https://github.com/alpha/game',
                name: 'game',
                owner: { login: 'alpha' },
              },
            },
            {
              path: 'index.html',
              repository: {
                full_name: 'old/repo',
                html_url: 'https://github.com/old/repo',
                name: 'repo',
                owner: { login: 'old' },
              },
            },
            {
              path: 'index.html',
              repository: {
                full_name: 'delta/demo',
                html_url: 'https://github.com/delta/demo',
                name: 'demo',
                owner: { login: 'delta' },
              },
            },
          ],
        },
      })),
      repos: vi.fn(async () => ({ data: { items: [] } })),
    },
    repos: {
      get: vi.fn(async ({ owner, repo }: { owner: string; repo: string }) => ({
        data: repoData(`${owner}/${repo}`),
      })),
      getPages: vi.fn(async ({ owner, repo }: { owner: string; repo: string }) => ({
        data: { html_url: `https://${owner}.github.io/${repo}/`, source: { branch: 'main' } },
      })),
    },
    git: {
      getTree: vi.fn(async () => ({ data: { tree: [{ path: 'index.html', type: 'blob' }] } })),
    },
  } as unknown as Octokit;
}

describe('scoreCandidate', () => {
  it('ranks model-id + Pages + index.html signals above a bare hit', () => {
    const strong = scoreCandidate({
      sources: ['github-code'],
      modelIdHit: true,
      repoSearchHit: false,
      hnHit: false,
      codeHit: true,
      homepage: 'https://a.github.io/game/',
      hasPagesUrl: true,
      hasIndexHtml: true,
      stars: 77,
    });
    const weak = scoreCandidate({
      sources: ['github-code'],
      modelIdHit: false,
      repoSearchHit: false,
      hnHit: false,
      codeHit: true,
      homepage: null,
      hasPagesUrl: false,
      hasIndexHtml: false,
      stars: 0,
    });
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.reasons).toContain('model id in repository');
    expect(strong.reasons).toContain('Pages URL');
  });

  it('caps the star bonus', () => {
    const a = scoreCandidate({
      sources: [],
      modelIdHit: false,
      repoSearchHit: false,
      hnHit: false,
      codeHit: false,
      homepage: null,
      hasPagesUrl: false,
      hasIndexHtml: false,
      stars: 100,
    });
    const b = scoreCandidate({
      sources: [],
      modelIdHit: false,
      repoSearchHit: false,
      hnHit: false,
      codeHit: false,
      homepage: null,
      hasPagesUrl: false,
      hasIndexHtml: false,
      stars: 10_000,
    });
    expect(a.score).toBe(b.score);
  });
});

describe('extractHnLinks', () => {
  it('pulls URLs out of story URLs and comment HTML', () => {
    const links = extractHnLinks([
      {
        url: 'https://github.com/a/b',
        comment_text: 'see <a href="https://a.github.io/b/">demo</a>',
      },
      { story_text: 'mirror https://github.com/c/d' },
    ]);
    expect(links).toContain('https://github.com/a/b');
    expect(links).toContain('https://a.github.io/b/');
    expect(links).toContain('https://github.com/c/d');
  });
});

describe('needsReevaluation / seen dedupe', () => {
  it('re-evaluates only when pushed_at is newer', () => {
    const seen: SeenFile = {
      'a/b': { repo: 'a/b', last_seen: '2026-01-01', pushed_at: '2026-01-01T00:00:00Z' },
    };
    expect(needsReevaluation(seen['a/b'], '2026-01-01T00:00:00Z')).toBe(false);
    expect(needsReevaluation(seen['a/b'], '2026-02-01T00:00:00Z')).toBe(true);
    expect(needsReevaluation(undefined, '2026-02-01T00:00:00Z')).toBe(true);
  });
});

describe('collectCandidates', () => {
  it('scores, hydrates, and dedupes against data/games and seen.json', async () => {
    const root = tempRoot();
    writeFileSync(
      path.join(root, 'data', 'games', 'old--repo--root.yaml'),
      stringifyYaml(oldGame('https://github.com/old/repo')),
    );
    const seen: SeenFile = {
      'delta/demo': {
        repo: 'delta/demo',
        last_seen: '2026-01-01T00:00:00Z',
        pushed_at: '2026-02-01T00:00:00Z',
      },
    };
    writeFileSync(path.join(root, 'data', '_state', 'seen.json'), JSON.stringify(seen));

    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ hits: [{ url: 'https://github.com/beta/game' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

    const candidates = await collectCandidates({
      rootDir: root,
      client: mockClient(),
      queries: { code_search: ['claude-fable-5-2'], repo_search: [], hn: ['fable'] },
      fetchImpl,
      logger: () => undefined,
    });

    expect(candidates.map((candidate) => candidate.repo)).toEqual(['alpha/game', 'beta/game']);
    expect(candidates[0]?.signals.modelIdHit).toBe(true);
    expect(candidates[0]?.signals.hasIndexHtml).toBe(true);
    expect(candidates[1]?.signals.hnHit).toBe(true);
    expect(candidates.some((candidate) => candidate.repo === 'old/repo')).toBe(false);
    expect(candidates.some((candidate) => candidate.repo === 'delta/demo')).toBe(false);
  });
});
