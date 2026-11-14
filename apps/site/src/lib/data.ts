import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  loadData,
  type Author,
  type Control,
  type Game,
  type HealthRecord,
  type RepoRecord,
} from '@fable5/schema';
import { resolveDataRoot } from './data-root.mjs';
import { t, tagLabel, type Lang } from '../i18n';

export const DATA_ROOT = resolveDataRoot();

export const SITE_URL = 'https://stubhall.com';
export const GITHUB_REPO = 'https://github.com/tanghui315/fable5-game-all';
export const SUBMIT_URL = `${GITHUB_REPO}/issues/new?template=submit-game.yml`;
export const TAKEDOWN_URL = `${GITHUB_REPO}/issues/new?template=takedown.yml`;

/** Shown when an entry references media the build cannot find. */
const COVER_PLACEHOLDER = '/cover-placeholder.svg';

/** True when a site-relative media URL has a file under the data root. */
function mediaFileExists(url: string): boolean {
  if (!url.startsWith('/media/')) return true;
  return existsSync(path.join(DATA_ROOT, url.slice(1)));
}

export interface GameView {
  game: Game;
  author: Author | null;
  health: HealthRecord | null;
  repoStats: RepoRecord | null;
  /** Site-relative URL, e.g. `/media/<id>/cover.webp`, or an absolute URL. */
  coverUrl: string;
  previewUrl: string | null;
  isBroken: boolean;
  embeddable: boolean;
  /** `YYYY-MM-DD` used for "最新" sorting and the featured pick. */
  date: string;
}

export interface SiteData {
  authors: Author[];
  games: GameView[];
  /** `data/featured.yaml`: ordered game ids for the home hero. */
  featured: string[];
  bySlug: Map<string, GameView>;
  byId: Map<string, GameView>;
  authorById: Map<string, Author>;
}

let cached: SiteData | undefined;

export function getSiteData(): SiteData {
  if (cached) return cached;
  const { authors, games, generated, featured } = loadData(DATA_ROOT);
  const authorById = new Map(authors.map((author) => [author.id, author]));
  const views: GameView[] = games.map((game) => {
    const health = generated.health[game.play.url] ?? null;
    const repoStats = game.repo ? (generated.repos[game.repo.url] ?? null) : null;
    const cover = mediaUrl(game.media.cover);
    const preview = mediaUrl(game.media.preview);
    return {
      game,
      author: authorById.get(game.author) ?? null,
      health,
      repoStats,
      coverUrl: cover && mediaFileExists(cover) ? cover : COVER_PLACEHOLDER,
      previewUrl: preview && mediaFileExists(preview) ? preview : null,
      isBroken: health?.status === 'broken',
      embeddable: game.play.embeddable,
      date: game.source.published_at ?? game.source.discovered_at,
    };
  });
  views.sort(
    (a, b) =>
      b.date.localeCompare(a.date) || a.game.title.en.localeCompare(b.game.title.en, 'en'),
  );
  cached = {
    authors,
    games: views,
    featured,
    bySlug: new Map(views.map((view) => [view.game.slug, view])),
    byId: new Map(views.map((view) => [view.game.id, view])),
    authorById,
  };
  return cached;
}

/** Data media paths are relative to the data root (`media/<id>/cover.webp`). */
export function mediaUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const clean = value.replace(/^\.?\//, '');
  return clean.startsWith('media/') ? `/${clean}` : `/media/${clean}`;
}

/** Lists (home, author, related) hide archived entries and broken links. */
export function isListed(view: GameView): boolean {
  return view.game.status === 'published' && !view.isBroken;
}

export function listedGames(): GameView[] {
  return getSiteData().games.filter(isListed);
}

export function byLatest(a: GameView, b: GameView): number {
  return b.date.localeCompare(a.date) || a.game.title.en.localeCompare(b.game.title.en, 'en');
}

export function latestGames(): GameView[] {
  return listedGames().sort(byLatest);
}

/** How many receipt fields a generation must publish to anchor the hero. */
const HERO_RECEIPT_FIELDS = ['turns', 'cost_usd', 'duration_min'] as const;

/** Number of published receipt fields (0–3). */
function receiptFields(view: GameView): number {
  const generation = view.game.generation;
  if (!generation) return 0;
  return HERO_RECEIPT_FIELDS.filter((field) => generation[field] !== undefined).length;
}

/** The featured hero: the most recent listed game with real cover art and a
    receipt worth showing — at least two of turns / cost / duration. Ties on
    date go to the fuller receipt. Falls back progressively. */
