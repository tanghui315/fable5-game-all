/** Append a repository to `data/rejected.yaml` (driven by the `rejected` PR label). */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import {
  RejectedFileSchema,
  RejectedReasonSchema,
  type Rejected,
  type RejectedReason,
} from '@fable5/schema';
import { findRepoRoot } from './enrich.js';
import { parseInputUrl } from './github-url.js';
import { todayIso } from './util.js';

export interface RejectOptions {
  rootDir: string;
  repo?: string | null;
  body?: string | null;
  reason: string;
  note?: string | null;
  now?: Date;
  logger?: (message: string) => void;
}

const GH_URL = /https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/;

/** Extract the first GitHub repository URL from a PR body. */
export function repoUrlFromBody(body: string | null | undefined): string | null {
  if (body === null || body === undefined) return null;
  const match = GH_URL.exec(body);
  return match?.[0]?.replace(/\.git$/i, '') ?? null;
}

export function normalizeReason(value: string): RejectedReason {
  const cleaned = value
    .trim()
    .replace(/^reason\s*:\s*/i, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
  const parsed = RejectedReasonSchema.safeParse(cleaned);
  return parsed.success ? parsed.data : 'not-a-game';
}

function normalizeRepoUrl(value: string): string {
  const parsed = parseInputUrl(value);
  if (parsed.repo !== undefined) {
    return `https://github.com/${parsed.repo.owner}/${parsed.repo.repo}`;
  }
  return value.trim();
}

/** Append (idempotently) one rejection. */
export function rejectFromPr(options: RejectOptions): Rejected | null {
  const log = options.logger ?? ((message: string) => console.log(message));
  const rootDir = findRepoRoot(options.rootDir);
  const repo = options.repo ?? repoUrlFromBody(options.body);
  if (repo === null || repo.trim() === '') {
    throw new Error('no repository URL found (use --repo or a PR body containing a GitHub URL)');
  }
  const url = normalizeRepoUrl(repo);
  const file = path.join(rootDir, 'data', 'rejected.yaml');
  const existingText = (() => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return '';
    }
  })();
  const existingRaw: unknown = existingText.trim() === '' ? [] : parseYaml(existingText);
  const existing = RejectedFileSchema.parse(existingRaw ?? []);
  if (existing.some((item) => item.repo.toLowerCase() === url.toLowerCase())) {
    log(`reject: ${url} is already in data/rejected.yaml`);
    return null;
  }
  const entry: Rejected = {
    repo: url,
    reason: normalizeReason(options.reason),
    ...(options.note !== undefined && options.note !== null && options.note.trim() !== ''
      ? { note: options.note.trim() }
      : {}),
    date: todayIso(options.now),
  };
  RejectedFileSchema.parse([...existing, entry]);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, stringifyYaml([...existing, entry], { lineWidth: 0 }));
  log(`reject: added ${url} (${entry.reason}) to data/rejected.yaml`);
  return entry;
}
