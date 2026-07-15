import path from "path";
import os from "os";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
// @ts-ignore — no bundled type declarations
import ffprobeStatic from "ffprobe-static";
import { getVideoLimits } from "../config/config.service";

const execFileAsync = promisify(execFile);

async function probeDurationSeconds(filePath: string): Promise<number> {
  const ffprobePath: string = (ffprobeStatic as any).path || (ffprobeStatic as any);
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const duration = parseFloat(stdout.trim());
  if (!Number.isFinite(duration)) {
    throw new Error("ffprobe did not return a valid duration");
  }
  return duration;
}

export interface VideoValidationResult {
  durationSeconds: number;
  sizeBytes: number;
  mimeType: string;
}

export class VideoValidationError extends Error {}

/**
 * Probes an uploaded video buffer for duration (via ffprobe-static's bundled
 * binary — no system ffmpeg install required) and validates it against
 * Config-driven limits (video.maxDurationSeconds, video.maxSizeBytes).
 * Writes to a scratch temp file since ffprobe needs a file path, not a buffer.
 */
export async function validateVideoUpload(file: {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}): Promise<VideoValidationResult> {
  const { maxDurationSeconds, maxSizeBytes } = await getVideoLimits();

  if (file.buffer.length > maxSizeBytes) {
    throw new VideoValidationError(
      `Video file is too large (${(file.buffer.length / (1024 * 1024)).toFixed(
        1
      )}MB). Maximum allowed is ${(maxSizeBytes / (1024 * 1024)).toFixed(0)}MB.`
    );
  }

  const ext = path.extname(file.originalname) || ".mp4";
  const tmpPath = path.join(os.tmpdir(), `pazzell-video-${randomUUID()}${ext}`);

  let durationSeconds: number;
  try {
    await fs.writeFile(tmpPath, file.buffer);
    durationSeconds = await probeDurationSeconds(tmpPath);
  } catch (e: any) {
    throw new VideoValidationError(
      `Could not read video duration: ${e.message}`
    );
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }

  if (durationSeconds > maxDurationSeconds) {
    throw new VideoValidationError(
      `Video is too long (${Math.round(
        durationSeconds
      )}s). Maximum allowed is ${maxDurationSeconds}s (~2 minutes).`
    );
  }

  return {
    durationSeconds,
    sizeBytes: file.buffer.length,
    mimeType: file.mimetype,
  };
}
