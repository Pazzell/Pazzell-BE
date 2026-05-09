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
exports.generateSpotDifferenceImage = generateSpotDifferenceImage;
const jimp_1 = __importDefault(require("jimp"));
// Generate a modified image buffer with visible differences
function generateSpotDifferenceImage(originalBuffer) {
    return __awaiter(this, void 0, void 0, function* () {
        const image = yield jimp_1.default.read(originalBuffer);
        const w = image.getWidth();
        const h = image.getHeight();
        // Create several small colored stickers/rectangles to composite onto the image
        const variants = 8; // number of differences
        for (let i = 0; i < variants; i++) {
            const size = Math.max(12, Math.floor(Math.min(w, h) * (0.03 + Math.random() * 0.06)));
            const x = Math.floor(Math.random() * Math.max(1, w - size - 10)) + 5;
            const y = Math.floor(Math.random() * Math.max(1, h - size - 10)) + 5;
            const color = jimp_1.default.rgbaToInt(Math.floor(50 + Math.random() * 205), Math.floor(50 + Math.random() * 205), Math.floor(50 + Math.random() * 205), 255);
            const sticker = new jimp_1.default(size, size, color);
            // randomly rotate and add some transparency variation
            sticker.rotate(Math.floor(Math.random() * 360));
            if (Math.random() < 0.35)
                sticker.opacity(0.9);
            // use BlendMode-shaped object to satisfy typings
            const blend = {
                mode: jimp_1.default.BLEND_SOURCE_OVER,
                opacitySource: 1,
                opacityDest: 1,
            };
            image.composite(sticker, x, y, blend);
            // Occasionally add small text/icon-like character to a different location
            if (Math.random() < 0.4) {
                const char = Math.random() < 0.5 ? "*" : String(Math.floor(Math.random() * 9) + 1);
                const font = yield jimp_1.default.loadFont(jimp_1.default.FONT_SANS_16_WHITE);
                const tx = Math.min(w - 20, Math.max(5, x + Math.floor(Math.random() * 30) - 15));
                const ty = Math.min(h - 20, Math.max(5, y + Math.floor(Math.random() * 30) - 15));
                image.print(font, tx, ty, char);
            }
        }
        // Return modified image buffer as PNG
        return yield image.getBufferAsync(jimp_1.default.MIME_PNG);
    });
}
