/** Small pure helpers shared by the crawler modules. */

export function slugify(input: string, fallback = 'game', maxLength = 60): string {
  const slug = input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (slug === '') return fallback;
  return slug.slice(0, maxLength).replace(/-$/, '');
}

/** `owner` / repo / entry ids may only contain lowercase a-z, 0-9 and dashes. */
export function idSegment(input: string, fallback = 'x'): string {
  const value = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return value === '' ? fallback : value;
}

export function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** URLs are compared without a trailing slash or hash. */
export function normalizeUrl(input: string): string {
  try {
    const url = new URL(input);
    url.hash = '';
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return input.replace(/#.*$/, '').replace(/\/+$/, '');
  }
}

export function withTrailingSlash(input: string): string {
  try {
    const url = new URL(input);
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url.toString();
  } catch {
    return input.endsWith('/') ? input : `${input}/`;
  }
}

/** Hostname without `www.`, for grouping external requests. */
export function hostOf(input: string): string | null {
  try {
    return new URL(input).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Extract the `<title>` of a small HTML document. */
export function extractHtmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (match?.[1] === undefined) return null;
  const title = decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim();
  return title.length > 0 ? title : null;
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

/** First match wins; returns `null` when nothing matches. */
export function firstMatch(text: string, patterns: readonly RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1] !== undefined) return match[1].trim();
  }
  return null;
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}\n…[truncated]`;
}

export function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
