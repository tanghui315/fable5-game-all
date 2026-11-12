import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const STYLE_RE = /<style\b([^>]*)>([\s\S]*?)<\/style>/gi;

function walkHtml(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'pagefind') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkHtml(full));
    else if (entry.name.endsWith('.html')) files.push(full);
  }
  return files;
}

function hash(value) {
  return `sha256-${createHash('sha256').update(value, 'utf8').digest('base64')}`;
}

function collectHashes(files) {
  const scripts = new Set();
  const styles = new Set();
  for (const file of files) {
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(SCRIPT_RE)) {
      if (/\ssrc\s*=/i.test(match[1])) continue;
      if (match[2].trim() === '') continue;
      scripts.add(hash(match[2]));
    }
    for (const match of html.matchAll(STYLE_RE)) {
      if (match[2].trim() === '') continue;
      styles.add(hash(match[2]));
    }
  }
  return { scripts: [...scripts], styles: [...styles] };
}

function buildCsp({ scripts, styles }) {
  const scriptSources = ["'self'", ...scripts.map((value) => `'${value}'`), "'wasm-unsafe-eval'"];
  // Pagefind compiles WebAssembly; the hash list covers Astro's inline
  // hydration runtime and the astro-island display rule.
  const styleSources = ["'self'", ...styles.map((value) => `'${value}'`)];
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    `style-src ${styleSources.join(' ')}`,
    "img-src 'self' https: data:",
    "font-src 'self'",
    "connect-src 'self'",
    'frame-src https:',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
  ].join('; ');
}

/**
 * Cloudflare Pages `_headers` needs sha256 hashes for Astro's inline island
 * runtime. The hashes are generated from the final HTML, so they cannot live
 * statically in `public/_headers`; this integration fills the placeholder at
 * `astro:build:done`.
 */
export default function headersIntegration() {
  return {
    name: 'fable5-headers',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const outDir = fileURLToPath(dir);
        const templateFile = path.join(outDir, '_headers');
        const template = readFileSync(templateFile, 'utf8');
        if (!template.includes('__CSP__')) {
          logger.warn('public/_headers has no __CSP__ placeholder; leaving it unchanged');
          return;
        }
        const hashes = collectHashes(walkHtml(outDir));
        const csp = buildCsp(hashes);
        writeFileSync(templateFile, template.replace('__CSP__', csp));
        logger.info(
          `CSP hashes: ${hashes.scripts.length} inline script(s), ${hashes.styles.length} inline style rule(s)`,
        );
      },
    },
  };
}
