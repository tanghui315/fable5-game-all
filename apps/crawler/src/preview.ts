/** Record a short animated WebP preview of a running entry. */

import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Page } from 'playwright';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

export interface PreviewConfig {
  /** Width of the encoded preview. */
  width: number;
  /** Height of the encoded preview. */
  height: number;
  /** How many seconds to record. */
  seconds: number;
  /** Frames per second. */
  fps: number;
  /** Hard cap for the encoded file. */
  max_bytes: number;
  /**
   * Mean absolute pixel difference (0-255) below which the recording counts as
   * a still image and is thrown away. A title screen or a paused game has no
   * business looking like a preview.
   */
  min_motion: number;
}

export interface PreviewResult {
  webp: Buffer;
  bytes: number;
  frames: number;
  /** Mean absolute difference between the first and last sampled frame. */
  motion: number;
  /** True when motion stayed under `min_motion`; the caller should drop it. */
  static: boolean;
}

export const DEFAULT_PREVIEW: PreviewConfig = {
  width: 640,
  height: 400,
  seconds: 5,
  fps: 10,
  max_bytes: 600 * 1024,
  min_motion: 1.5,
};

/** ffmpeg is the only encoder that writes animated WebP from a frame series. */
let ffmpegAvailable: boolean | null = null;

export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    await execFileAsync('ffmpeg', ['-version'], { timeout: 10_000 });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

/** Labels that usually mean "this screen is a title card, click through it". */
const START_LABEL =
  /\b(play|start|begin|enter|deploy|launch|continue|go)\b|开始|进入|启动|部署|点击开始/i;

/** Controls that start something else (camera demo, sharing) — never click these. */
const SKIP_LABEL = /webcam|camera|摄像头|share|tweet|instagram|login|sign in|download/i;

/** Text-only "keep going" controls that are neither buttons nor links. */
const PROCEED_LABEL =
  /^\s*(start( the tutorial)?|skip( the tutorial)?|continue|next|got it|ok(ay)?|accept|开始|继续|跳过|确定)\s*$/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A busy game loop can stop acknowledging input over CDP, and `mouse.move`
 * has no timeout of its own. Bound every interaction so one wedged page cannot
 * stall the whole run.
 */
async function bounded<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Best-effort attempt to get past a title screen: click a Play/Start button,
 * otherwise click the canvas and press a key. Failures are ignored — the
 * recorded frames are judged by their motion, not by whether this worked.
 */
async function enterGame(page: Page, width: number, height: number): Promise<void> {
  // Links are deliberately not included: site chrome ("Play", "Games") reads
  // like a start button and would navigate away from the entry.
  for (const selector of ['button:visible', '[role="button"]:visible']) {
    const candidates = page.locator(selector).filter({ hasText: START_LABEL });
    const count = await candidates.count().catch(() => 0);
    if (count === 0) continue;
    for (let index = 0; index < Math.min(count, 3); index += 1) {
      const label = (await candidates.nth(index).innerText().catch(() => '')) ?? '';
      // Body-text matches are noise; a start control is a short label.
      if (label.length > 40 || SKIP_LABEL.test(label)) continue;
      const clicked =
        (await bounded(candidates.nth(index).click({ timeout: 2_000, force: true }), 4_000)) !==
        null;
      if (clicked) {
        await sleep(900);
        return;
      }
    }
  }
  // Some title cards draw their buttons as plain text.
  const proceed = page.getByText(PROCEED_LABEL).first();
  if ((await proceed.count().catch(() => 0)) > 0) {
    const clicked = (await bounded(proceed.click({ timeout: 2_000, force: true }), 4_000)) !== null;
    if (clicked) {
      await sleep(900);
      return;
    }
  }

  // Two clicks: the first often only gives the frame focus (and dismisses a
  // "click to play" overlay), the second reaches the game itself.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await bounded(page.mouse.click(width / 2, height / 2), 2_000);
    await sleep(700);
  }
  for (const key of [' ', 'Enter']) {
    await bounded(page.keyboard.press(key), 2_000);
    await sleep(150);
  }
}

/** Mean absolute difference of two frames, downscaled to 32x20 grayscale. */
async function frameDelta(a: Buffer, b: Buffer): Promise<number> {
  const smallImage = (image: Buffer) =>
    sharp(image).resize(32, 20, { fit: 'fill' }).greyscale().raw().toBuffer();
  const [left, right] = await Promise.all([smallImage(a), smallImage(b)]);
  if (left.length !== right.length || left.length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    sum += Math.abs(left[index]! - right[index]!);
  }
  return sum / left.length;
}

/**
 * Wait for the page to start changing on its own. A game still streaming its
 * assets ("55 MB · 22/27") shows a frozen progress bar, and recording it now
 * would only produce a still.
 */
async function waitForMotion(page: Page, maxMs: number, threshold = 0.8): Promise<boolean> {
  return (await measureMotion(page, maxMs)) >= threshold;
}

