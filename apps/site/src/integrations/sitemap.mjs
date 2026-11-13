import { readdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Writes `sitemap-index.xml` + `sitemap-0.xml` and a `robots.txt` that points at
 * them. Cloudflare Pages has no auto-sitemap, and without one the English and
 * Chinese mirrors of every game page are only reachable by crawling.
 *
 * URLs come from the built HTML, so adding a page never needs a second list.
 */
function walkHtml(dir, base = '') {
  const urls = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'pagefind') continue;
    const rel = path.posix.join(base, entry.name);
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      urls.push(...walkHtml(full, rel));
    } else if (entry.name === 'index.html') {
      urls.push(`/${base ? `${base}/` : ''}`);
    } else if (entry.name.endsWith('.html') && entry.name !== '404.html') {
      urls.push(`/${rel}`);
    }
  }
  return urls;
}

/** `/zh/g/x/` ⇄ `/g/x/` — every page has a mirror under the other locale. */
function counterpart(url) {
  return url.startsWith('/zh/') ? url.slice(3) || '/' : url === '/' ? '/zh/' : `/zh${url}`;
}

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function readSitemapIndex(outDir) {
  return readFileSync(path.join(outDir, 'sitemap-index.xml'), 'utf8');
}

export default function sitemapIntegration() {
  return {
    name: 'fable5-sitemap',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const outDir = fileURLToPath(dir);
        const site = 'https://stubhall.com';
        const urls = walkHtml(outDir)
          .filter((url) => !url.startsWith('/pagefind'))
          .sort();

        const entries = urls.map((url) => {
          const other = counterpart(url);
          const alternates = urls.includes(other)
            ? [
                `    <xhtml:link rel="alternate" hreflang="${url.startsWith('/zh/') ? 'zh-CN' : 'en'}" href="${site}${url}"/>`,
                `    <xhtml:link rel="alternate" hreflang="${other.startsWith('/zh/') ? 'zh-CN' : 'en'}" href="${site}${other}"/>`,
                `    <xhtml:link rel="alternate" hreflang="x-default" href="${site}${url.startsWith('/zh/') ? other : url}"/>`,
              ].join('\n')
            : '';
          return [
            '  <url>',
            `    <loc>${escapeXml(site + url)}</loc>`,
            alternates,
            '  </url>',
          ]
            .filter(Boolean)
            .join('\n');
        });

        writeFileSync(
          path.join(outDir, 'sitemap-0.xml'),
          [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
            ...entries,
            '</urlset>',
            '',
          ].join('\n'),
        );
        writeFileSync(
          path.join(outDir, 'sitemap-index.xml'),
          [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            '  <sitemap>',
            `    <loc>${site}/sitemap-0.xml</loc>`,
            '  </sitemap>',
            '</sitemapindex>',
            '',
          ].join('\n'),
        );

        // `/sitemap.xml` is the name people and SEO tools try first; it is the
        // same index, so write both rather than relying on the longer name.
        writeFileSync(path.join(outDir, 'sitemap.xml'), readSitemapIndex(outDir));

        const robots = path.join(outDir, 'robots.txt');
        if (!existsSync(robots)) {
          writeFileSync(
            robots,
            ['User-agent: *', 'Allow: /', '', `Sitemap: ${site}/sitemap-index.xml`, ''].join('\n'),
          );
        }

        logger.info(`sitemap: ${urls.length} url(s)`);
      },
    },
  };
}
