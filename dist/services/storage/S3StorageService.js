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
exports.S3StorageService = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const client_s3_2 = require("@aws-sdk/client-s3");
const awsClients_1 = require("../../aws/awsClients");
class S3StorageService {
    constructor() {
        this.bucket = process.env.AWS_S3_BUCKET_NAME;
        this.region = process.env.AWS_REGION || "us-east-1";
        this.baseUrl = process.env.AWS_S3_PUBLIC_BASE_URL ||
            `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${this.region}.amazonaws.com`;
    }
    uploadFile(options) {
        return __awaiter(this, void 0, void 0, function* () {
            const { buffer, mimetype, originalname, folder, fileName } = options;
            const name = fileName || `${Date.now()}-${originalname}`;
            const key = `${folder}/${name}`;
            yield (0, awsClients_1.getS3Client)().send(new client_s3_1.PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: buffer,
                ContentType: mimetype,
            }));
            return {
                public_id: key,
                url: `${this.baseUrl}/${key}`,
            };
        });
    }
    uploadFiles(files) {
        return __awaiter(this, void 0, void 0, function* () {
            return Promise.all(files.map((f) => this.uploadFile(f)));
        });
    }
    deleteFile(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield (0, awsClients_1.getS3Client)().send(new client_s3_1.DeleteObjectCommand({ Bucket: this.bucket, Key: filePath }));
                return true;
            }
            catch (_a) {
                return false;
            }
        });
    }
    deleteFiles(filePaths) {
        return __awaiter(this, void 0, void 0, function* () {
            if (filePaths.length === 0)
                return true;
            try {
                yield (0, awsClients_1.getS3Client)().send(new client_s3_1.DeleteObjectsCommand({
                    Bucket: this.bucket,
                    Delete: {
                        Objects: filePaths.map((Key) => ({ Key })),
                        Quiet: true,
                    },
                }));
                return true;
            }
            catch (_a) {
                return false;
            }
        });
    }
    getSignedUrl(filePath, expiresInSeconds) {
        return __awaiter(this, void 0, void 0, function* () {
            return (0, s3_request_presigner_1.getSignedUrl)((0, awsClients_1.getS3Client)(), new client_s3_2.GetObjectCommand({ Bucket: this.bucket, Key: filePath }), { expiresIn: expiresInSeconds });
        });
    }
}
exports.S3StorageService = S3StorageService;
