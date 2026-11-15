import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Octokit } from '@octokit/rest';
import { stringify as stringifyYaml } from 'yaml';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectCandidates,
  dedupeClones,
  extractHnLinks,
  scoreCandidate,
  type Candidate,
  type CandidateSignals,
} from '../src/discover.js';
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
    title: { zh: '旧作品', en: 'Old Work' },
    summary: { zh: '已收录', en: 'Already listed' },
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

function baseSignals(overrides: Partial<CandidateSignals> = {}): CandidateSignals {
  return {
    sources: [],
    modelIdHit: false,
    repoSearchHit: false,
    hnHit: false,
    codeHit: false,
    homepage: null,
    hasPagesUrl: false,
    hasIndexHtml: false,
    stars: 0,
    ...overrides,
  };
}

function makeCandidate(overrides: {
  repo: string;
  description: string | null;
  score: number;
  stars?: number;
  pushedAt?: string | null;
  reasons?: string[];
}): Candidate {
  const stars = overrides.stars ?? 0;
  return {
    repo: overrides.repo,
    url: `https://github.com/${overrides.repo}`,
    homepage: null,
    stars,
    pushedAt: overrides.pushedAt ?? null,
    description: overrides.description,
    signals: baseSignals({ stars }),
    score: overrides.score,
    reasons: overrides.reasons ?? [],
  };
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

  it('penalises list/aggregator repos even when the signals mention a game', () => {
    const plain = scoreCandidate(
      baseSignals({
        modelIdHit: true,
        repoSearchHit: true,
        homepage: 'https://a.github.io/game/',
        hasPagesUrl: true,
        gameHint: true,
        stars: 7,
      }),
    );
    const list = scoreCandidate(
      baseSignals({
        modelIdHit: true,
        repoSearchHit: true,
        homepage: 'https://a.github.io/game/',
        hasPagesUrl: true,
        gameHint: true,
        listHint: true,
        stars: 7,
      }),
    );

    expect(list.reasons).toContain('aggregator/list repo');
    expect(list.reasons).not.toContain('game/webgl hint');
    expect(list.reasons).not.toContain('7 stars');
    expect(list.score).toBeLessThan(plain.score);
    // 30 (model id) + 10 (repo search) + 15 (Pages) - 35 (list), no star bonus.
    expect(list.score).toBe(20);
  });

  it('does not award the star bonus to tool repos', () => {
    const tool = scoreCandidate(baseSignals({ codeHit: true, toolHint: true, stars: 7760 }));

    expect(tool.reasons).toContain('tool/library repo');
    expect(tool.reasons).not.toContain('7760 stars');
    // 20 (code search) - 45 (tool), with no star bonus.
    expect(tool.score).toBe(-25);
  });
});

