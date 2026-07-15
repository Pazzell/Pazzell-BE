// Lightweight local type to represent Jimp's BlendMode shape used by `composite`
export interface JimpBlendMode {
  mode: string;
  opacitySource?: number;
  opacityDest?: number;
}

export default JimpBlendMode;
