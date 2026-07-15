import { IStorageService } from "./IStorageService";
import { FirebaseStorageService } from "./FirebaseStorageService";
import { S3StorageService } from "./S3StorageService";

let _instance: IStorageService | null = null;

export const getStorageService = (): IStorageService => {
  if (_instance) return _instance;
  const provider = (process.env.STORAGE_PROVIDER ?? "firebase").toLowerCase();
  _instance =
    provider === "aws" ? new S3StorageService() : new FirebaseStorageService();
  return _instance;
};
