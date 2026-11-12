import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export interface AiConfig {
  model: string;
  max_tokens: number;
  max_readme_chars: number;
}

export interface ProbeConfig {
  viewport_width: number;
  viewport_height: number;
  cover_max_bytes: number;
  cover_quality: number;
  navigation_timeout_ms: number;
  min_render_wait_ms: number;
  max_render_wait_ms: number;
}

export interface CrawlerConfig {
  ai: AiConfig;
  probe: ProbeConfig;
  limits: { max_entries_per_repo: number };
}

export interface QueryConfig {
  code_search: string[];
  repo_search: string[];
  hn: string[];
}

const DEFAULT_AI: AiConfig = {
  model: 'claude-haiku-5-5',
  max_tokens: 1600,
  max_readme_chars: 8000,
};

const DEFAULT_PROBE: ProbeConfig = {
  viewport_width: 1280,
  viewport_height: 800,
  cover_max_bytes: 150 * 1024,
  cover_quality: 82,
  navigation_timeout_ms: 30_000,
  min_render_wait_ms: 4_000,
  max_render_wait_ms: 25_000,
};

const DEFAULT_LIMITS = { max_entries_per_repo: 20 };

/** Directory containing this module (src/ or dist/). */
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Directory of the crawler package (apps/crawler). */
export const CRAWLER_ROOT = path.resolve(moduleDir, '..');

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asPositiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : fallback;
}

export function readConfig(file = path.join(CRAWLER_ROOT, 'config.yaml')): CrawlerConfig {
  const raw = existsSync(file) ? parseYaml(readFileSync(file, 'utf8')) : null;
  const root = (raw ?? {}) as Record<string, unknown>;
  const aiRaw = (root.ai ?? {}) as Record<string, unknown>;
  const probeRaw = (root.probe ?? {}) as Record<string, unknown>;
  const limitsRaw = (root.limits ?? {}) as Record<string, unknown>;
  const ai: AiConfig = {
    model:
      typeof aiRaw.model === 'string' && aiRaw.model.length > 0 ? aiRaw.model : DEFAULT_AI.model,
    max_tokens: asPositiveInt(aiRaw.max_tokens, DEFAULT_AI.max_tokens),
    max_readme_chars: asPositiveInt(aiRaw.max_readme_chars, DEFAULT_AI.max_readme_chars),
  };
  const probe: ProbeConfig = {
    viewport_width: asPositiveInt(probeRaw.viewport_width, DEFAULT_PROBE.viewport_width),
    viewport_height: asPositiveInt(probeRaw.viewport_height, DEFAULT_PROBE.viewport_height),
    cover_max_bytes: asPositiveInt(probeRaw.cover_max_bytes, DEFAULT_PROBE.cover_max_bytes),
    cover_quality: asPositiveInt(probeRaw.cover_quality, DEFAULT_PROBE.cover_quality),
    navigation_timeout_ms: asPositiveInt(
      probeRaw.navigation_timeout_ms,
      DEFAULT_PROBE.navigation_timeout_ms,
    ),
    min_render_wait_ms: asPositiveInt(
      probeRaw.min_render_wait_ms,
      DEFAULT_PROBE.min_render_wait_ms,
    ),
    max_render_wait_ms: asPositiveInt(
      probeRaw.max_render_wait_ms,
      DEFAULT_PROBE.max_render_wait_ms,
    ),
  };
  return {
    ai,
    probe,
    limits: {
      max_entries_per_repo: asPositiveInt(
        limitsRaw.max_entries_per_repo,
        DEFAULT_LIMITS.max_entries_per_repo,
      ),
    },
  };
}

export function readQueries(file = path.join(CRAWLER_ROOT, 'queries.yaml')): QueryConfig {
  const raw = existsSync(file) ? parseYaml(readFileSync(file, 'utf8')) : null;
  const root = (raw ?? {}) as Record<string, unknown>;
  return {
    code_search: asStringArray(root.code_search),
    repo_search: asStringArray(root.repo_search),
    hn: asStringArray(root.hn),
  };
}
