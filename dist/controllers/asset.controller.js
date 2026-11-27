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
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAttachmentes = exports.deleteAttachments = exports.uploadAttachments = void 0;
const storageFactory_1 = require("../services/storage/storageFactory");
// Upload file(s)
const uploadAttachments = (req) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Check if attachments are uploaded
        if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
            return { success: false, error: "No files uploaded" };
        }
        // Explicitly cast req.files to an array of UploadedFile objects
        const filesArray = Array.isArray(req.files)
            ? req.files
            : [req.files];
        const storage = (0, storageFactory_1.getStorageService)();
        const uploadedFilesData = [];
        for (const file of filesArray) {
            if (!file ||
                typeof file !== "object" ||
                !file.mimetype ||
                !file.originalname ||
                !file.buffer) {
                return { success: false, error: "Invalid file format" };
            }
            const fileName = `${Date.now()}-${file.originalname}`;
            const result = yield storage.uploadFile({
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
    }
    catch (error) {
        console.error(error);
        return { success: false, error: "Uploading file(s) failed" };
    }
});
exports.uploadAttachments = uploadAttachments;
// Delete file(s) from storage
const deleteAttachments = (filePaths) => __awaiter(void 0, void 0, void 0, function* () {
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
        console.warn("No file paths provided for deletion.");
        return false;
    }
    return (0, storageFactory_1.getStorageService)().deleteFiles(filePaths);
});
exports.deleteAttachments = deleteAttachments;
// Delete file(s) — alternate signature
const deleteAttachmentes = (filePaths) => __awaiter(void 0, void 0, void 0, function* () {
    if (!filePaths || filePaths.length === 0) {
        return { success: false, error: "No file paths provided" };
    }
    const ok = yield (0, storageFactory_1.getStorageService)().deleteFiles(filePaths);
    return ok ? { success: true } : { success: false, error: "Deleting file(s) failed" };
});
exports.deleteAttachmentes = deleteAttachmentes;
