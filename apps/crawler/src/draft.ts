/** Turn review + probe results into schema-valid YAML drafts and media bytes. */

import {
  AuthorSchema,
  GameSchema,
  type Author,
  type DiscoveredBy,
  type Game,
} from '@fable5/schema';
import type { PlayableEntry } from './entries.js';
import type { EntryReview } from './heuristics.js';
import type { ProbeResult } from './probe.js';
import { todayIso, hasLatinScript, humanizeIdentifier, idSegment, slugify } from './util.js';

export interface DraftInput {
  owner: string;
  repoName: string;
  repoUrlValue: string | null;
  license: string | null;
  branch: string;
  entry: PlayableEntry;
  probe: Pick<ProbeResult, 'embeddable' | 'coverWebp'>;
  review: EntryReview;
  modelName: string;
  discoveredBy: DiscoveredBy;
  discoveredAt?: string;
  /** Slugs already present in `data/games`, plus slugs claimed in this batch. */
  reservedSlugs: Set<string>;
  ownerProfile?: {
    name?: string | null;
    avatar?: string | null;
    blog?: string | null;
    twitter?: string | null;
  };
}

export interface GameDraft {
  game: Game;
  author: Author;
  id: string;
  slug: string;
  coverPath: string;
  coverBytes: Buffer;
}

export function gameId(owner: string, repo: string, entryKey: string): string {
  return `${idSegment(owner)}--${idSegment(repo)}--${idSegment(entryKey)}`;
}

export function uniqueSlug(preferred: string, reserved: Set<string>, fallback: string): string {
  const base = slugify(preferred, slugify(fallback, 'game'));
  let candidate = base;
  let suffix = 2;
  while (reserved.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  reserved.add(candidate);
  return candidate;
}

function validUrlOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function buildAuthor(input: DraftInput): Author {
  const id = idSegment(input.owner);
  const profile = input.ownerProfile ?? {};
  const author = {
    id,
    name: profile.name?.trim() || input.owner,
    github: input.owner,
    x: profile.twitter?.trim() || null,
    website: validUrlOrNull(profile.blog),
    avatar: validUrlOrNull(profile.avatar) ?? `https://github.com/${input.owner}.png`,
    claimed: false,
  };
  const result = AuthorSchema.safeParse(author);
  if (!result.success) {
    // A malformed optional profile field must not block the draft.
    return AuthorSchema.parse({
      id,
      name: input.owner,
      github: input.owner,
      x: null,
      website: null,
      avatar: `https://github.com/${input.owner}.png`,
      claimed: false,
    });
  }
  return result.data;
}

export function buildGameDraft(input: DraftInput): GameDraft {
  const { entry, review } = input;
  const id = gameId(input.owner, input.repoName, entry.key);
  const slug = uniqueSlug(review.title.en ?? review.title.zh, input.reservedSlugs, entry.key);
  const generationValues = {
    ...(review.prompt_url !== undefined ? { prompt_url: review.prompt_url } : {}),
    ...(review.turns !== undefined ? { turns: review.turns } : {}),
    ...(review.cost_usd !== undefined ? { cost_usd: review.cost_usd } : {}),
    ...(review.duration_min !== undefined ? { duration_min: review.duration_min } : {}),
  };
  const generation = Object.keys(generationValues).length > 0 ? generationValues : undefined;
  const evidenceNotes =
    review.evidence_quotes.length > 0
      ? `README/描述引用：${review.evidence_quotes.join(' | ')}`.slice(0, 500)
      : undefined;

  // `title.en` and `summary.en` are required by the schema, even when the AI
  // review or the page only produced Chinese copy. Fall back to the entry name /
  // repository name (which are ASCII ids) so a draft always validates.
  const titleEn =
    review.title.en ??
    (hasLatinScript(review.title.zh)
      ? review.title.zh
      : humanizeIdentifier(
          entry.key !== 'root' && hasLatinScript(entry.key) ? entry.key : input.repoName,
        ));
  const summaryEn =
    review.summary.en ??
    (hasLatinScript(review.summary.zh)
      ? review.summary.zh
      : `A browser ${review.kind === 'demo' ? 'technical demo' : 'game'} built with Fable 5.x — ${titleEn}.`);

  const game: Game = {
    id,
    slug,
    kind: review.kind === 'not-game' ? 'demo' : review.kind,
    status: 'published',
    title: {
      zh: review.title.zh,
      en: titleEn,
    },
    summary: {
      zh: review.summary.zh,
      en: summaryEn,
    },
    author: idSegment(input.owner),
    ...(input.repoUrlValue !== null
      ? {
          repo: {
            url: input.repoUrlValue,
            ...(entry.path !== '' ? { path: entry.path } : {}),
            ...(input.license !== null ? { license: input.license } : {}),
          },
        }
      : {}),
    play: {
      url: entry.playUrl,
      embeddable: input.probe.embeddable,
      mirror_url: null,
    },
    media: {
      cover: `media/${id}/cover.webp`,
    },
    genre: review.genre,
    tags: review.tags,
    controls: review.controls,
    mobile: review.mobile,
    model: {
      name: input.modelName,
      evidence: review.evidence_level,
      ...(evidenceNotes !== undefined ? { evidence_notes: evidenceNotes } : {}),
    },
    ...(generation !== undefined ? { generation } : {}),
    source: {
      discovered_by: input.discoveredBy,
      discovered_at: input.discoveredAt ?? todayIso(),
    },
  };

  // Fail loudly here rather than in the PR: a draft must always be valid.
  const parsed = GameSchema.parse(game);
  return {
    game: parsed,
    author: buildAuthor(input),
    id,
    slug,
    coverPath: `media/${id}/cover.webp`,
    coverBytes: input.probe.coverWebp,
  };
}
