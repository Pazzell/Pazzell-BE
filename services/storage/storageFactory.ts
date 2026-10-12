import { IStorageService } from "./IStorageService";
import { S3StorageService } from "./S3StorageService";
import { MemoryStorageService } from "./MemoryStorageService";

let _instance: IStorageService | null = null;

export const getStorageService = (): IStorageService => {
  if (_instance) return _instance;
  const provider = (process.env.STORAGE_PROVIDER ?? "firebase").toLowerCase();
  if (provider === "aws") {
    _instance = new S3StorageService();
  } else if (provider === "memory") {
    _instance = new MemoryStorageService();
  } else {
    // Required lazily so firebase-admin is only initialised when it is the chosen provider
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FirebaseStorageService } = require("./FirebaseStorageService");
    _instance = new FirebaseStorageService() as IStorageService;
  }
  return _instance;
};
