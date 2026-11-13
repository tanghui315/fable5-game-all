import { useCallback, useEffect, useMemo, useState } from 'react';

export type Lang = 'en' | 'zh';

export interface FilterItem {
  id: string;
  kind: 'game' | 'demo';
  tags: string[];
  controls: string[];
  mobile: boolean;
  stars: number | null;
  date: number;
}

/** Localized copy handed to the island so it ships no dictionary of its own. */
export interface FilterStrings {
  kindLabel: string;
  all: string;
  game: string;
  demo: string;
  tagsLabel: string;
  moreTags: string;
  fewerTags: string;
  controlsLabel: string;
  mobile: string;
  sort: string;
  latest: string;
  stars: string;
  empty: string;
  clear: string;
  controls: { value: string; label: string }[];
  /** Localized labels keyed by raw tag value; unknown tags fall back to raw. */
  tagLabels: Record<string, string>;
}

interface FilterState {
  kind: 'game' | 'demo' | 'all';
  tags: string[];
  controls: string[];
  mobileOnly: boolean;
  sort: 'latest' | 'stars';
}

const DEFAULT_STATE: FilterState = {
  kind: 'all',
  tags: [],
  controls: [],
  mobileOnly: false,
  sort: 'latest',
};

const CONTROL_VALUES = ['keyboard', 'mouse', 'touch', 'gamepad'];

/** Chips shown before the "More tags" toggle; the rest stay in the DOM. */
const TAG_LIMIT = 8;

function readState(knownTags: string[]): FilterState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  const params = new URLSearchParams(window.location.search);
  const kindParam = params.get('kind');
  const kind =
    kindParam === 'demo' || kindParam === 'game' || kindParam === 'all' ? kindParam : 'all';
  const tags = (params.get('tag') ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '' && knownTags.includes(tag));
  const controls = (params.get('controls') ?? '')
    .split(',')
    .map((control) => control.trim())
    .filter((control) => CONTROL_VALUES.includes(control));
  return {
    kind,
    tags,
    controls,
    mobileOnly: params.get('mobile') === '1',
    sort: params.get('sort') === 'stars' ? 'stars' : 'latest',
  };
}

function writeState(state: FilterState) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams();
  if (state.kind !== DEFAULT_STATE.kind) params.set('kind', state.kind);
  if (state.tags.length > 0) params.set('tag', state.tags.join(','));
  if (state.controls.length > 0) params.set('controls', state.controls.join(','));
  if (state.mobileOnly) params.set('mobile', '1');
  if (state.sort !== DEFAULT_STATE.sort) params.set('sort', state.sort);
  const query = params.toString();
  window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
}

function cardNumber(element: HTMLElement, attribute: string): number {
  const value = Number(element.dataset[attribute]);
  return Number.isFinite(value) ? value : -1;
}

