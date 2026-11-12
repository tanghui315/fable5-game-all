/** `data/_state/seen.json` — repositories the crawler already processed. */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export interface SeenRecord {
  /** `owner/repo` (lowercase). */
  repo: string;
  repo_id?: number;
  /** Last time the crawler ran `enrich` on this repository. */
  last_seen: string;
  /** Repository `pushed_at` at that time; a newer value triggers re-evaluation. */
  pushed_at?: string | null;
  /** Last candidate PR number, when one was opened. */
  last_pr?: number | null;
}

export type SeenFile = Record<string, SeenRecord>;

export function seenFile(rootDir: string): string {
  return path.join(rootDir, 'data', '_state', 'seen.json');
}

export function loadSeen(rootDir: string): SeenFile {
  const file = seenFile(rootDir);
  if (!existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: SeenFile = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
      const record = value as Record<string, unknown>;
      result[key.toLowerCase()] = {
        repo: typeof record.repo === 'string' ? record.repo : key,
        ...(typeof record.repo_id === 'number' ? { repo_id: record.repo_id } : {}),
        last_seen:
          typeof record.last_seen === 'string' ? record.last_seen : new Date(0).toISOString(),
        pushed_at: typeof record.pushed_at === 'string' ? record.pushed_at : null,
        ...(typeof record.last_pr === 'number' ? { last_pr: record.last_pr } : {}),
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function saveSeen(rootDir: string, seen: SeenFile): void {
  const file = seenFile(rootDir);
  mkdirSync(path.dirname(file), { recursive: true });
  const sorted: SeenFile = {};
  for (const key of Object.keys(seen).sort()) {
    const record = seen[key];
    if (record !== undefined) sorted[key] = record;
  }
  writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
}

/** A repository must be re-evaluated only when it was pushed after last processing. */
export function needsReevaluation(
  record: SeenRecord | undefined,
  pushedAt: string | null | undefined,
): boolean {
  if (record === undefined) return true;
  if (pushedAt === null || pushedAt === undefined) return false;
  if (record.pushed_at === null || record.pushed_at === undefined) return true;
  return Date.parse(pushedAt) > Date.parse(record.pushed_at);
}

export function markSeen(
  seen: SeenFile,
  repo: string,
  values: { repo_id?: number; pushed_at?: string | null; last_pr?: number | null },
  now = new Date(),
): SeenFile {
  const key = repo.toLowerCase();
  seen[key] = {
    repo: key,
    ...(values.repo_id !== undefined ? { repo_id: values.repo_id } : {}),
    last_seen: now.toISOString(),
    pushed_at: values.pushed_at ?? null,
    ...(values.last_pr !== undefined && values.last_pr !== null ? { last_pr: values.last_pr } : {}),
  };
  return seen;
}
