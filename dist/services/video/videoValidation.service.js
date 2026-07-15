"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VideoValidationError = void 0;
exports.validateVideoUpload = validateVideoUpload;
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const promises_1 = __importDefault(require("fs/promises"));
const crypto_1 = require("crypto");
const child_process_1 = require("child_process");
const util_1 = require("util");
// @ts-ignore — no bundled type declarations
const ffprobe_static_1 = __importDefault(require("ffprobe-static"));
const config_service_1 = require("../config/config.service");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
function probeDurationSeconds(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const ffprobePath = ffprobe_static_1.default.path || ffprobe_static_1.default;
        const { stdout } = yield execFileAsync(ffprobePath, [
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
    });
}
class VideoValidationError extends Error {
}
exports.VideoValidationError = VideoValidationError;
/**
 * Probes an uploaded video buffer for duration (via ffprobe-static's bundled
 * binary — no system ffmpeg install required) and validates it against
 * Config-driven limits (video.maxDurationSeconds, video.maxSizeBytes).
 * Writes to a scratch temp file since ffprobe needs a file path, not a buffer.
 */
function validateVideoUpload(file) {
    return __awaiter(this, void 0, void 0, function* () {
        const { maxDurationSeconds, maxSizeBytes } = yield (0, config_service_1.getVideoLimits)();
        if (file.buffer.length > maxSizeBytes) {
            throw new VideoValidationError(`Video file is too large (${(file.buffer.length / (1024 * 1024)).toFixed(1)}MB). Maximum allowed is ${(maxSizeBytes / (1024 * 1024)).toFixed(0)}MB.`);
        }
        const ext = path_1.default.extname(file.originalname) || ".mp4";
        const tmpPath = path_1.default.join(os_1.default.tmpdir(), `pazzell-video-${(0, crypto_1.randomUUID)()}${ext}`);
        let durationSeconds;
        try {
            yield promises_1.default.writeFile(tmpPath, file.buffer);
            durationSeconds = yield probeDurationSeconds(tmpPath);
        }
        catch (e) {
            throw new VideoValidationError(`Could not read video duration: ${e.message}`);
        }
        finally {
            yield promises_1.default.unlink(tmpPath).catch(() => { });
        }
        if (durationSeconds > maxDurationSeconds) {
            throw new VideoValidationError(`Video is too long (${Math.round(durationSeconds)}s). Maximum allowed is ${maxDurationSeconds}s (~2 minutes).`);
        }
        return {
            durationSeconds,
            sizeBytes: file.buffer.length,
            mimeType: file.mimetype,
        };
    });
}