/** Average brightness (0-255) of a frame. */
async function frameMean(image: Buffer): Promise<number> {
  const { data } = await sharp(image)
    .resize(32, 20, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (data.length === 0) return 0;
  let sum = 0;
  for (const value of data) sum += value;
  return sum / data.length;
}

/**
 * Largest consecutive-frame change observed in the next `maxMs` milliseconds.
 * Loading screens flicker sprites on black; those do not count as "moving".
 */
async function measureMotion(page: Page, maxMs: number): Promise<number> {
  const deadline = Date.now() + maxMs;
  let previous = await page.screenshot({ type: 'png', timeout: 5_000 }).catch(() => null);
  let best = 0;
  while (previous !== null && Date.now() < deadline) {
    await sleep(800);
    const current = await page.screenshot({ type: 'png', timeout: 5_000 }).catch(() => null);
    if (current === null) break;
    if ((await frameMean(current)) > 12) {
      best = Math.max(best, await frameDelta(previous, current));
    }
    previous = current;
  }
  return best;
}

/** Encode a directory of `frame-%03d.png` into an animated WebP. */
async function encodeFrames(
  framesDir: string,
  output: string,
  fps: number,
  maxBytes: number,
): Promise<number> {
  let bytes = 0;
  const encode = async (quality: number, scale: string | null): Promise<void> => {
    await execFileAsync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-framerate',
        String(fps),
        '-i',
        path.join(framesDir, 'frame-%03d.png'),
        ...(scale === null ? [] : ['-vf', scale]),
        '-c:v',
        'libwebp_anim',
        '-lossless',
        '0',
        '-quality',
        String(quality),
        '-loop',
        '0',
        '-an',
        output,
      ],
      { timeout: 120_000 },
    );
    bytes = statSync(output).size;
  };

  for (const quality of [70, 60, 50, 42, 34, 28, 22, 16]) {
    await encode(quality, null);
    if (bytes <= maxBytes) return bytes;
  }
  // High-motion scenes can miss the cap at full size; a smaller canvas fits.
  for (const quality of [50, 38, 28, 20]) {
    await encode(quality, 'scale=480:300');
    if (bytes <= maxBytes) break;
  }
  return bytes;
}

/**
 * Record a preview of whatever the page is currently showing. Returns null when
 * the encoder is missing or the recording failed; a still recording comes back
 * with `static: true` so the caller can decide.
 */
export async function recordPreview(
  page: Page,
  config: PreviewConfig = DEFAULT_PREVIEW,
): Promise<PreviewResult | null> {
  if (!(await hasFfmpeg())) return null;

  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  const { width: viewWidth, height: viewHeight } = viewport;
  // A moving attract screen must not be clicked — in plenty of games the first
  // click pauses it — but a nearly still menu needs the click that starts play.
  if ((await measureMotion(page, 3_000)) < 5) {
    await enterGame(page, viewWidth, viewHeight);
    // Give a loading screen time to finish revealing the actual scene.
    await waitForMotion(page, 25_000);
  }

  const framesDir = mkdtempSync(path.join(os.tmpdir(), 'fable5-preview-'));
  const output = path.join(framesDir, 'preview.webp');
  const frameCount = Math.max(1, Math.round(config.seconds * config.fps));
  const interval = 1000 / config.fps;
  const frames: Buffer[] = [];
  // A busy page can make every screenshot take its full timeout; cap the whole
  // recording instead of letting 50 slow frames stretch to minutes.
  const recordingDeadline = Date.now() + 30_000;

  // Most entries are keyboard games: holding a movement key is what makes the
  // scene move at all, and the periodic Space is the jump in platformers.
  const heldKeys = ['ArrowRight', 'KeyD'];
  try {
    for (const key of heldKeys) await bounded(page.keyboard.down(key), 1_000);
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (Date.now() > recordingDeadline) break;
      const started = Date.now();
      // Slow orbit plus the odd click: enough motion that a menu-driven scene
      // reacts, gentle enough that the clip does not look like a camera whip.
      const angle = (frame / config.fps) * 1.4;
      await bounded(
        page.mouse.move(
          viewWidth / 2 + Math.cos(angle) * viewWidth * 0.16,
          viewHeight / 2 + Math.sin(angle) * viewHeight * 0.14,
        ),
        2_000,
      );
      // No clicks while recording: in many games a stray click pauses the action
      // or fires a menu, and a paused clip looks exactly like a broken one.
      if (frame > 0 && frame % Math.round(config.fps * 1.2) === 0) {
        await bounded(page.keyboard.press('Space'), 1_000);
      }
      const shot = await page.screenshot({ type: 'png', timeout: 5_000 }).catch(() => null);
      if (shot !== null) {
        const resized = await sharp(shot)
          .resize(config.width, config.height, { fit: 'cover' })
          .png({ compressionLevel: 6 })
          .toBuffer();
        frames.push(resized);
        writeFileSync(
          path.join(framesDir, `frame-${String(frames.length - 1).padStart(3, '0')}.png`),
          resized,
        );
      }
      const elapsed = Date.now() - started;
      if (elapsed < interval) await sleep(interval - elapsed);
    }

    for (const key of heldKeys) await bounded(page.keyboard.up(key), 1_000);
    if (frames.length < 4) return null;

    // Compare neighbouring samples rather than the first and last frame: a game
    // that only moves when the player does something can sit still at both ends
    // of a clip that is lively in the middle.
    let motion = 0;
    const step = Math.max(1, Math.round(config.fps / 2));
    for (let index = step; index < frames.length; index += step) {
      if ((await frameMean(frames[index]!)) <= 12) continue;
      motion = Math.max(motion, await frameDelta(frames[index - step]!, frames[index]!));
    }
    const bytes = await encodeFrames(framesDir, output, config.fps, config.max_bytes);
    // Never ship a file the data validator would reject.
    if (bytes > 1024 * 1024) return null;
    return {
      webp: readFileSync(output),
      bytes,
      frames: frames.length,
      motion,
      static: motion < config.min_motion,
    };
  } catch (error) {
    if (process.env.CRAWLER_DEBUG) {
      console.error(`[preview] ${error instanceof Error ? error.stack : String(error)}`);
    }
    return null;
  } finally {
    rmSync(framesDir, { recursive: true, force: true });
  }
}
