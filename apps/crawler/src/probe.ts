/** Playwright probe: reachability, framing headers, cover screenshot, diagnostics. */

import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import sharp from 'sharp';
import type { ProbeConfig } from './config.js';
import { parseEmbeddable } from './embeddable.js';
import { hostOf } from './util.js';

export interface ProbeResult {
  url: string;
  reachable: boolean;
  status: number | null;
  embeddable: boolean;
  embedReason: string;
  title: string | null;
  coverWebp: Buffer;
  coverBytes: number;
  consoleErrors: string[];
  externalHosts: string[];
  elapsedMs: number;
  error: string | null;
}

const SWIFTSHADER_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-dev-shm-usage',
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Playwright's bundled browser revision may be missing in a local cache
 * (e.g. the package was upgraded without `playwright install`). Fall back to
 * any Chromium build already present instead of failing the whole run.
 */
export function findChromiumExecutable(): string | undefined {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (explicit !== undefined && explicit !== '' && existsSync(explicit)) return explicit;

  let defaultPath: string | undefined;
  try {
    defaultPath = chromium.executablePath();
  } catch {
    defaultPath = undefined;
  }
  if (defaultPath !== undefined && existsSync(defaultPath)) return undefined;

  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    ...(process.platform === 'darwin'
      ? [path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')]
      : [path.join(os.homedir(), '.cache', 'ms-playwright')]),
  ].filter((root): root is string => typeof root === 'string' && root !== '');

  const relatives = [
    [
      'chrome-mac-arm64',
      'Google Chrome for Testing.app',
      'Contents',
      'MacOS',
      'Google Chrome for Testing',
    ],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
    ['chrome-linux', 'chrome'],
    ['chrome-linux64', 'chrome'],
    ['chrome-headless-shell-linux64', 'chrome-headless-shell'],
  ];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    const revisions = readdirSync(root)
      .map((name) => /^chromium-(\d+)$/.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .sort((a, b) => Number(b[1]) - Number(a[1]));
    for (const revision of revisions) {
      for (const relative of relatives) {
        const candidate = path.join(root, revision[0], ...relative);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

let cachedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (cachedBrowser !== null && cachedBrowser.isConnected()) return cachedBrowser;
  const executablePath = findChromiumExecutable();
  cachedBrowser = await chromium.launch({
    headless: true,
    ...(executablePath !== undefined ? { executablePath } : {}),
    args: SWIFTSHADER_ARGS,
  });
  return cachedBrowser;
}

export async function closeBrowser(): Promise<void> {
  if (cachedBrowser !== null) {
    await cachedBrowser.close().catch(() => undefined);
    cachedBrowser = null;
  }
}

export interface ScreenshotStats {
  mean: number;
  stdDev: number;
  nonBlack: boolean;
  /** Higher means more visual content; used to pick the best frame. */
  score: number;
}

/** Brightness/contrast statistics used to wait past loading screens. */
export async function screenshotStats(image: Buffer): Promise<ScreenshotStats> {
  try {
    const { data, info } = await sharp(image)
      .resize(160, 100, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels < 1 || data.length === 0) {
      return { mean: 0, stdDev: 0, nonBlack: false, score: 0 };
    }
    let sum = 0;
    let sumSq = 0;
    for (const value of data) {
      sum += value;
      sumSq += value * value;
    }
    const mean = sum / data.length;
    const variance = Math.max(sumSq / data.length - mean * mean, 0);
    const stdDev = Math.sqrt(variance);
    // A tiny amount of text on an otherwise black loading screen is not a
    // rendered game; require either a brighter frame or real contrast.
    const nonBlack = mean > 10 || stdDev > 12;
    return { mean, stdDev, nonBlack, score: mean + stdDev * 1.5 };
  } catch {
    return { mean: 0, stdDev: 0, nonBlack: false, score: 0 };
  }
}

/** Rough "has something been rendered" test used to wait past a black canvas. */
export async function isNonBlackScreenshot(image: Buffer): Promise<boolean> {
  return (await screenshotStats(image)).nonBlack;
}

/** Encode a cover as WebP, lowering quality until it fits the size cap. */
export async function encodeCover(
  screenshot: Buffer,
  config: ProbeConfig,
  quality = config.cover_quality,
): Promise<Buffer> {
  let current = quality;
  for (;;) {
    const webp = await sharp(screenshot)
      .resize(config.viewport_width, config.viewport_height, { fit: 'fill' })
      .webp({ quality: current, effort: 4 })
      .toBuffer();
    if (webp.length <= config.cover_max_bytes || current <= 5) return webp;
    current = Math.max(current - 12, 5);
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Neutral placeholder cover used when the probe cannot render the entry. */
export async function makeFallbackCover(
  title: string,
  config: ProbeConfig,
  reason = 'entry could not be rendered',
): Promise<Buffer> {
  const width = config.viewport_width;
  const height = config.viewport_height;
  const safeTitle = escapeXml(title.slice(0, 60));
  const safeReason = escapeXml(reason.slice(0, 80));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#0F1320"/>
    <text x="80" y="${height / 2 - 20}" fill="#DCDFE8" font-family="Helvetica, Arial, sans-serif" font-size="52" font-weight="700">${safeTitle}</text>
    <text x="80" y="${height / 2 + 40}" fill="#8C9BFF" font-family="Helvetica, Arial, sans-serif" font-size="24">${safeReason}</text>
  </svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return encodeCover(png, config, 75);
}

interface ProbeOptions {
  config: ProbeConfig;
  /** Extra wait after the first non-black frame (ms). */
  settleMs?: number;
}

/** Probe one playable URL. Never throws; failures are reported in the result. */
export async function probeEntry(url: string, options: ProbeOptions): Promise<ProbeResult> {
  const started = Date.now();
  const { config } = options;
  const consoleErrors: string[] = [];
  const externalHosts = new Set<string>();
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cover = await makeFallbackCover(new URL(url).pathname, config, 'browser launch failed');
    return {
      url,
      reachable: false,
      status: null,
      embeddable: false,
      embedReason: 'probe launch failed',
      title: null,
      coverWebp: cover,
      coverBytes: cover.length,
      consoleErrors: [],
      externalHosts: [],
      elapsedMs: Date.now() - started,
      error: message,
    };
  }

  const context = await browser.newContext({
    viewport: { width: config.viewport_width, height: config.viewport_height },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const mainHost = hostOf(url);

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (consoleErrors.length < 50) consoleErrors.push(message.text().slice(0, 500));
  });
  page.on('pageerror', (error) => {
    if (consoleErrors.length < 50) consoleErrors.push(`pageerror: ${error.message}`.slice(0, 500));
  });
  page.on('request', (request) => {
    const requestUrl = request.url();
    if (!/^https?:/i.test(requestUrl)) return;
    const host = hostOf(requestUrl);
    if (host !== null && host !== mainHost) externalHosts.add(host);
  });

  let responseStatus: number | null = null;
  let headers: Record<string, string | undefined> = {};
  let reachable = false;
  let errorMessage: string | null = null;
  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: config.navigation_timeout_ms,
    });
    responseStatus = response?.status() ?? null;
    headers = response?.headers() ?? {};
    reachable = responseStatus !== null && responseStatus >= 200 && responseStatus < 400;
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  let screenshot: Buffer | null = null;
  if (reachable) {
    await sleep(config.min_render_wait_ms);
    const deadline = Date.now() + config.max_render_wait_ms;
    let firstContentAt: number | null = null;
    let best: { image: Buffer; score: number } | null = null;
    let lastImage: Buffer | null = null;
    let lastWasNonBlack = false;
    while (Date.now() < deadline) {
      const image = await page.screenshot({ type: 'png', timeout: 10_000 }).catch(() => null);
      if (image !== null) {
        lastImage = image;
        const stats = await screenshotStats(image);
        lastWasNonBlack = stats.nonBlack;
        if (stats.nonBlack) {
          if (firstContentAt === null) firstContentAt = Date.now();
          if (best === null || stats.score > best.score) best = { image, score: stats.score };
        }
      }
      // Keep sampling briefly after the first rendered frame so a loading or
      // fade-in screen does not win over the actual scene.
      if (firstContentAt !== null && Date.now() - firstContentAt >= 2_000) break;
      await sleep(600);
    }
    screenshot = best?.image ?? (lastWasNonBlack ? lastImage : null);
    if (screenshot !== null && (options.settleMs ?? 0) > 0) {
      await sleep(options.settleMs ?? 0);
      screenshot = await page.screenshot({ type: 'png', timeout: 10_000 }).catch(() => screenshot);
    }
  }

  const title = await page.title().catch(() => null);
  const verdict = parseEmbeddable(headers);
  await context.close().catch(() => undefined);

  const cover =
    screenshot !== null
      ? await encodeCover(screenshot, config)
      : await makeFallbackCover(
          title ?? new URL(url).pathname,
          config,
          errorMessage ?? 'not rendered',
        );
  const finalTitle = title !== null && title.trim() !== '' ? title.trim() : null;

  return {
    url,
    reachable,
    status: responseStatus,
    embeddable: reachable ? verdict.embeddable : false,
    embedReason: reachable ? verdict.reason : (errorMessage ?? 'unreachable'),
    title: finalTitle,
    coverWebp: cover,
    coverBytes: cover.length,
    consoleErrors,
    externalHosts: [...externalHosts].sort(),
    elapsedMs: Date.now() - started,
    error: errorMessage,
  };
}
