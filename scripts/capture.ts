#!/usr/bin/env node
/**
 * Capture a cover still and an animated preview for a playable demo.
 *
 * Usage:
 *   pnpm exec tsx scripts/capture.ts <url> <outDir> [options]
 *
 * Options:
 *   --width <px>      viewport width for capture (default 1280)
 *   --height <px>     viewport height for capture (default 800)
 *   --seconds <s>     preview length in seconds (default 5)
 *   --fps <n>         preview frame rate (default 10)
 *   --wait <ms>       max time to wait for non-black pixels (default 20000)
 *   --headful         run a headful browser (default headless)
 *   --keep-frames     keep the temporary PNG frames next to the output
 *
 * Writes `<outDir>/cover.webp` (<=150 KB, 1280x800) and
 * `<outDir>/preview.webp` (<=1 MB, 640x400 animated WebP).
 *
 * Playwright and sharp resolve from apps/crawler's node_modules when they are
 * not available from the repository root.
 */
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const requireFromCrawler = createRequire(new URL('../apps/crawler/package.json', import.meta.url));

type Sharp = typeof import('sharp');

async function loadPlaywright(): Promise<typeof import('playwright')> {
  try {
    return await import('playwright');
  } catch {
    return requireFromCrawler('playwright') as typeof import('playwright');
  }
}

interface Options {
  url: string;
  outDir: string;
  width: number;
  height: number;
  seconds: number;
  fps: number;
  waitMs: number;
  headless: boolean;
  keepFrames: boolean;
}

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const options: Options = {
    url: '',
    outDir: '',
    width: 1280,
    height: 800,
    seconds: 5,
    fps: 10,
    waitMs: 20_000,
    headless: true,
    keepFrames: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      index += 1;
      return next;
    };
    if (arg === '--width') options.width = Number(value());
    else if (arg === '--height') options.height = Number(value());
    else if (arg === '--seconds') options.seconds = Number(value());
    else if (arg === '--fps') options.fps = Number(value());
    else if (arg === '--wait') options.waitMs = Number(value());
    else if (arg === '--headful') options.headless = false;
    else if (arg === '--keep-frames') options.keepFrames = true;
    else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else positional.push(arg);
  }
  const [url, outDir] = positional;
  if (url === undefined || outDir === undefined) {
    throw new Error('usage: tsx scripts/capture.ts <url> <outDir> [options]');
  }
  options.url = url;
  options.outDir = path.resolve(outDir);
  return options;
}

interface FrameStats {
  mean: number;
  max: number;
  std: number;
}

async function frameStats(sharp: Sharp, buffer: Buffer): Promise<FrameStats> {
  const image = sharp(buffer).resize(64, 40, { fit: 'fill' }).removeAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const pixels = data.length / channels;
  let sum = 0;
  let sumSquares = 0;
  let max = 0;
  for (let offset = 0; offset < data.length; offset += channels) {
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? r;
    const b = data[offset + 2] ?? r;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += luminance;
    sumSquares += luminance * luminance;
    if (luminance > max) max = luminance;
  }
  const mean = sum / pixels;
  const variance = Math.max(0, sumSquares / pixels - mean * mean);
  return { mean, max, std: Math.sqrt(variance) };
}

/** A frame counts as rendered when it is not uniformly black. */
function isVisible(stats: FrameStats): boolean {
  return stats.max > 28 && stats.std > 4;
}

