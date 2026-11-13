import { en, type MessageKey } from './en';
import { zh } from './zh';

export type { MessageKey };
export { en, zh };

export type Lang = 'en' | 'zh';

export const LANGS: readonly Lang[] = ['en', 'zh'] as const;

/** BCP 47 tag for `<html lang>` and hreflang. */
export const HTML_LANG: Record<Lang, string> = {
  en: 'en',
  zh: 'zh-CN',
};

const DICTIONARIES: Record<Lang, Record<MessageKey, string>> = { en, zh };

export type MessageParams = Record<string, string | number>;

/** Look up `key` in `lang`, filling `{name}` placeholders from `params`. */
export function t(lang: Lang, key: MessageKey, params?: MessageParams): string {
  let value: string = DICTIONARIES[lang][key];
  if (params) {
    for (const [name, replacement] of Object.entries(params)) {
      value = value.split(`{${name}}`).join(String(replacement));
    }
  }
  return value;
}

/** Switch between the two supported locales. */
export function otherLang(lang: Lang): Lang {
  return lang === 'en' ? 'zh' : 'en';
}

/**
 * Prefix a locale-neutral path (`/g/slug`) for a locale. English is
 * unprefixed; Chinese lives under `/zh/`.
 */
export function localePath(lang: Lang, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (lang === 'en') return clean;
  return clean === '/' ? '/zh/' : `/zh${clean}`;
}

/** Locale-neutral path for a game detail page. */
export function gamePath(slug: string): string {
  return `/g/${slug}`;
}

/** Locale-neutral path for an author page. */
export function authorPath(id: string): string {
  return `/a/${id}`;
}

function lookup(lang: Lang, key: string, fallback: string): string {
  const dictionary = DICTIONARIES[lang] as Record<string, string | undefined>;
  return dictionary[key] ?? fallback;
}

export function kindLabel(lang: Lang, kind: string): string {
  return lookup(lang, `kind.${kind}`, kind);
}

export function controlLabel(lang: Lang, control: string): string {
  return lookup(lang, `control.${control}`, control);
}

export function evidenceName(lang: Lang, level: string): string {
  return lookup(lang, `evidence.${level}`, level);
}

/** Known tag values get a localized label; unknown values pass through. */
export function tagLabel(lang: Lang, tag: string): string {
  return lookup(lang, `tag.${tag}`, tag);
}

/** Known genre values get a localized label; unknown values pass through. */
export function genreLabel(lang: Lang, genre: string): string {
  return lookup(lang, `genre.${genre}`, genre);
}
