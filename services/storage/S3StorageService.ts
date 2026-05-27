import {
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "../../aws/awsClients";
import {
  IStorageService,
  UploadFileOptions,
  UploadedFileResult,
} from "./IStorageService";

export class S3StorageService implements IStorageService {
  private bucket = process.env.AWS_S3_BUCKET_NAME!;
  private baseUrl =
    process.env.AWS_S3_PUBLIC_BASE_URL ||
    `https://${process.env.AWS_S3_BUCKET_NAME}.s3.amazonaws.com`;

  async uploadFile(options: UploadFileOptions): Promise<UploadedFileResult> {
    const { buffer, mimetype, originalname, folder, fileName } = options;
    const name = fileName || `${Date.now()}-${originalname}`;
    const key = `${folder}/${name}`;

    await getS3Client().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
      })
    );

    return {
      public_id: key,
      url: `${this.baseUrl}/${key}`,
    };
  }

  async uploadFiles(files: UploadFileOptions[]): Promise<UploadedFileResult[]> {
    return Promise.all(files.map((f) => this.uploadFile(f)));
  }

  async deleteFile(filePath: string): Promise<boolean> {
    try {
      await getS3Client().send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: filePath })
      );
      return true;
    } catch {
      return false;
    }
  }

  async deleteFiles(filePaths: string[]): Promise<boolean> {
    if (filePaths.length === 0) return true;
    try {
      await getS3Client().send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: filePaths.map((Key) => ({ Key })),
            Quiet: true,
          },
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(filePath: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      getS3Client(),
      new GetObjectCommand({ Bucket: this.bucket, Key: filePath }),
      { expiresIn: expiresInSeconds }
    );
  }
}
