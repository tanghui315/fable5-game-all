import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Octokit } from '@octokit/rest';
import {
  candidateBranchName,
  createCandidatePr,
  resolveWriteClient,
  type OctokitLike,
} from '../src/pr.js';

function notFound(): Error & { status: number } {
  return Object.assign(new Error('Not Found'), { status: 404 });
}

function mockClient(
  opts: { existingBranch?: string; openPr?: { number: number; html_url: string } | null } = {},
) {
  let blobIndex = 0;
  const calls = {
    createRef: [] as unknown[],
    blobs: [] as unknown[],
    trees: [] as unknown[],
    commits: [] as unknown[],
    updates: [] as unknown[],
    createLabel: [] as unknown[],
    addLabels: [] as unknown[],
    pullsCreate: [] as unknown[],
    pullsUpdate: [] as unknown[],
  };
  const client = {
    git: {
      getRef: vi.fn(async ({ ref }: { ref: string }) => {
        if (ref === 'heads/main') return { data: { object: { sha: 'base-sha' } } };
        if (ref === `heads/${candidateBranchName('wquguru', 'fable52-fps-repro')}`) {
          if (opts.existingBranch !== undefined) {
            return { data: { object: { sha: opts.existingBranch } } };
          }
          throw notFound();
        }
        throw notFound();
      }),
      createRef: vi.fn(async (params: unknown) => {
        calls.createRef.push(params);
        return { data: {} };
      }),
      getCommit: vi.fn(async () => ({ data: { tree: { sha: 'base-tree-sha' } } })),
      createBlob: vi.fn(async (params: unknown) => {
        calls.blobs.push(params);
        blobIndex += 1;
        return { data: { sha: `blob-${blobIndex}` } };
      }),
      createTree: vi.fn(async (params: unknown) => {
        calls.trees.push(params);
        return { data: { sha: 'new-tree-sha' } };
      }),
      createCommit: vi.fn(async (params: unknown) => {
        calls.commits.push(params);
        return { data: { sha: 'new-commit-sha' } };
      }),
      updateRef: vi.fn(async (params: unknown) => {
        calls.updates.push(params);
        return { data: {} };
      }),
    },
    issues: {
      createLabel: vi.fn(async (params: unknown) => {
        calls.createLabel.push(params);
        return { data: {} };
      }),
      addLabels: vi.fn(async (params: unknown) => {
        calls.addLabels.push(params);
        return { data: {} };
      }),
    },
    pulls: {
      list: vi.fn(async () => ({
        data: opts.openPr === null || opts.openPr === undefined ? [] : [opts.openPr],
      })),
      create: vi.fn(async (params: unknown) => {
        calls.pullsCreate.push(params);
        return { data: { number: 12, html_url: 'https://github.com/fable5/data/pull/12' } };
      }),
      update: vi.fn(async (params: unknown) => {
        calls.pullsUpdate.push(params);
        return { data: {} };
      }),
    },
  } as unknown as Octokit;
  return { client, calls };
}

const files = [
  { path: 'data/games/foo.yaml', content: 'id: foo\n' },
  { path: 'media/foo/cover.webp', content: Buffer.from('webp-bytes') },
];

describe('candidateBranchName', () => {
  it('uses owner--repo', () => {
    expect(candidateBranchName('wquguru', 'fable52-fps-repro')).toBe(
      'candidate/wquguru--fable52-fps-repro',
    );
  });
});

describe('resolveWriteClient', () => {
  it('uses BOT_TOKEN for writes and falls back to the caller client otherwise', () => {
    const fallback = {} as OctokitLike;
    expect(resolveWriteClient(fallback, {})).toBe(fallback);
    expect(resolveWriteClient(fallback, { BOT_TOKEN: '   ' })).toBe(fallback);
    expect(resolveWriteClient(fallback, { BOT_TOKEN: 'bot-token' })).not.toBe(fallback);
  });
});

describe('createCandidatePr', () => {
  beforeEach(() => {
    vi.stubEnv('BOT_TOKEN', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates a branch, commits drafts through the Git data API and opens a PR', async () => {
    const { client, calls } = mockClient();
    const result = await createCandidatePr({
      client,
      owner: 'wquguru',
      repo: 'fable52-fps-repro',
      branch: candidateBranchName('wquguru', 'fable52-fps-repro'),
      files,
      title: 'Candidate: wquguru/fable52-fps-repro',
      body: 'review body',
      labels: ['candidate', 'evidence:L2', 'kind:game'],
    });

    expect(result).toMatchObject({ number: 12, created: true, commitSha: 'new-commit-sha' });
    expect(calls.createRef).toHaveLength(1);
    expect(calls.blobs).toHaveLength(2);
    expect((calls.blobs[1] as { content: string }).content).toBe(
      Buffer.from('webp-bytes').toString('base64'),
    );
    expect(calls.trees).toHaveLength(1);
    expect((calls.trees[0] as { base_tree: string }).base_tree).toBe('base-tree-sha');
    expect((calls.commits[0] as { parents: string[] }).parents).toEqual(['base-sha']);
    expect((calls.updates[0] as { sha: string }).sha).toBe('new-commit-sha');
    expect(calls.createLabel).toHaveLength(3);
    expect((calls.pullsCreate[0] as { head: string }).head).toBe(
      'candidate/wquguru--fable52-fps-repro',
    );
    expect((calls.addLabels[0] as { labels: string[] }).labels).toEqual([
      'candidate',
      'evidence:L2',
      'kind:game',
    ]);
  });

  it('updates the existing candidate branch and PR instead of opening a duplicate', async () => {
    const { client, calls } = mockClient({
      existingBranch: 'existing-head',
      openPr: { number: 7, html_url: 'https://github.com/fable5/data/pull/7' },
    });
    const result = await createCandidatePr({
      client,
      owner: 'wquguru',
      repo: 'fable52-fps-repro',
      branch: candidateBranchName('wquguru', 'fable52-fps-repro'),
      files,
      title: 'Candidate: updated',
      body: 'updated body',
      labels: ['candidate'],
    });

    expect(result).toMatchObject({ number: 7, created: false });
    expect(calls.createRef).toHaveLength(0);
    expect((calls.commits[0] as { parents: string[] }).parents).toEqual(['existing-head']);
    expect(calls.pullsCreate).toHaveLength(0);
    expect((calls.pullsUpdate[0] as { pull_number: number }).pull_number).toBe(7);
    expect((calls.addLabels[0] as { issue_number: number }).issue_number).toBe(7);
  });

  it('sends branch and PR writes through writeClient when provided', async () => {
    const reader = mockClient();
    const writer = mockClient();
    const result = await createCandidatePr({
      client: reader.client,
      writeClient: writer.client,
      owner: 'wquguru',
      repo: 'fable52-fps-repro',
      branch: candidateBranchName('wquguru', 'fable52-fps-repro'),
      files,
      title: 'Candidate: write token',
      body: 'review body',
      labels: ['candidate'],
    });

    expect(result).toMatchObject({ number: 12, created: true });
    expect(reader.calls.createRef).toHaveLength(0);
    expect(reader.calls.pullsCreate).toHaveLength(0);
    expect(writer.calls.createRef).toHaveLength(1);
    expect(writer.calls.commits).toHaveLength(1);
    expect(writer.calls.pullsCreate).toHaveLength(1);
  });
});
