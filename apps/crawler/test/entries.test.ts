import { describe, expect, it } from 'vitest';
import {
  discoverEntries,
  entryDirectory,
  entryKey,
  entryUrl,
  isHubIndex,
  isPlayableIndexPath,
} from '../src/entries.js';

const demos = [
  'demos/01-audio/index.html',
  'demos/01-audio-1h/index.html',
  'demos/02-materials/index.html',
  'demos/03-models/index.html',
  'demos/04-fps/index.html',
];

describe('index path helpers', () => {
  it('keeps entry indexes and drops vendored/build output', () => {
    expect(isPlayableIndexPath('demos/04-fps/index.html')).toBe(true);
    expect(isPlayableIndexPath('index.html')).toBe(true);
    expect(isPlayableIndexPath('node_modules/pkg/index.html')).toBe(false);
    expect(isPlayableIndexPath('dist/index.html')).toBe(false);
    expect(isPlayableIndexPath('build/index.html')).toBe(false);
    expect(isPlayableIndexPath('vendor/lib/index.html')).toBe(false);
    expect(isPlayableIndexPath('demos/04-fps/game.js')).toBe(false);
  });

  it('derives directories, keys and URLs', () => {
    expect(entryDirectory('demos/04-fps/index.html')).toBe('demos/04-fps');
    expect(entryKey('demos/04-fps', 'repo')).toBe('04-fps');
    expect(entryKey('', 'repo')).toBe('repo');
    expect(entryUrl('https://a.github.io/b/', 'demos/04-fps')).toBe(
      'https://a.github.io/b/demos/04-fps/',
    );
    expect(entryUrl('https://a.github.io/b/', '')).toBe('https://a.github.io/b/');
  });
});

describe('isHubIndex', () => {
  it('detects a hub linking to at least two sub-entries', () => {
    const html = `
      <a href="demos/04-fps/">FPS</a>
      <a href="./demos/01-audio/index.html">Audio</a>`;
    expect(isHubIndex(html, ['demos/04-fps', 'demos/01-audio', 'demos/03-models'])).toBe(true);
    expect(
      isHubIndex('<a href="demos/04-fps/">only one</a>', ['demos/04-fps', 'demos/01-audio']),
    ).toBe(false);
  });
});

describe('discoverEntries', () => {
  const base = {
    owner: 'wquguru',
    repo: 'fable52-fps-repro',
    treePaths: ['index.html', ...demos],
    pagesBase: 'https://wquguru.github.io/fable52-fps-repro/',
  };

  it('finds all five demo entries from a fake tree and maps Pages URLs', () => {
    const entries = discoverEntries({ ...base, rootHtml: null });
    expect(entries.map((entry) => entry.path)).toEqual([
      'demos/01-audio',
      'demos/01-audio-1h',
      'demos/02-materials',
      'demos/03-models',
      'demos/04-fps',
      '',
    ]);
    expect(entries.map((entry) => entry.playUrl)).toContain(
      'https://wquguru.github.io/fable52-fps-repro/demos/04-fps/',
    );
  });

  it('drops a root index.html that is just a hub linking to sub-entries', () => {
    const rootHtml = demos.map((path) => `<a href="${path}">entry</a>`).join('\n');
    const entries = discoverEntries({ ...base, rootHtml });
    expect(entries).toHaveLength(5);
    expect(entries.every((entry) => entry.path !== '')).toBe(true);
  });

  it('keeps a root index.html when it is the only entry', () => {
    const entries = discoverEntries({
      owner: 'a',
      repo: 'b',
      treePaths: ['index.html'],
      pagesBase: 'https://a.github.io/b/',
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe('');
    expect(entries[0]?.playUrl).toBe('https://a.github.io/b/');
  });

  it('uses gh-pages entries and ignores the default branch when Pages serves gh-pages', () => {
    const entries = discoverEntries({
      ...base,
      ghPagesPaths: ['index.html', 'play/index.html'],
      pagesSourceBranch: 'gh-pages',
    });
    expect(entries.map((entry) => entry.path).sort()).toEqual(['', 'play']);
    expect(entries.every((entry) => entry.source === 'gh-pages')).toBe(true);
  });

  it('adds a custom homepage as an entry and dedupes the Pages root', () => {
    const entries = discoverEntries({
      ...base,
      treePaths: ['demos/04-fps/index.html'],
      homepageUrl: 'https://custom.example/game/',
    });
    expect(entries.map((entry) => entry.playUrl)).toEqual([
      'https://wquguru.github.io/fable52-fps-repro/demos/04-fps/',
      'https://custom.example/game/',
    ]);
    const deduped = discoverEntries({
      ...base,
      treePaths: ['demos/04-fps/index.html'],
      homepageUrl: 'https://wquguru.github.io/fable52-fps-repro/demos/04-fps/',
    });
    expect(deduped).toHaveLength(1);
    expect(deduped[0]?.source).toBe('homepage');
  });
});
