import { describe, expect, it } from 'vitest';
import { GameSchema } from '@fable5/schema';
import { buildGameDraft, gameId, uniqueSlug, type DraftInput } from '../src/draft.js';
import type { EntryReview } from '../src/heuristics.js';

const review: EntryReview = {
  kind: 'game',
  genre: 'shooter',
  tags: ['fps', 'threejs'],
  controls: ['keyboard', 'mouse'],
  mobile: false,
  title: { zh: 'SUBLEVEL 07', en: 'SUBLEVEL 07' },
  summary: { zh: '地下变电站 FPS', en: 'An underground substation FPS.' },
  evidence_level: 'L3',
  evidence_quotes: ['made with Fable 5.2'],
  prompt_url: 'https://github.com/wquguru/fable52-fps-repro/blob/main/prompts/04-fps.md',
  turns: 73,
  cost_usd: 15.96,
  duration_min: 40.8,
  risks: [],
};

function input(overrides: Partial<DraftInput> = {}): DraftInput {
  return {
    owner: 'wquguru',
    repoName: 'fable52-fps-repro',
    repoUrlValue: 'https://github.com/wquguru/fable52-fps-repro',
    license: 'MIT',
    branch: 'main',
    entry: {
      key: '04-fps',
      path: 'demos/04-fps',
      playUrl: 'https://wquguru.github.io/fable52-fps-repro/demos/04-fps/',
      source: 'tree',
    },
    probe: { embeddable: true, coverWebp: Buffer.from('fake-webp') },
    review,
    modelName: 'fable-5.2',
    discoveredBy: 'seed',
    discoveredAt: '2026-11-12',
    reservedSlugs: new Set<string>(),
    ownerProfile: { avatar: 'https://github.com/wquguru.png' },
    ...overrides,
  };
}

describe('buildGameDraft', () => {
  it('produces a draft that passes GameSchema with the expected ids and paths', () => {
    const draft = buildGameDraft(input());
    expect(() => GameSchema.parse(draft.game)).not.toThrow();
    expect(draft.id).toBe('wquguru--fable52-fps-repro--04-fps');
    expect(draft.slug).toBe('sublevel-07');
    expect(draft.game.repo).toEqual({
      url: 'https://github.com/wquguru/fable52-fps-repro',
      path: 'demos/04-fps',
      license: 'MIT',
    });
    expect(draft.game.media.cover).toBe('media/wquguru--fable52-fps-repro--04-fps/cover.webp');
    expect(draft.game.play.embeddable).toBe(true);
    expect(draft.game.model).toMatchObject({ name: 'fable-5.2', evidence: 'L3' });
    expect(draft.game.generation).toMatchObject({ turns: 73, cost_usd: 15.96, duration_min: 40.8 });
    expect(draft.author).toMatchObject({ id: 'wquguru', github: 'wquguru', claimed: false });
  });

  it('supports a standalone online entry without a repository', () => {
    const draft = buildGameDraft(
      input({
        owner: 'example-com',
        repoName: 'game',
        repoUrlValue: null,
        license: null,
        entry: {
          key: 'game',
          path: '',
          playUrl: 'https://example.com/game/',
          source: 'online',
        },
      }),
    );
    expect(draft.game.repo).toBeUndefined();
    expect(draft.game.play.url).toBe('https://example.com/game/');
  });

  it('never reuses an existing slug', () => {
    const reserved = new Set(['sublevel-07']);
    const draft = buildGameDraft(input({ reservedSlugs: reserved }));
    expect(draft.slug).toBe('sublevel-07-2');
    expect(uniqueSlug('Sublevel 07', reserved, 'x')).toBe('sublevel-07-3');
  });

  it('keeps ids inside the schema pattern for unusual repo names', () => {
    const draft = buildGameDraft(
      input({
        owner: 'Some.Owner',
        repoName: 'My_Game.v2',
        repoUrlValue: 'https://github.com/Some.Owner/My_Game.v2',
        review: { ...review, title: { zh: '测试游戏' } },
      }),
    );
    expect(draft.id).toBe('some-owner--my-game-v2--04-fps');
    expect(draft.author.id).toBe('some-owner');
    expect(() => GameSchema.parse(draft.game)).not.toThrow();
  });

  it('fills required English copy when the review only has Chinese', () => {
    const draft = buildGameDraft(
      input({
        repoName: 'My_Game.v2',
        review: { ...review, title: { zh: '测试游戏' }, summary: { zh: '一个测试。' } },
      }),
    );
    expect(draft.game.title.en).toBe('04 Fps');
    expect(draft.game.summary.en).toBe('A browser game built with Fable 5.x — 04 Fps.');
    expect(() => GameSchema.parse(draft.game)).not.toThrow();
  });

  it('uses the repository name for English copy when the entry name is not ASCII', () => {
    const draft = buildGameDraft(
      input({
        owner: 'owner',
        repoName: 'wumen-game',
        entry: {
          key: 'root',
          path: '',
          playUrl: 'https://owner.github.io/wumen-game/',
          source: 'tree',
        },
        review: {
          ...review,
          title: { zh: '雾锁山门' },
          summary: { zh: '雾锁山门是一个动作游戏。' },
        },
      }),
    );
    expect(draft.game.title.en).toBe('Wumen Game');
    expect(draft.game.summary.en).toBe('A browser game built with Fable 5.x — Wumen Game.');
  });
});

describe('gameId', () => {
  it('joins lowercase owner, repo and entry segments', () => {
    expect(gameId('Wquguru', 'Fable52', '04-FPS')).toBe('wquguru--fable52--04-fps');
  });
});