export function featuredGame(): GameView | null {
  const listed = listedGames();
  const gamesOnly = listed.filter((view) => view.game.kind === 'game');
  const documented = gamesOnly
    .filter((view) => hasCoverArt(view) && receiptFields(view) >= 2)
    .map((view, index) => ({ view, index }))
    .sort(
      (a, b) =>
        b.view.date.localeCompare(a.view.date) ||
        receiptFields(b.view) - receiptFields(a.view) ||
        a.index - b.index,
    )
    .map(({ view }) => view);
  return (
    documented[0] ??
    gamesOnly.find(hasCoverArt) ??
    gamesOnly[0] ??
    listed[0] ??
    null
  );
}

/** False when the entry references art the build could not find. */
export function hasCoverArt(view: GameView): boolean {
  return view.coverUrl !== COVER_PLACEHOLDER;
}

/** The most slides the hero will rotate through. */
export const HERO_SLIDE_LIMIT = 5;

/** Games the hero may show: real cover art plus an animated preview. */
function heroCandidates(): GameView[] {
  return listedGames()
    .filter(
      (view) =>
        view.game.kind === 'game' && hasCoverArt(view) && view.previewUrl !== null,
    )
    .sort(byLatest);
}

/**
 * Slides for the home hero, in the order `data/featured.yaml` lists them.
 *
 * A curated id is skipped when the entry is archived, broken, hidden or has no
 * preview, so the file can keep listing something that is temporarily down.
 * When fewer than two curated slides survive — or the file is empty — the
 * newest entries with a preview fill the gap. Falls back to `featuredGame()`
 * so a repository with no previews at all still shows a cover.
 */
export function heroSlides(limit = HERO_SLIDE_LIMIT): GameView[] {
  const candidates = heroCandidates();
  const byId = new Map(candidates.map((view) => [view.game.id, view]));
  const chosen: GameView[] = [];
  for (const id of getSiteData().featured) {
    const view = byId.get(id);
    if (view !== undefined && !chosen.includes(view)) chosen.push(view);
  }
  if (chosen.length < 2) {
    const target = Math.max(4, limit);
    for (const view of candidates) {
      if (chosen.length >= target) break;
      if (!chosen.includes(view)) chosen.push(view);
    }
  }
  if (chosen.length > 0) return chosen.slice(0, limit);
  const fallback = featuredGame();
  return fallback === null ? [] : [fallback];
}

export function authorName(view: GameView): string {
  return view.author?.name ?? view.game.author;
}

export function gameTitle(view: GameView, lang: Lang): string {
  return view.game.title[lang] || view.game.title.zh;
}

export function gameSummary(view: GameView, lang: Lang): string {
  return view.game.summary[lang] || view.game.summary.zh;
}

export function controlsLabel(lang: Lang, controls: Control[]): string {
  const separator = lang === 'zh' ? '、' : ', ';
  return controls.map((control) => t(lang, `control.${control}` as const)).join(separator);
}

export function evidenceLabel(
  lang: Lang,
  level: 'L1' | 'L2' | 'L3',
  notes?: string,
): string {
  const name = t(lang, `evidence.${level}` as const);
  return notes
    ? t(lang, 'evidence.labelNotes', { level, name, notes })
    : t(lang, 'evidence.label', { level, name });
}

export function formatMonthDay(value: string | undefined, lang: Lang): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function formatDuration(value: number, lang: Lang): string {
  const amount = new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US', {
    maximumFractionDigits: 1,
  }).format(value);
  return t(lang, 'units.minute', { value: amount });
}

/** One meta line for a cover: author plus turns/cost when published. */
export function cardMeta(view: GameView, lang: Lang): { author: string; extra: string | null } {
  const generation = view.game.generation;
  const extra =
    generation?.turns !== undefined
      ? t(lang, 'common.turns', { turns: generation.turns })
      : generation?.cost_usd !== undefined
        ? formatCost(generation.cost_usd)
        : null;
  return { author: authorName(view), extra };
}

export function tagsFor(games: GameView[], lang: Lang): string[] {
  const counts = new Map<string, number>();
  for (const view of games) {
    for (const tag of view.game.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1] ||
        tagLabel(lang, a[0]).localeCompare(tagLabel(lang, b[0]), lang === 'zh' ? 'zh-CN' : 'en'),
    )
    .map(([tag]) => tag);
}

export function sameRepoGames(view: GameView): GameView[] {
  const repoUrl = view.game.repo?.url;
  if (!repoUrl) return [];
  return listedGames()
    .filter((other) => other.game.id !== view.game.id && other.game.repo?.url === repoUrl)
    .sort(byLatest);
}

export function gamesByAuthor(authorId: string): GameView[] {
  return listedGames()
    .filter((view) => view.game.author === authorId)
    .sort(byLatest);
}