describe('dedupeClones', () => {
  const description =
    'A first-person horror portal-puzzle game. Built in one prompt with Claude Fable 5';

  it('keeps the best clone and records the merge', () => {
    const original = makeCandidate({
      repo: 'vibefin/wormhole',
      description,
      score: 60,
      stars: 9,
      pushedAt: '2026-02-01T00:00:00Z',
    });
    const copy = makeCandidate({
      repo: 'aidanht/wormhole',
      description,
      score: 68,
      pushedAt: '2026-02-02T00:00:00Z',
    });

    const kept = dedupeClones([original, copy]);

    expect(kept.map((candidate) => candidate.repo)).toEqual(['aidanht/wormhole']);
    expect(kept[0]?.reasons).toContain('1 clone(s) merged');
    expect(original.reasons).toContain('duplicate of aidanht/wormhole');
  });

  it('breaks score ties by stars, then by the earliest push', () => {
    const popular = makeCandidate({
      repo: 'b/wormhole',
      description,
      score: 50,
      stars: 10,
      pushedAt: '2026-03-01T00:00:00Z',
    });
    const earlier = makeCandidate({
      repo: 'a/wormhole',
      description,
      score: 50,
      stars: 1,
      pushedAt: '2026-01-01T00:00:00Z',
    });

    expect(dedupeClones([popular, earlier]).map((candidate) => candidate.repo)).toEqual([
      'b/wormhole',
    ]);

    const originallyPushed = makeCandidate({
      repo: 'c/wormhole',
      description,
      score: 50,
      stars: 5,
      pushedAt: '2026-01-01T00:00:00Z',
    });
    const laterPushed = makeCandidate({
      repo: 'd/wormhole',
      description,
      score: 50,
      stars: 5,
      pushedAt: '2026-04-01T00:00:00Z',
    });

    expect(
      dedupeClones([laterPushed, originallyPushed]).map((candidate) => candidate.repo),
    ).toEqual(['c/wormhole']);
  });

  it('does not merge same-named repos with different descriptions', () => {
    const first = makeCandidate({
      repo: 'one/game',
      description: 'A first-person horror portal-puzzle game built with Claude',
      score: 50,
    });
    const second = makeCandidate({
      repo: 'two/game',
      description: 'An open-world racing game with a day and night cycle',
      score: 50,
    });

    expect(dedupeClones([first, second])).toHaveLength(2);
  });

  it('does not merge repos that only share a short, generic description', () => {
    const first = makeCandidate({ repo: 'one/game', description: 'A fable game', score: 50 });
    const second = makeCandidate({ repo: 'two/game', description: 'A fable game', score: 50 });

    expect(dedupeClones([first, second])).toHaveLength(2);
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

  it('marks an awesome-list about games as a list and withholds game credit', async () => {
    const root = tempRoot();
    const description =
      '3031 source-verified AI-built games from 2724 repos, made with Claude Fable 5.2';
    const client = {
      search: {
        repos: vi.fn(async () => ({
          data: {
            items: [
              {
                full_name: 'agg/awesome-fable-5-2-game',
                html_url: 'https://github.com/agg/awesome-fable-5-2-game',
                homepage: 'https://agg.github.io/awesome-fable-5-2-game/',
                stargazers_count: 50,
                pushed_at: '2026-02-01T00:00:00Z',
                description,
                topics: [],
              },
            ],
          },
        })),
      },
    } as unknown as Octokit;

    const candidates = await collectCandidates({
      rootDir: root,
      client,
      queries: { code_search: [], repo_search: ['awesome fable games'], hn: [] },
      logger: () => undefined,
    });

    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    expect(candidate?.signals.listHint).toBe(true);
    expect(candidate?.signals.gameHint).toBe(false);
    expect(candidate?.reasons).toContain('aggregator/list repo');
    expect(candidate?.reasons).not.toContain('game/webgl hint');
    expect(candidate?.reasons).not.toContain('50 stars');
  });

  it('recognises a Chinese-language tooling repo and withholds the star bonus', async () => {
    const root = tempRoot();
    const description =
      '把 DeepAI Code 桌面端的上游服务逆向成 OpenAI / Anthropic 双协议兼容的 Go 网关';
    const client = {
      search: {
        repos: vi.fn(async () => ({
          data: {
            items: [
              {
                full_name: '2951461586/DeepAICode2API',
                html_url: 'https://github.com/2951461586/DeepAICode2API',
                homepage: null,
                stargazers_count: 75,
                pushed_at: '2026-02-01T00:00:00Z',
                description,
                topics: [],
              },
            ],
          },
        })),
      },
    } as unknown as Octokit;

    const candidates = await collectCandidates({
      rootDir: root,
      client,
      queries: { code_search: [], repo_search: ['fable 5.2'], hn: [] },
      logger: () => undefined,
    });

    expect(candidates).toHaveLength(1);
    const candidate = candidates[0];
    expect(candidate?.signals.toolHint).toBe(true);
    expect(candidate?.reasons).toContain('tool/library repo');
    expect(candidate?.reasons).not.toContain('75 stars');
    // repo-search hit (+10) minus the tool penalty (-45); no model id, no stars.
    expect(candidate?.score).toBe(-35);
  });
});
