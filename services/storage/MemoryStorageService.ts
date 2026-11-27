import {
  IStorageService,
  UploadFileOptions,
  UploadedFileResult,
} from "./IStorageService";

// In-process storage for tests and offline development (STORAGE_PROVIDER=memory).
// Nothing is persisted and the URLs are not publicly reachable.
export class MemoryStorageService implements IStorageService {
  readonly files = new Map<string, { buffer: Buffer; mimetype: string }>();

  async uploadFile(options: UploadFileOptions): Promise<UploadedFileResult> {
    const { buffer, mimetype, originalname, folder, fileName } = options;
    const key = `${folder}/${fileName || `${Date.now()}-${originalname}`}`;
    this.files.set(key, { buffer, mimetype });
    return { public_id: key, url: `https://storage.pazzell.test/${key}` };
  }

  async uploadFiles(files: UploadFileOptions[]): Promise<UploadedFileResult[]> {
    return Promise.all(files.map((f) => this.uploadFile(f)));
  }

  async deleteFile(filePath: string): Promise<boolean> {
    this.files.delete(filePath);
    return true;
  }

  async deleteFiles(filePaths: string[]): Promise<boolean> {
    filePaths.forEach((fp) => this.files.delete(fp));
    return true;
  }
}
