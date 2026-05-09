import Jimp from "jimp";
import { JimpBlendMode } from "../../utils/jimpTypes";

// Generate a modified image buffer with visible differences
export async function generateSpotDifferenceImage(originalBuffer: Buffer) {
  const image = await Jimp.read(originalBuffer);
  const w = image.getWidth();
  const h = image.getHeight();

  // Create several small colored stickers/rectangles to composite onto the image
  const variants = 8; // number of differences
  for (let i = 0; i < variants; i++) {
    const size = Math.max(
      12,
      Math.floor(Math.min(w, h) * (0.03 + Math.random() * 0.06))
    );
    const x = Math.floor(Math.random() * Math.max(1, w - size - 10)) + 5;
    const y = Math.floor(Math.random() * Math.max(1, h - size - 10)) + 5;
    const color = Jimp.rgbaToInt(
      Math.floor(50 + Math.random() * 205),
      Math.floor(50 + Math.random() * 205),
      Math.floor(50 + Math.random() * 205),
      255
    );

    const sticker = new Jimp(size, size, color);

    // randomly rotate and add some transparency variation
    sticker.rotate(Math.floor(Math.random() * 360));
    if (Math.random() < 0.35) sticker.opacity(0.9);

    // use BlendMode-shaped object to satisfy typings
    const blend: JimpBlendMode = {
      mode: Jimp.BLEND_SOURCE_OVER,
      opacitySource: 1,
      opacityDest: 1,
    };
    image.composite(sticker, x, y, blend as any);

    // Occasionally add small text/icon-like character to a different location
    if (Math.random() < 0.4) {
      const char =
        Math.random() < 0.5 ? "*" : String(Math.floor(Math.random() * 9) + 1);
      const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
      const tx = Math.min(
        w - 20,
        Math.max(5, x + Math.floor(Math.random() * 30) - 15)
      );
      const ty = Math.min(
        h - 20,
        Math.max(5, y + Math.floor(Math.random() * 30) - 15)
      );
      image.print(font, tx, ty, char);
    }
  }

  // Return modified image buffer as PNG
  return await image.getBufferAsync(Jimp.MIME_PNG);
}
