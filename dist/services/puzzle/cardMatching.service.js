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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateCardPairBuffers = generateCardPairBuffers;
const jimp_1 = __importDefault(require("jimp"));
// Generate 8 unique variant buffers (pairs) from the original image
function generateCardPairBuffers(originalBuffer) {
    return __awaiter(this, void 0, void 0, function* () {
        const original = yield jimp_1.default.read(originalBuffer);
        const w = original.getWidth();
        const h = original.getHeight();
        const pairCount = 8;
        const variants = [];
        const font = yield jimp_1.default.loadFont(jimp_1.default.FONT_SANS_64_WHITE);
        for (let i = 1; i <= pairCount; i++) {
            // create a variation by cloning and adding a small badge with the pair index
            const clone = original.clone();
            // badge size relative to image
            const badgeSize = Math.max(32, Math.floor(Math.min(w, h) * 0.12));
            const badge = new jimp_1.default(badgeSize, badgeSize, jimp_1.default.rgbaToInt(0, 0, 0, 160));
            // print number or symbol
            const text = String(i);
            const tx = Math.floor(badgeSize / 4);
            const ty = Math.floor(badgeSize / 6);
            badge.print(font, tx, ty, text);
            // position badge at random-ish location (keep inside)
            const x = Math.floor(Math.min(w - badgeSize - 10, 10 + ((i * 23) % (w - badgeSize - 20))));
            const y = Math.floor(Math.min(h - badgeSize - 10, 10 + ((i * 17) % (h - badgeSize - 20))));
            // use BlendMode object expected by typings
            const blend = {
                mode: jimp_1.default.BLEND_SOURCE_OVER,
                opacitySource: 1,
                opacityDest: 1,
            };
            clone.composite(badge, x, y, blend);
            const buf = yield clone.getBufferAsync(jimp_1.default.MIME_PNG);
            // push two copies (pair)
            variants.push(buf);
            variants.push(Buffer.from(buf));
        }
        // shuffle
        for (let i = variants.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = variants[i];
            variants[i] = variants[j];
            variants[j] = tmp;
        }
        return variants; // 16 buffers
    });
}
