import { Request, Response } from "express";
import { CatchAsyncError } from "../middlewares/catchAsyncError";
import ErrorHandler from "../utils/ErrorHandler";
import { ImageFolder, storeImage } from "../services/upload/image.service";

const FOLDERS: ImageFolder[] = ["cards", "covers", "logos"];

// POST /uploads/images  (multipart: "image" file, optional "kind" = cards | covers | logos)
// Returns a URL that the same user may then reference as `imageUrl` / `coverImageUrl` /
// `logoUrl` in JSON requests (e.g. bulk card entry).
export const uploadImage = CatchAsyncError(async (req: Request, res: Response) => {
  const kind = (req.body?.kind || "cards") as ImageFolder;
  if (!FOLDERS.includes(kind)) {
    throw new ErrorHandler(`kind must be one of: ${FOLDERS.join(", ")}`, 400);
  }
  const image = await storeImage(req.file, String(req.user!._id), kind);
  res.status(201).json({
    success: true,
    image: {
      url: image.url,
      width: image.width,
      height: image.height,
      sizeBytes: image.sizeBytes,
    },
  });
});
