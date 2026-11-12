/** Create or update the candidate branch + PR with drafts and media. */

import { Octokit } from '@octokit/rest';
import { repoKey } from './github-url.js';

export type OctokitLike = Octokit;

const WRITE_TIMEOUT_MS = 20_000;

export interface DraftFile {
  /** Repository-relative path, e.g. `data/games/foo.yaml`. */
  path: string;
  content: string | Buffer;
}

export interface CandidatePrInput {
  client: OctokitLike;
  owner: string;
  repo: string;
  baseBranch?: string;
  branch: string;
  files: readonly DraftFile[];
  title: string;
  body: string;
  labels: readonly string[];
  /** Explicit write client; overrides `BOT_TOKEN`. */
  writeClient?: OctokitLike;
}

/**
 * Branch pushes and PR creation need a token that triggers `pull_request`
 * workflows. `GITHUB_TOKEN` does not, so the workflows pass `BOT_TOKEN`
 * (a fine-grained PAT or GitHub App token) for writes. Reads keep using the
 * caller's client, which may be a separate read-only search token.
 */
export function resolveWriteClient(
  fallback: OctokitLike,
  env: NodeJS.ProcessEnv = process.env,
): OctokitLike {
  const token = env.BOT_TOKEN?.trim();
  if (token === undefined || token === '') return fallback;
  return new Octokit({
    auth: token,
    userAgent: 'fable5-game-all-crawler/0.1',
    request: { timeout: WRITE_TIMEOUT_MS },
  });
}

export interface CandidatePrResult {
  number: number;
  url: string;
  branch: string;
  created: boolean;
  commitSha: string;
}

interface ApiError {
  status?: number;
}

function isNotFound(error: unknown): boolean {
  return (error as ApiError).status === 404;
}

function isUnprocessable(error: unknown): boolean {
  return (error as ApiError).status === 422;
}

export function candidateBranchName(owner: string, repo: string): string {
  return `candidate/${repoKey(owner, repo).replace('/', '--')}`;
}

async function refSha(
  client: OctokitLike,
  owner: string,
  repo: string,
  branch: string,
): Promise<string | null> {
  try {
    const { data } = await client.git.getRef({ owner, repo, ref: `heads/${branch}` });
    return data.object.sha;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Commit every draft file to the candidate branch using the Git data API. */
export async function commitDrafts(input: CandidatePrInput): Promise<{
  parentSha: string;
  commitSha: string;
  createdBranch: boolean;
}> {
  const { client, owner, repo } = input;
  const baseBranch = input.baseBranch ?? 'main';
  const baseSha = await refSha(client, owner, repo, baseBranch);
  if (baseSha === null) throw new Error(`base branch ${baseBranch} not found`);

  let parentSha = await refSha(client, owner, repo, input.branch);
  let createdBranch = false;
  if (parentSha === null) {
    await client.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${input.branch}`,
      sha: baseSha,
    });
    parentSha = baseSha;
    createdBranch = true;
  }

  const blobs: Array<{ path: string; sha: string; mode: '100644'; type: 'blob' }> = [];
  for (const file of input.files) {
    const content = Buffer.isBuffer(file.content)
      ? file.content
      : Buffer.from(file.content, 'utf8');
    const { data } = await client.git.createBlob({
      owner,
      repo,
      content: content.toString('base64'),
      encoding: 'base64',
    });
    blobs.push({ path: file.path, sha: data.sha, mode: '100644', type: 'blob' });
  }

  const parentCommit = await client.git.getCommit({ owner, repo, commit_sha: parentSha });
  const tree = await client.git.createTree({
    owner,
    repo,
    base_tree: parentCommit.data.tree.sha,
    tree: blobs,
  });
  const commit = await client.git.createCommit({
    owner,
    repo,
    message: `candidate: ${owner}/${repo}`,
    tree: tree.data.sha,
    parents: [parentSha],
  });
  await client.git.updateRef({
    owner,
    repo,
    ref: `heads/${input.branch}`,
    sha: commit.data.sha,
    force: false,
  });
  return { parentSha, commitSha: commit.data.sha, createdBranch };
}

async function ensureLabels(
  client: OctokitLike,
  owner: string,
  repo: string,
  labels: readonly string[],
): Promise<void> {
  for (const label of labels) {
    try {
      await client.issues.createLabel({ owner, repo, name: label, color: 'ededed' });
    } catch {
      // Existing labels (422) and missing permissions are non-fatal.
    }
  }
}

/**
 * Open a PR for the candidate branch, or update the existing open PR.
 * One repository gets one candidate PR.
 */
export async function createCandidatePr(input: CandidatePrInput): Promise<CandidatePrResult> {
  const { owner, repo } = input;
  const client = input.writeClient ?? resolveWriteClient(input.client);
  const { commitSha } = await commitDrafts({ ...input, client });
  await ensureLabels(client, owner, repo, input.labels);

  const existing = await client.pulls.list({
    owner,
    repo,
    state: 'open',
    head: `${owner}:${input.branch}`,
  });
  const open = existing.data[0];
  if (open !== undefined) {
    await client.pulls.update({
      owner,
      repo,
      pull_number: open.number,
      title: input.title,
      body: input.body,
    });
    await client.issues.addLabels({
      owner,
      repo,
      issue_number: open.number,
      labels: [...input.labels],
    });
    return {
      number: open.number,
      url: open.html_url,
      branch: input.branch,
      created: false,
      commitSha,
    };
  }

  const { data } = await client.pulls.create({
    owner,
    repo,
    head: input.branch,
    base: input.baseBranch ?? 'main',
    title: input.title,
    body: input.body,
    draft: false,
  });
  if (input.labels.length > 0) {
    await client.issues.addLabels({
      owner,
      repo,
      issue_number: data.number,
      labels: [...input.labels],
    });
  }
  return {
    number: data.number,
    url: data.html_url,
    branch: input.branch,
    created: true,
    commitSha,
  };
}
