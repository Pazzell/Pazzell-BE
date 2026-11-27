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
exports.FirebaseStorageService = void 0;
const firebaseConfig_1 = require("../../firebaseConfig");
class FirebaseStorageService {
    uploadFile(options) {
        return __awaiter(this, void 0, void 0, function* () {
            const { buffer, mimetype, originalname, folder, fileName } = options;
            const name = fileName || `${Date.now()}-${originalname}`;
            const filePath = `${folder}/${name}`;
            const fileRef = firebaseConfig_1.bucket.file(filePath);
            yield fileRef.save(buffer, { resumable: false, contentType: mimetype });
            yield fileRef.makePublic();
            return {
                public_id: filePath,
                url: `https://storage.googleapis.com/${firebaseConfig_1.bucket.name}/${filePath}`,
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
                const file = firebaseConfig_1.bucket.file(filePath);
                const [exists] = yield file.exists();
                if (!exists)
                    return true;
                yield file.delete();
                return true;
            }
            catch (_a) {
                return false;
            }
        });
    }
    deleteFiles(filePaths) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield Promise.all(filePaths.map((fp) => this.deleteFile(fp)));
                return true;
            }
            catch (_a) {
                return false;
            }
        });
    }
}
exports.FirebaseStorageService = FirebaseStorageService;
