import Jimp from "jimp";
import { JimpBlendMode } from "../../utils/jimpTypes";

// Generate 8 unique variant buffers (pairs) from the original image
export async function generateCardPairBuffers(originalBuffer: Buffer) {
  const original = await Jimp.read(originalBuffer);
  const w = original.getWidth();
  const h = original.getHeight();

  const pairCount = 8;
  const variants: Buffer[] = [];

  const font = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);

  for (let i = 1; i <= pairCount; i++) {
    // create a variation by cloning and adding a small badge with the pair index
    const clone = original.clone();

    // badge size relative to image
    const badgeSize = Math.max(32, Math.floor(Math.min(w, h) * 0.12));
    const badge = new Jimp(badgeSize, badgeSize, Jimp.rgbaToInt(0, 0, 0, 160));

    // print number or symbol
    const text = String(i);
    const tx = Math.floor(badgeSize / 4);
    const ty = Math.floor(badgeSize / 6);
    badge.print(font, tx, ty, text);

    // position badge at random-ish location (keep inside)
    const x = Math.floor(
      Math.min(w - badgeSize - 10, 10 + ((i * 23) % (w - badgeSize - 20)))
    );
    const y = Math.floor(
      Math.min(h - badgeSize - 10, 10 + ((i * 17) % (h - badgeSize - 20)))
    );

    // use BlendMode object expected by typings
    const blend: JimpBlendMode = {
      mode: Jimp.BLEND_SOURCE_OVER,
      opacitySource: 1,
      opacityDest: 1,
    };
    clone.composite(badge, x, y, blend as any);

    const buf = await clone.getBufferAsync(Jimp.MIME_PNG);
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
}
