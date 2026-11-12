import { describe, expect, it } from 'vitest';
import {
  pagesBaseUrl,
  parseGithubPagesUrl,
  parseGithubRepoUrl,
  parseInputUrl,
  repoKey,
} from '../src/github-url.js';

describe('parseGithubRepoUrl', () => {
  it('parses repository URLs, .git suffixes and tree paths', () => {
    expect(parseGithubRepoUrl('https://github.com/wquguru/fable52-fps-repro')).toEqual({
      owner: 'wquguru',
      repo: 'fable52-fps-repro',
    });
    expect(parseGithubRepoUrl('https://github.com/wquguru/repo.git/')).toEqual({
      owner: 'wquguru',
      repo: 'repo',
    });
    expect(parseGithubRepoUrl('https://github.com/wquguru/repo/tree/main/demos/04-fps/')).toEqual({
      owner: 'wquguru',
      repo: 'repo',
      branch: 'main',
      path: 'demos/04-fps',
    });
  });

  it('rejects non-repository GitHub URLs', () => {
    expect(parseGithubRepoUrl('https://github.com/topics/webgl')).toBeNull();
    expect(parseGithubRepoUrl('https://example.com/a/b')).toBeNull();
    expect(parseGithubRepoUrl('not a url')).toBeNull();
  });
});

describe('parseGithubPagesUrl', () => {
  it('maps *.github.io/<repo>/ back to the repository', () => {
    expect(
      parseGithubPagesUrl('https://wquguru.github.io/fable52-fps-repro/demos/04-fps/'),
    ).toEqual({
      owner: 'wquguru',
      repo: 'fable52-fps-repro',
      path: 'demos/04-fps',
    });
    expect(parseGithubPagesUrl('https://wquguru.github.io/fable52-fps-repro/')).toEqual({
      owner: 'wquguru',
      repo: 'fable52-fps-repro',
    });
    expect(parseGithubPagesUrl('https://wquguru.github.io/')).toBeNull();
    expect(parseGithubPagesUrl('https://example.com/fable52')).toBeNull();
  });
});

describe('parseInputUrl', () => {
  it('classifies repo, pages and online URLs', () => {
    expect(parseInputUrl('https://github.com/a/b').kind).toBe('repo');
    expect(parseInputUrl('https://a.github.io/b/x/').kind).toBe('pages');
    expect(parseInputUrl('https://games.example.com/foo')).toEqual({
      kind: 'online',
      original: 'https://games.example.com/foo',
      onlineUrl: 'https://games.example.com/foo',
    });
  });
});

describe('url helpers', () => {
  it('builds stable keys and Pages bases', () => {
    expect(repoKey('Wquguru', 'Repo')).toBe('wquguru/repo');
    expect(pagesBaseUrl('wquguru', 'repo')).toBe('https://wquguru.github.io/repo/');
    expect(pagesBaseUrl('wquguru', 'repo', 'https://custom.example/base')).toBe(
      'https://custom.example/base/',
    );
  });
});
