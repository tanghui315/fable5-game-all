import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to `apps/site`. */
export const APP_DIR = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/** Absolute path to the repository root (`apps/site` is two levels down). */
export const REPO_ROOT = path.resolve(APP_DIR, '..', '..');

/**
 * Resolve the data tree to build from.
 *
 * Defaults to the repository root (`data/`, `media/`). `DATA_ROOT` may be an
 * absolute path or a path relative to the repository root, which makes it easy
 * to build against fixtures:
 *
 *   DATA_ROOT=packages/schema/test/fixtures/valid pnpm --filter site build
 */
export function resolveDataRoot() {
  const raw = process.env.DATA_ROOT?.trim();
  if (!raw) return REPO_ROOT;
  return path.isAbsolute(raw) ? raw : path.resolve(REPO_ROOT, raw);
}