function fileSize(file: string): number {
  return statSync(file).size;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const { chromium } = await loadPlaywright();
  const sharp = requireFromCrawler('sharp') as Sharp;

  mkdirSync(options.outDir, { recursive: true });
  const tempDir = mkdtempSync(path.join(tmpdir(), 'fable5-capture-'));
  const coverPng = path.join(tempDir, 'cover.png');
  const framesDir = path.join(tempDir, 'frames');
  mkdirSync(framesDir);

  const browser = await chromium.launch({
    headless: options.headless,
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const consoleErrors: string[] = [];
  let exitCode = 0;

  try {
    const context = await browser.newContext({
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
    });
    page.on('pageerror', (error) => consoleErrors.push(String(error).slice(0, 300)));

    await page.goto(options.url, { waitUntil: 'load', timeout: 60_000 });

    const isFps = /\/04-fps\/?$/.test(new URL(options.url).pathname);
    const isAudio = /\/01-audio(-1h)?\/?$/.test(new URL(options.url).pathname);

    if (isFps) {
      // SUBLEVEL 07 shows a start menu; let the scene warm up, then hit ENTER.
      await page.waitForTimeout(2500);
      const startButton = page.locator('button:visible').filter({ hasText: /enter|start|play/i }).first();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if ((await startButton.count()) === 0) break;
        if (attempt === 0) {
          await startButton.click({ timeout: 5000, force: true }).catch(() => {});
        } else {
          await startButton.dispatchEvent('click').catch(() => {});
        }
        await page.waitForTimeout(700);
      }
      if ((await startButton.count()) > 0) await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
      // Click the canvas to capture the mouse (drops the overlay in interactive runs).
      await page.mouse.click(options.width / 2, options.height / 2);
      await page.waitForTimeout(500);
      await page.keyboard.down('w');
      await page.keyboard.down('Shift');
      await page.mouse.move(options.width / 2, options.height / 2);
      await page.waitForTimeout(1200);
      await page.keyboard.up('Shift');
    } else if (isAudio) {
      // Soundboard: trigger a rifle shot so the waveform/spectrum panels animate.
      const buttons = page.locator('button:visible');
      const count = await buttons.count();
      const labels = count > 0 ? await buttons.allTextContents() : [];
      const rifleIndex = labels.findIndex((label) => /步枪|rifle/i.test(label));
      await buttons.nth(rifleIndex >= 0 ? rifleIndex : 0).click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
    } else {
      await page.mouse.move(options.width / 2, options.height / 2);
    }

    // Wait until the canvas actually renders something (up to options.waitMs).
    const startedAt = Date.now();
    let stats: FrameStats = { mean: 0, max: 0, std: 0 };
    let buffer: Buffer = await page.screenshot({ type: 'png' });
    while (!isVisible(stats) && Date.now() - startedAt < options.waitMs) {
      await page.waitForTimeout(500);
      buffer = await page.screenshot({ type: 'png' });
      stats = await frameStats(sharp, buffer);
    }
    console.log(`rendered=${isVisible(stats)} stats=${JSON.stringify(stats)} waited=${Date.now() - startedAt}ms`);

    // Cover: one clean gameplay frame at capture resolution.
    writeFileSync(coverPng, buffer);
    const coverPath = path.join(options.outDir, 'cover.webp');
    let quality = 82;
    for (;;) {
      execFileSync('cwebp', ['-quiet', '-q', String(quality), '-m', '6', '-mt', coverPng, '-o', coverPath]);
      if (fileSize(coverPath) <= 150 * 1024 || quality <= 40) break;
      quality -= 8;
    }

    // Preview: a short burst of frames with light interaction so motion shows.
    const frameCount = Math.round(options.seconds * options.fps);
    const allButtons = isAudio ? page.locator('button:visible') : null;
    const buttonCount = allButtons === null ? 0 : await allButtons.count();
    let buttonCursor = 1;
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (isFps) {
        await page.mouse.move(
          options.width / 2 + Math.sin(frame / 6) * 120,
          options.height / 2 + Math.cos(frame / 8) * 40,
        );
      } else if (isAudio && allButtons !== null && buttonCount > 0) {
        if (frame % 8 === 0) {
          await allButtons.nth(buttonCursor % buttonCount).click({ timeout: 2000 }).catch(() => {});
          buttonCursor += 1;
        }
      } else {
        // Materials / models: drag across the canvas so the camera rotates.
        const x = options.width / 2 + Math.sin(frame / 10) * 180;
        await page.mouse.move(x, options.height / 2);
        if (frame % 4 === 0) {
          await page.mouse.down();
          await page.mouse.move(x + 40, options.height / 2, { steps: 2 });
          await page.mouse.up();
        }
      }
      const frameBuffer = await page.screenshot({ type: 'png' });
      const resized = await sharp(frameBuffer)
        .resize(640, 400, { fit: 'cover' })
        .png()
        .toBuffer();
      writeFileSync(path.join(framesDir, `frame-${String(frame).padStart(3, '0')}.png`), resized);
    }

    const previewPath = path.join(options.outDir, 'preview.webp');
    for (const previewQuality of [78, 68, 58, 48, 38]) {
      execFileSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-framerate',
        String(options.fps),
        '-i',
        path.join(framesDir, 'frame-%03d.png'),
        '-c:v',
        'libwebp_anim',
        '-lossless',
        '0',
        '-quality',
        String(previewQuality),
        '-loop',
        '0',
        '-an',
        previewPath,
      ]);
      if (fileSize(previewPath) <= 1024 * 1024 || previewQuality === 38) break;
    }

    const coverSize = fileSize(coverPath);
    const previewSize = fileSize(previewPath);
    console.log(`cover=${coverPath} ${formatBytes(coverSize)} quality=${quality}`);
    console.log(`preview=${previewPath} ${formatBytes(previewSize)} frames=${frameCount}`);
    if (coverSize > 150 * 1024 || previewSize > 1024 * 1024) {
      console.error('size limits exceeded');
      exitCode = 1;
    }
    if (!isVisible(stats)) {
      console.error('page never rendered visible pixels');
      exitCode = 1;
    }
    if (consoleErrors.length > 0) console.log(`console errors (${consoleErrors.length}): ${consoleErrors[0]}`);

    if (options.keepFrames) {
      const keepDir = path.join(options.outDir, 'frames');
      mkdirSync(keepDir, { recursive: true });
      for (const file of [coverPng, ...readAll(framesDir)]) {
        const target = path.join(
          keepDir,
          file === coverPng ? 'cover.png' : path.basename(file),
        );
        writeFileSync(target, readFileSync(file));
      }
    }
  } finally {
    await browser.close();
    rmSync(tempDir, { recursive: true, force: true });
  }

  return exitCode;
}

function readAll(dir: string): string[] {
  return readdirSync(dir).map((name) => path.join(dir, name));
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
