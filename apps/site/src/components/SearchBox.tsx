import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

export type Lang = 'en' | 'zh';

/** Localized copy handed to the island so it ships no dictionary of its own. */
export interface SearchStrings {
  inputLabel: string;
  placeholder: string;
  submit: string;
  loading: string;
  idle: string;
  error: string;
  found: string;
  none: string;
}

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

function fill(template: string, values: Record<string, string | number>): string {
  let result = template;
  for (const [name, value] of Object.entries(values)) {
    result = result.split(`{${name}}`).join(String(value));
  }
  return result;
}

type Status = 'idle' | 'loading' | 'ready' | 'error';

export default function SearchBox({ lang, strings }: { lang: Lang; strings: SearchStrings }) {
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
      // Pagefind keeps one index per `<html lang>` and `init()` selects the
      // index matching the current document, so this island only ever searches
      // the language of the page it is rendered on.
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
    <div className="search-panel" data-lang={lang}>
      <form className="search-field" role="search" onSubmit={onSubmit}>
        <label className="visually-hidden" htmlFor="search-page-input">
          {strings.inputLabel}
        </label>
        <input
          id="search-page-input"
          type="search"
          name="q"
          value={query}
          placeholder={strings.placeholder}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="submit" className="btn btn-primary">
          {strings.submit}
        </button>
      </form>

      <p className="search-status" role="status" aria-live="polite">
        {status === 'loading' && strings.loading}
        {status === 'idle' && strings.idle}
        {status === 'error' && strings.error}
        {status === 'ready' &&
          (results && results.length > 0
            ? fill(strings.found, { count: results.length })
            : fill(strings.none, { query: searched }))}
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
