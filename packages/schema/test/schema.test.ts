import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GameSchema, loadData, parseAuthorYaml, parseGameYaml, parseRejectedYaml } from '../src/index';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('schema', () => {
  it('parses the example game', () => {
    const game = parseGameYaml(`
id: wquguru--fable52-fps-repro--04-fps
slug: sublevel-07
kind: game
status: published
title: { zh: SUBLEVEL 07, en: SUBLEVEL 07 }
summary: { zh: 单文件 FPS, en: Single-file FPS }
author: wquguru
play: { url: "https://example.com/game/", embeddable: true, mirror_url: null }
media: { cover: media/x/cover.webp }
genre: shooter
tags: [fps]
controls: [keyboard, mouse]
mobile: false
model: { name: fable-5.2, evidence: L3 }
generation: { turns: 73, cost_usd: 15.96, runs: 2 }
source: { discovered_by: seed, discovered_at: 2026-11-12 }
`);

    expect(game.id).toBe('wquguru--fable52-fps-repro--04-fps');
    expect(game.slug).toBe('sublevel-07');
    expect(game.controls).toEqual(['keyboard', 'mouse']);
    expect(game.model.evidence).toBe('L3');
    expect(game.generation?.runs).toBe(2);
    // Unquoted YAML dates stay strings under the YAML 1.2 core schema.
    expect(game.source.discovered_at).toBe('2026-11-12');
  });

  it('rejects a malformed game id with a field path', () => {
    const result = GameSchema.safeParse({
      id: 'Not An Id',
      slug: 'ok-slug',
      kind: 'game',
      status: 'published',
      title: { zh: '标题', en: 'Title' },
      summary: { zh: '简介', en: 'Summary' },
      author: 'wquguru',
      play: { url: 'https://example.com/', embeddable: true },
      media: { cover: 'media/x/cover.webp' },
      genre: 'puzzle',
      tags: [],
      controls: [],
      mobile: false,
      model: { name: 'fable-5.2', evidence: 'L1' },
      source: { discovered_by: 'manual', discovered_at: '2026-11-12' },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['id']);
    }
  });

  it('requires English copy for title and summary', () => {
    const result = GameSchema.safeParse({
      id: 'owner--repo--entry',
      slug: 'no-english',
      kind: 'game',
      status: 'published',
      title: { zh: '标题' },
      summary: { zh: '简介' },
      author: 'wquguru',
      play: { url: 'https://example.com/', embeddable: true },
      media: { cover: 'media/x/cover.webp' },
      genre: 'puzzle',
      tags: [],
      controls: [],
      mobile: false,
      model: { name: 'fable-5.2', evidence: 'L1' },
      source: { discovered_by: 'manual', discovered_at: '2026-11-12' },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('title.en');
      expect(paths).toContain('summary.en');
    }
  });

  it('defaults author.claimed to false', () => {
    const author = parseAuthorYaml('id: someone\nname: someone\n');
    expect(author.claimed).toBe(false);
  });

  it('parses an empty rejected list', () => {
    expect(parseRejectedYaml('[]')).toEqual([]);
  });

  it('loads a data tree', () => {
    const data = loadData(path.join(here, 'fixtures', 'valid'));
    expect(data.games).toHaveLength(1);
    expect(data.authors).toHaveLength(1);
    expect(data.generated.repos['https://github.com/wquguru/fable52-fps-repro']?.stars).toBe(42);
    expect(data.generated.health[data.games[0]!.play.url]?.status).toBe('ok');
  });

  it('treats missing data dirs as empty', () => {
    const data = loadData(path.join(here, 'fixtures', 'empty'));
    expect(data).toEqual({
      authors: [],
      games: [],
      rejected: [],
      generated: { repos: {}, health: {} },
    });
  });
});
