import { exec } from 'child_process';
import { existsSync, readdirSync, renameSync, unlinkSync } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname, extname, join } from 'path';
import { promisify } from 'util';
import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
import { runCommand } from './runCommand.js';

const execAsync = promisify(exec);

const VIDEO_EXTENSIONS = [
  '.mp4',
  '.mov',
  '.avi',
  '.webm',
  '.mkv',
  '.m4v',
  '.flv',
  '.wmv',
  '.mpg',
  '.mpeg',
];

export type ExtractionOptions = {
  fps: number;
  format: 'jpeg' | 'png' | 'webp';
  quality: number;
  similarityThreshold: number;
  maxFrames?: number;
};

export type ExtractionResult = {
  success: boolean;
  frameCount: number;
  dedupedCount: number;
  error?: string;
  skipped?: boolean;
};

export async function checkFFmpegInstalled(): Promise<boolean> {
  try {
    await execAsync('ffmpeg -version');
    return true;
  } catch {
    return false;
  }
}

let cachedFfmpegPath: string | null | undefined;

export async function resolveFfmpegBinary(): Promise<string | null> {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath;

  if (await checkFFmpegInstalled()) {
    cachedFfmpegPath = 'ffmpeg';
    return cachedFfmpegPath;
  }

  try {
    // Use a runtime-only module name so TS doesn't require the optional dep at build time.
    const moduleName = 'ffmpeg-static';
    const mod = (await import(moduleName)) as { default?: string } | string;
    const path = typeof mod === 'string' ? mod : mod.default;
    if (path) {
      cachedFfmpegPath = path;
      return cachedFfmpegPath;
    }
  } catch {
    // ffmpeg-static not installed; fall through
  }

  cachedFfmpegPath = null;
  return cachedFfmpegPath;
}

export const __test = {
  resetFfmpegCache: (): void => {
    cachedFfmpegPath = undefined;
  },
};

function quote(p: string): string {
  return `"${p.replace(/"/g, '\\"')}"`;
}

export function isVideoFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

async function extractFramesWithFFmpeg(
  videoPath: string,
  outputDir: string,
  fps: number,
  format: string,
  quality: number
): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });

  const ffmpegBin = await resolveFfmpegBinary();
  if (!ffmpegBin) {
    throw new Error(
      'ffmpeg not found. Run `jirallm setup` or `jirallm doctor` for install instructions.'
    );
  }
  const ff = quote(ffmpegBin);

  const qScale = Math.round(2 + ((100 - quality) / 100) * 29);
  const ext = format === 'jpeg' ? 'jpg' : format;

  const firstFramePath = `${outputDir}/frame-first.${ext}`;
  await runCommand(
    `${ff} -i "${videoPath}" -vf "select=eq(n\\,0)" -update 1 -vframes 1 -q:v ${qScale} "${firstFramePath}"`,
    'Extracting first frame',
    { silent: true }
  );

  const lastFramePath = `${outputDir}/frame-last.${ext}`;
  await runCommand(
    `${ff} -sseof -1 -i "${videoPath}" -update 1 -q:v ${qScale} "${lastFramePath}"`,
    'Extracting last frame',
    { silent: true }
  );

  const outputPattern = `${outputDir}/frame-%04d.${ext}`;
  await runCommand(
    `${ff} -i "${videoPath}" -vf "fps=${fps}" -q:v ${qScale} "${outputPattern}"`,
    `Extracting frames at ${fps} fps`,
    { silent: true }
  );

  const regularFrames = readdirSync(outputDir)
    .filter((f) => f.startsWith('frame-') && f.endsWith(`.${ext}`) && /frame-\d+/.test(f))
    .sort()
    .map((f) => `${outputDir}/${f}`);

  const allFrames = [firstFramePath, ...regularFrames, lastFramePath].filter((p) => existsSync(p));

  const tempFrames: string[] = [];
  for (let i = 0; i < allFrames.length; i++) {
    const tempFilename = `frame-${String(i + 1).padStart(4, '0')}.tmp.${ext}`;
    const tempPath = join(outputDir, tempFilename);
    renameSync(allFrames[i], tempPath);
    tempFrames.push(tempPath);
  }

  const renumberedFrames: string[] = [];
  for (let i = 0; i < tempFrames.length; i++) {
    const newFilename = `frame-${String(i + 1).padStart(4, '0')}.${ext}`;
    const newPath = join(outputDir, newFilename);
    renameSync(tempFrames[i], newPath);
    renumberedFrames.push(newPath);
  }

  return renumberedFrames;
}

