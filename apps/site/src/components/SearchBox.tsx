import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

interface PagefindResultData {
  url: string;
  excerpt: string;
  meta?: { title?: string };
}

interface PagefindSearchResult {
  data: () => Promise<PagefindResultData>;
}

interface PagefindModule {
  init?: () => Promise<void>;
  search: (query: string) => Promise<{ results: PagefindSearchResult[] }>;
}

let pagefindPromise: Promise<PagefindModule> | null = null;

function loadPagefind(): Promise<PagefindModule> {
  pagefindPromise ??= (async () => {
    // Pagefind writes this module into dist/ after `astro build`.
    const pagefindUrl = '/pagefind/pagefind.js';
    const module = (await import(/* @vite-ignore */ pagefindUrl)) as PagefindModule;
    await module.init?.();
    return module;
  })();
  return pagefindPromise;
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

export default function SearchBox() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PagefindResultData[] | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [searched, setSearched] = useState('');
  const debounceRef = useRef<number | null>(null);
  const requestRef = useRef(0);

  const runSearch = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      setResults(null);
      setStatus('idle');
      return;
    }
    const requestId = ++requestRef.current;
    setStatus('loading');
    try {
      const pagefind = await loadPagefind();
      const search = await pagefind.search(trimmed);
      const data = await Promise.all(search.results.slice(0, 20).map((result) => result.data()));
      if (requestId !== requestRef.current) return;
      setResults(data);
      setSearched(trimmed);
      setStatus('ready');
      const params = new URLSearchParams(window.location.search);
      params.set('q', trimmed);
      window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    } catch {
      if (requestId !== requestRef.current) return;
      setResults(null);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get('q')?.trim() ?? '';
    if (initial) {
      setQuery(initial);
      void runSearch(initial);
    }
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [runSearch]);

  const onChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    if (value.trim() === '') {
      requestRef.current += 1;
      setResults(null);
      setStatus('idle');
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      void runSearch(value);
    }, 250);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    void runSearch(query);
  };

  return (
    <div className="search-panel">
      <form className="search-field" role="search" onSubmit={onSubmit}>
        <label className="visually-hidden" htmlFor="search-page-input">
          搜索游戏
        </label>
        <input
          id="search-page-input"
          type="search"
          name="q"
          value={query}
          placeholder="搜索标题、作者或标签"
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="submit" className="btn btn-primary">
          搜索
        </button>
      </form>

      <p className="search-status" role="status" aria-live="polite">
        {status === 'loading' && '正在搜索……'}
        {status === 'idle' && '输入关键词，搜索收录的作品。'}
        {status === 'error' && '搜索索引暂时不可用，可能还没有完成构建。'}
        {status === 'ready' &&
          (results && results.length > 0
            ? `找到 ${results.length} 个结果。`
            : `没有找到与“${searched}”相关的作品。`)}
      </p>

      {status === 'ready' && results && results.length > 0 && (
        <ul className="search-results">
          {results.map((result) => (
            <li key={result.url}>
              <a href={result.url}>
                <span className="search-result-title">{result.meta?.title ?? result.url}</span>
                <span className="search-result-url">{result.url}</span>
                <p
                  className="search-result-excerpt"
                  dangerouslySetInnerHTML={{ __html: result.excerpt }}
                />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
