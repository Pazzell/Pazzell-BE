import { bucket } from "../../firebaseConfig";
import {
  IStorageService,
  UploadFileOptions,
  UploadedFileResult,
} from "./IStorageService";

export class FirebaseStorageService implements IStorageService {
  async uploadFile(options: UploadFileOptions): Promise<UploadedFileResult> {
    const { buffer, mimetype, originalname, folder, fileName } = options;
    const name = fileName || `${Date.now()}-${originalname}`;
    const filePath = `${folder}/${name}`;
    const fileRef = bucket.file(filePath);

    await fileRef.save(buffer, { resumable: false, contentType: mimetype });
    await fileRef.makePublic();

    return {
      public_id: filePath,
      url: `https://storage.googleapis.com/${bucket.name}/${filePath}`,
    };
  }

  async uploadFiles(files: UploadFileOptions[]): Promise<UploadedFileResult[]> {
    return Promise.all(files.map((f) => this.uploadFile(f)));
  }

  async deleteFile(filePath: string): Promise<boolean> {
    try {
      const file = bucket.file(filePath);
      const [exists] = await file.exists();
      if (!exists) return true;
      await file.delete();
      return true;
    } catch {
      return false;
    }
  }

  async deleteFiles(filePaths: string[]): Promise<boolean> {
    try {
      await Promise.all(filePaths.map((fp) => this.deleteFile(fp)));
      return true;
    } catch {
      return false;
    }
  }
}
