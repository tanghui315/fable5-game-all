import { useCallback, useEffect, useMemo, useState } from 'react';

export interface FilterItem {
  id: string;
  kind: 'game' | 'demo';
  tags: string[];
  controls: string[];
  mobile: boolean;
  stars: number | null;
  date: number;
}

interface FilterState {
  kind: 'game' | 'demo' | 'all';
  tags: string[];
  controls: string[];
  mobileOnly: boolean;
  sort: 'latest' | 'stars';
}

const DEFAULT_STATE: FilterState = {
  kind: 'game',
  tags: [],
  controls: [],
  mobileOnly: false,
  sort: 'latest',
};

const CONTROL_OPTIONS = [
  { value: 'keyboard', label: '键盘' },
  { value: 'mouse', label: '鼠标' },
  { value: 'touch', label: '触屏' },
  { value: 'gamepad', label: '手柄' },
];

function readState(knownTags: string[]): FilterState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  const params = new URLSearchParams(window.location.search);
  const kindParam = params.get('kind');
  const kind = kindParam === 'demo' || kindParam === 'all' ? kindParam : 'game';
  const tags = (params.get('tag') ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '' && knownTags.includes(tag));
  const controls = (params.get('controls') ?? '')
    .split(',')
    .map((control) => control.trim())
    .filter((control) => CONTROL_OPTIONS.some((option) => option.value === control));
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

export default function FilterBar({ items }: { items: FilterItem[] }) {
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
      .map(([tag]) => tag);
  }, [items]);

  const [state, setState] = useState<FilterState>(DEFAULT_STATE);
  const [visibleCount, setVisibleCount] = useState(items.length);

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
      <div className="filter-group" role="group" aria-label="类型">
        <button
          type="button"
          className="chip"
          aria-pressed={state.kind === 'game'}
          onClick={() => update({ kind: 'game' })}
        >
          游戏
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={state.kind === 'demo'}
          onClick={() => update({ kind: 'demo' })}
        >
          技术演示
        </button>
      </div>

      {tags.length > 0 && (
        <div className="filter-group" role="group" aria-label="标签">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="chip"
              aria-pressed={state.tags.includes(tag)}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      <div className="filter-group" role="group" aria-label="操作方式">
        {CONTROL_OPTIONS.map((option) => (
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
          适配手机
        </button>
      </div>

      <label className="filter-sort">
        排序
        <select
          value={state.sort}
          onChange={(event) => update({ sort: event.target.value === 'stars' ? 'stars' : 'latest' })}
        >
          <option value="latest">最新</option>
          <option value="stars">star 数</option>
        </select>
      </label>

      {visibleCount === 0 && (
        <div className="filter-empty" role="status">
          <p>没有符合筛选条件的游戏。</p>
          <button type="button" className="btn btn-ghost" onClick={clear}>
            清除筛选
          </button>
        </div>
      )}
    </div>
  );
}
