import { describe, expect, it } from 'vitest';
import { reachableEntries } from '../src/enrich.js';
import { buildReviewMarkdown, type ReviewEntry } from '../src/review.js';

/** Minimal review entry; only the fields the report and filter read. */
function entry(reachable: boolean, path: string, playUrl: string): ReviewEntry {
  return {
    entryKey: 'entry',
    path,
    playUrl,
    probe: {
      reachable,
      status: reachable ? 200 : 404,
      embeddable: true,
      embedReason: 'ok',
      consoleErrors: [],
      externalHosts: [],
    },
    review: {
      title: { zh: '测试作品', en: 'Test entry' },
      evidence_level: 'L1',
      evidence_quotes: [],
      risks: [],
    },
    draft: {
      id: 'owner--repo--entry',
      slug: 'entry',
      coverPath: 'media/owner--repo--entry/cover.webp',
      game: { kind: 'game', play: { embeddable: true }, model: { evidence: 'L1' } },
    },
    reviewMode: 'heuristic',
    note: null,
  } as unknown as ReviewEntry;
}

const reachable = entry(true, 'game', 'https://example.com/game/');
const broken = entry(false, 'old', 'https://example.com/old/');

describe('reachableEntries', () => {
  it('keeps only entries the probe reached', () => {
    expect(reachableEntries([reachable, broken])).toEqual([reachable]);
  });

  it('returns nothing when no entry loads', () => {
    expect(reachableEntries([broken])).toEqual([]);
  });
});

describe('buildReviewMarkdown', () => {
  const markdown = buildReviewMarkdown({
    owner: 'owner',
    repo: 'repo',
    repoUrl: 'https://github.com/owner/repo',
    description: null,
    stars: 0,
    license: null,
    entries: [reachable],
    excluded: [broken],
    generatedAt: new Date('2026-01-01T00:00:00Z'),
  });

  it('lists excluded entries with their status', () => {
    expect(markdown).toContain('## 已排除');
    expect(markdown).toContain('`old` · `https://example.com/old/` · HTTP 404');
  });

  it('keeps excluded entries out of the table', () => {
    expect(markdown).toContain('| `entry` |');
    expect(markdown).not.toContain('| `old` |');
  });
});
