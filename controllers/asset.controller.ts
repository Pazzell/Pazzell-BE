import { Request } from "express";
import { getStorageService } from "../services/storage/storageFactory";

// Type for a single file
interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

// Type for uploaded file data
interface UploadedFileData {
  public_id: string;
  url: string;
}

// Return type for uploadAttachments
interface UploadResult {
  success: boolean;
  data?: UploadedFileData[];
  error?: string;
}

// Upload file(s)
export const uploadAttachments = async (req: Request): Promise<UploadResult> => {
  try {
    // Check if attachments are uploaded
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
      return { success: false, error: "No files uploaded" };
    }

    // Explicitly cast req.files to an array of UploadedFile objects
    const filesArray: UploadedFile[] = Array.isArray(req.files)
      ? (req.files as UploadedFile[])
      : [(req.files as UploadedFile)];

    const storage = getStorageService();
    const uploadedFilesData: UploadedFileData[] = [];

    for (const file of filesArray) {
      if (
        !file ||
        typeof file !== "object" ||
        !file.mimetype ||
        !file.originalname ||
        !file.buffer
      ) {
        return { success: false, error: "Invalid file format" };
      }

      const fileName = `${Date.now()}-${file.originalname}`;
      const result = await storage.uploadFile({
        buffer: file.buffer,
        mimetype: file.mimetype,
        originalname: file.originalname,
        folder: "attachments",
        fileName,
      });

      uploadedFilesData.push({
        public_id: result.public_id,
        url: result.url,
      });
    }

    // Return all uploaded file data
    return { success: true, data: uploadedFilesData };
  } catch (error) {
    console.error(error);
    return { success: false, error: "Uploading file(s) failed" };
  }
};

// Delete file(s) from storage
export const deleteAttachments = async (filePaths: string[]): Promise<boolean> => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    console.warn("No file paths provided for deletion.");
    return false;
  }
  return getStorageService().deleteFiles(filePaths);
};

// Delete file(s) — alternate signature
export const deleteAttachmentes = async (
  filePaths: string[]
): Promise<{ success: boolean; error?: string }> => {
  if (!filePaths || filePaths.length === 0) {
    return { success: false, error: "No file paths provided" };
  }
  const ok = await getStorageService().deleteFiles(filePaths);
  return ok ? { success: true } : { success: false, error: "Deleting file(s) failed" };
};
