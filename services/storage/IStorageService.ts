export interface UploadFileOptions {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  folder: string;
  fileName?: string;
}

export interface UploadedFileResult {
  public_id: string;
  url: string;
}

export interface IStorageService {
  uploadFile(options: UploadFileOptions): Promise<UploadedFileResult>;
  uploadFiles(files: UploadFileOptions[]): Promise<UploadedFileResult[]>;
  deleteFile(filePath: string): Promise<boolean>;
  deleteFiles(filePaths: string[]): Promise<boolean>;
  getSignedUrl?(filePath: string, expiresInSeconds: number): Promise<string>;
}
