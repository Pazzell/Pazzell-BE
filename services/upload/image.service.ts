import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "crypto";
import ErrorHandler from "../../utils/ErrorHandler";
import { getStorageService } from "../storage/storageFactory";
import UploadedImageModel, { IUploadedImage } from "../../models/uploadedImage.model";

export const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5MB
export const IMAGE_MAX_DIMENSION = 1280; // longest edge after resizing, px
export const IMAGE_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_FORMATS = ["jpeg", "png", "webp"];

export type ImageFolder = "cards" | "covers" | "logos" | "avatars";

/** Multer instance for a single image held in memory. Use `.single("image")`. */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_ALLOWED_MIME.includes(file.mimetype)) {
      return cb(
        new ErrorHandler("Only JPG, PNG or WEBP images are allowed", 400, "INVALID_IMAGE_TYPE")
      );
    }
    cb(null, true);
  },
});

/**
 * Validates, normalises and stores an uploaded image.
 * - The real format is read from the file bytes; the client-declared mimetype and
 *   filename are never trusted.
 * - The image is resized to fit IMAGE_MAX_DIMENSION, re-encoded as WEBP (which also
 *   strips EXIF/GPS metadata) and stored under a random name.
 */
export async function storeImage(
  file: { buffer: Buffer; size?: number } | undefined,
  ownerId: string,
  folder: ImageFolder
): Promise<IUploadedImage> {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new ErrorHandler("An image file is required", 400, "IMAGE_REQUIRED");
  }
  if (file.buffer.length > IMAGE_MAX_BYTES) {
    throw new ErrorHandler("Image is too large (maximum 5MB)", 400, "IMAGE_TOO_LARGE");
  }

  let output: { data: Buffer; info: sharp.OutputInfo };
  try {
    const pipeline = sharp(file.buffer, { failOn: "error", limitInputPixels: 40_000_000 });
    const metadata = await pipeline.metadata();
    if (!metadata.format || !ALLOWED_FORMATS.includes(metadata.format)) {
      throw new Error("unsupported format");
    }
    output = await pipeline
      .rotate() // apply EXIF orientation before the metadata is dropped
      .resize({
        width: IMAGE_MAX_DIMENSION,
        height: IMAGE_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new ErrorHandler(
      "The file is not a valid JPG, PNG or WEBP image",
      400,
      "INVALID_IMAGE_TYPE"
    );
  }

  const fileName = `${randomUUID()}.webp`;
  const stored = await getStorageService().uploadFile({
    buffer: output.data,
    mimetype: "image/webp",
    originalname: fileName,
    folder: `pazzell/${folder}`,
    fileName,
  });

  return UploadedImageModel.create({
    ownerId,
    url: stored.url,
    storageKey: stored.public_id,
    folder,
    width: output.info.width,
    height: output.info.height,
    sizeBytes: output.data.length,
  });
}

/**
 * Accepts an `imageUrl` sent in a JSON body only when it is an image this same
 * user uploaded through the API. Returns the URL, or throws.
 */
export async function assertOwnedImageUrl(url: any, ownerId: string): Promise<string> {
  if (typeof url !== "string" || !url) {
    throw new ErrorHandler("imageUrl is required", 400, "IMAGE_REQUIRED");
  }
  const owned = await UploadedImageModel.exists({ url, ownerId });
  if (!owned) {
    throw new ErrorHandler(
      "imageUrl must be an image you uploaded through POST /uploads/images",
      400,
      "INVALID_IMAGE_URL"
    );
  }
  return url;
}

/**
 * Resolves the image for a create/update request: an attached file wins, otherwise an
 * owned `imageUrl` from the body. Returns undefined when neither was sent.
 */
export async function resolveImage(
  file: { buffer: Buffer } | undefined,
  bodyUrl: any,
  ownerId: string,
  folder: ImageFolder
): Promise<string | undefined> {
  if (file) return (await storeImage(file, ownerId, folder)).url;
  if (bodyUrl !== undefined && bodyUrl !== null && bodyUrl !== "") {
    return assertOwnedImageUrl(bodyUrl, ownerId);
  }
  return undefined;
}