async function calculateImageSimilarity(p1: string, p2: string): Promise<number> {
  const w = 640;
  const h = 360;

  const [img1, img2] = await Promise.all([
    sharp(p1).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(p2).resize(w, h, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);

  const { width, height, channels } = img1.info;
  if (width !== img2.info.width || height !== img2.info.height || channels !== img2.info.channels) {
    throw new Error('Image dimensions or channels do not match');
  }

  const diffBuffer = Buffer.alloc(width * height * 4);
  const mismatched = pixelmatch(img1.data, img2.data, diffBuffer, width, height, {
    threshold: 0.1,
  });
  return mismatched / (width * height);
}

async function deduplicateFrames(
  framePaths: string[],
  similarityThreshold: number,
  maxFrames?: number
): Promise<{ keptFrames: string[]; removedFrames: string[] }> {
  if (framePaths.length === 0) return { keptFrames: [], removedFrames: [] };

  const keptFrames: string[] = [framePaths[0]];
  const removedFrames: string[] = [];

  for (let i = 1; i < framePaths.length; i++) {
    const current = framePaths[i];
    const lastKept = keptFrames[keptFrames.length - 1];

    try {
      const similarity = await calculateImageSimilarity(lastKept, current);
      if (similarity >= similarityThreshold) keptFrames.push(current);
      else removedFrames.push(current);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to compare frames ${lastKept} and ${current}: ${msg}`);
      keptFrames.push(current);
    }
  }

  if (maxFrames && keptFrames.length > maxFrames) {
    const selected: string[] = [keptFrames[0]];
    if (keptFrames.length > 1) selected.push(keptFrames[keptFrames.length - 1]);

    const middleCount = Math.max(0, maxFrames - 2);
    if (middleCount > 0 && keptFrames.length > 2) {
      const middle = keptFrames.slice(1, -1);
      const step = middle.length / (middleCount + 1);
      for (let i = 1; i <= middleCount; i++) selected.push(middle[Math.floor(step * i)]);
    }

    selected.sort((a, b) => keptFrames.indexOf(a) - keptFrames.indexOf(b));

    for (const frame of keptFrames) {
      if (!selected.includes(frame)) removedFrames.push(frame);
    }

    keptFrames.length = 0;
    keptFrames.push(...selected);
  }

  for (const framePath of removedFrames) {
    try {
      unlinkSync(framePath);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`Failed to delete frame ${framePath}: ${msg}`);
    }
  }

  if (keptFrames.length > 0) {
    const outputDir = dirname(keptFrames[0]);
    const ext = extname(keptFrames[0]);
    const renumbered: string[] = [];

    for (let i = 0; i < keptFrames.length; i++) {
      const oldPath = keptFrames[i];
      const newFilename = `frame-${String(i + 1).padStart(4, '0')}${ext}`;
      const newPath = join(outputDir, newFilename);

      if (oldPath !== newPath) {
        try {
          renameSync(oldPath, newPath);
          renumbered.push(newPath);
        } catch {
          renumbered.push(oldPath);
        }
      } else {
        renumbered.push(oldPath);
      }
    }

    return { keptFrames: renumbered, removedFrames };
  }

  return { keptFrames, removedFrames };
}

export async function extractAndDeduplicateFrames(
  videoPath: string,
  outputDir: string,
  options: ExtractionOptions
): Promise<ExtractionResult> {
  const ffmpegInstalled = await checkFFmpegInstalled();
  if (!ffmpegInstalled) {
    return {
      success: false,
      frameCount: 0,
      dedupedCount: 0,
      error: 'FFmpeg not found. Install ffmpeg to enable video frame extraction.',
    };
  }

  if (!existsSync(videoPath)) {
    return {
      success: false,
      frameCount: 0,
      dedupedCount: 0,
      error: `Video file not found: ${videoPath}`,
    };
  }

  try {
    const extractedFrames = await extractFramesWithFFmpeg(
      videoPath,
      outputDir,
      options.fps,
      options.format,
      options.quality
    );

    if (extractedFrames.length === 0) {
      return {
        success: false,
        frameCount: 0,
        dedupedCount: 0,
        error: 'No frames extracted from video',
      };
    }

    const { keptFrames } = await deduplicateFrames(
      extractedFrames,
      options.similarityThreshold,
      options.maxFrames
    );

    return {
      success: true,
      frameCount: extractedFrames.length,
      dedupedCount: keptFrames.length,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, frameCount: 0, dedupedCount: 0, error: msg };
  }
}