export default function FilterBar({
  items,
  lang,
  strings,
}: {
  items: FilterItem[];
  lang: Lang;
  strings: FilterStrings;
}) {
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    const locale = lang === 'zh' ? 'zh-CN' : 'en';
    return [...counts.entries()]
      .sort(
        (a, b) =>
          b[1] - a[1] ||
          (strings.tagLabels[a[0]] ?? a[0]).localeCompare(
            strings.tagLabels[b[0]] ?? b[0],
            locale,
          ),
      )
      .map(([tag]) => tag);
  }, [items, lang, strings.tagLabels]);

  const [state, setState] = useState<FilterState>(DEFAULT_STATE);
  const [visibleCount, setVisibleCount] = useState(items.length);
  const [tagsExpanded, setTagsExpanded] = useState(false);

  // Top tags plus whatever the URL selected, so a rare active tag never hides
  // behind the "More tags" toggle.
  const pinnedTags = useMemo(() => {
    const pinned = new Set(tags.slice(0, TAG_LIMIT));
    for (const tag of state.tags) pinned.add(tag);
    return pinned;
  }, [tags, state.tags]);
  const pinned = tags.filter((tag) => pinnedTags.has(tag));
  const extraTags = tags.filter((tag) => !pinnedTags.has(tag));
  const showTagToggle = extraTags.length > 0;

  const apply = useCallback((next: FilterState) => {
    const grid = document.querySelector('[data-game-grid]');
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>('[data-game-card]'));
    const visible: HTMLElement[] = [];

    for (const card of cards) {
      const kind = card.dataset.kind ?? '';
      const cardTags = (card.dataset.tags ?? '').split(',').filter(Boolean);
      const cardControls = (card.dataset.controls ?? '').split(',').filter(Boolean);
      const matchesKind = next.kind === 'all' || kind === next.kind;
      const matchesTags = next.tags.length === 0 || next.tags.some((tag) => cardTags.includes(tag));
      const matchesControls =
        next.controls.length === 0 || next.controls.every((control) => cardControls.includes(control));
      const matchesMobile = !next.mobileOnly || card.dataset.mobile === 'true';
      const visibleCard = matchesKind && matchesTags && matchesControls && matchesMobile;
      card.hidden = !visibleCard;
      if (visibleCard) visible.push(card);
    }

    visible.sort((a, b) => {
      if (next.sort === 'stars') {
        const byStars = cardNumber(b, 'stars') - cardNumber(a, 'stars');
        if (byStars !== 0) return byStars;
      }
      return cardNumber(b, 'date') - cardNumber(a, 'date');
    });
    for (const card of visible) grid.append(card);

    setVisibleCount(visible.length);
  }, []);

  // Apply the URL state once the island hydrates (the server-rendered list
  // already contains every entry, so no-JS visitors still see everything).
  useEffect(() => {
    const initial = readState(tags);
    setState(initial);
    apply(initial);
  }, [apply, tags]);

  const update = (patch: Partial<FilterState>) => {
    const next = { ...state, ...patch };
    setState(next);
    writeState(next);
    apply(next);
  };

  const toggleTag = (tag: string) => {
    const selected = state.tags.includes(tag)
      ? state.tags.filter((value) => value !== tag)
      : [...state.tags, tag];
    update({ tags: selected });
  };

  const toggleControl = (control: string) => {
    const selected = state.controls.includes(control)
      ? state.controls.filter((value) => value !== control)
      : [...state.controls, control];
    update({ controls: selected });
  };

  const clear = () => {
    setState(DEFAULT_STATE);
    writeState(DEFAULT_STATE);
    apply(DEFAULT_STATE);
  };

  return (
    <div className="filter-bar">
      <div className="filter-top">
        <div className="filter-group" role="group" aria-label={strings.kindLabel}>
          <button
            type="button"
            className="chip"
            aria-pressed={state.kind === 'all'}
            onClick={() => update({ kind: 'all' })}
          >
            {strings.all}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={state.kind === 'game'}
            onClick={() => update({ kind: 'game' })}
          >
            {strings.game}
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={state.kind === 'demo'}
            onClick={() => update({ kind: 'demo' })}
          >
            {strings.demo}
          </button>
        </div>

        <label className="filter-sort">
          {strings.sort}
          <select
            value={state.sort}
            onChange={(event) => update({ sort: event.target.value === 'stars' ? 'stars' : 'latest' })}
          >
            <option value="latest">{strings.latest}</option>
            <option value="stars">{strings.stars}</option>
          </select>
        </label>
      </div>

      <div className="filter-strip">
        {tags.length > 0 && (
          <div
            className={tagsExpanded ? 'filter-group filter-tags is-expanded' : 'filter-group filter-tags'}
            role="group"
            aria-label={strings.tagsLabel}
          >
            {pinned.map((tag) => (
              <button
                key={tag}
                type="button"
                className="chip"
                aria-pressed={state.tags.includes(tag)}
                onClick={() => toggleTag(tag)}
              >
                {strings.tagLabels[tag] ?? tag}
              </button>
            ))}
            {showTagToggle && (
              <button
                type="button"
                className="chip filter-more"
                aria-expanded={tagsExpanded}
                onClick={() => setTagsExpanded((value) => !value)}
              >
                {tagsExpanded ? strings.fewerTags : strings.moreTags}
              </button>
            )}
            {extraTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="chip chip-extra"
                aria-pressed={state.tags.includes(tag)}
                onClick={() => toggleTag(tag)}
              >
                {strings.tagLabels[tag] ?? tag}
              </button>
            ))}
          </div>
        )}

        {tags.length > 0 && <span className="filter-divider" aria-hidden="true" />}

        <div className="filter-group" role="group" aria-label={strings.controlsLabel}>
          {strings.controls.map((option) => (
            <button
              key={option.value}
              type="button"
              className="chip"
              aria-pressed={state.controls.includes(option.value)}
              onClick={() => toggleControl(option.value)}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            className="chip"
            aria-pressed={state.mobileOnly}
            onClick={() => update({ mobileOnly: !state.mobileOnly })}
          >
            {strings.mobile}
          </button>
        </div>
      </div>

      {visibleCount === 0 && (
        <div className="filter-empty" role="status">
          <p>{strings.empty}</p>
          <button type="button" className="btn btn-ghost" onClick={clear}>
            {strings.clear}
          </button>
        </div>
      )}
    </div>
  );
}
