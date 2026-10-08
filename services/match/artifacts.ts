// Procedural artifact library for the Match game. Nothing here is uploaded or stored:
// every artifact is derived from its id, so ids are stable forever and the server can
// reason about similarity when it builds distractors.
//
// Id grammar:  <base>[@<variant>]
//   shape:<shape>                 shape:circle
//   shape:<shape>:<color>         shape:triangle:red      (attribute combination)
//   color:<color>                 color:blue
//   letter:<upper|lower>:<char>   letter:upper:A, letter:lower:a
//   number:<0-20>                 number:7
//   dots:<1-10>                   dots:3                  (a group of dots)
//   figure:<name>                 figure:apple
// Variants:  @r90 | @r180 | @r270 (rotation, clockwise)   @mirror (horizontal flip)

export type ArtifactCategory = "shape" | "color" | "letter" | "number" | "dots" | "figure";

export interface ArtifactAttributes {
  shape?: string;
  color?: string;
  hex?: string;
  char?: string;
  case?: "upper" | "lower";
  value?: number;
  count?: number;
  figure?: string;
  rotation?: 0 | 90 | 180 | 270;
  mirror?: boolean;
}

export interface Artifact {
  id: string;
  category: ArtifactCategory;
  name: string;
  attributes: ArtifactAttributes;
}

export const SHAPES = [
  "circle", "square", "triangle", "rectangle", "star", "heart", "diamond",
  "oval", "pentagon", "hexagon", "crescent", "cross", "arrow",
] as const;

export const COLORS: Record<string, string> = {
  red: "#EF4444",
  blue: "#3B82F6",
  green: "#22C55E",
  yellow: "#FACC15",
  orange: "#F97316",
  purple: "#A855F7",
  pink: "#EC4899",
  brown: "#92400E",
  black: "#111827",
  white: "#FFFFFF",
  grey: "#9CA3AF",
};
export const COLOR_NAMES = Object.keys(COLORS);

// Fill for a shape that has no colour attribute. Deliberately not one of COLORS, so
// shape:circle can never be mistaken for shape:circle:<color>.
export const PLAIN_SHAPE_HEX = "#14B8A6";

export const FIGURES = [
  "apple", "ball", "cat", "fish", "sun", "car", "tree", "house", "flower", "boat", "bird", "cup",
] as const;

export const UPPER_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
export const LOWER_LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
export const NUMBER_MAX = 20;
export const DOTS_MAX = 10;

// --- Variants ---------------------------------------------------------------
// Only orientations that look different from the original (and from each other)
// are offered, so a variant is always a fair "almost the same" distractor.

const SHAPE_ROTATIONS: Record<string, number[]> = {
  triangle: [90, 180, 270],
  arrow: [90, 180, 270],
  crescent: [90, 180, 270],
  heart: [90, 180, 270],
  pentagon: [180],
  star: [180],
  hexagon: [90],
  diamond: [90],
  rectangle: [90],
  oval: [90],
};

// Letters and digits whose mirror image is neither themselves nor another glyph
// (b/d and p/q are excluded: a mirrored "b" is a "d").
const MIRROR_LETTERS = new Set("BCDEFGJKLNPQRSZacefghjkrsyz".split(""));
const MIRROR_NUMBERS = new Set([1, 2, 3, 4, 5, 6, 7, 9]);
const MIRROR_FIGURES = new Set(["fish", "boat", "bird", "cup"]);

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function parseBase(base: string): Artifact | null {
  const parts = base.split(":");
  switch (parts[0]) {
    case "shape": {
      const [, shape, color] = parts;
      if (!(SHAPES as readonly string[]).includes(shape) || parts.length > 3) return null;
      if (color === undefined) {
        return { id: base, category: "shape", name: capitalize(shape), attributes: { shape } };
      }
      if (!COLORS[color]) return null;
      return {
        id: base,
        category: "shape",
        name: `${capitalize(color)} ${shape}`,
        attributes: { shape, color, hex: COLORS[color] },
      };
    }
    case "color": {
      const color = parts[1];
      if (parts.length !== 2 || !COLORS[color]) return null;
      return {
        id: base,
        category: "color",
        name: capitalize(color),
        attributes: { color, hex: COLORS[color] },
      };
    }
    case "letter": {
      const [, letterCase, char] = parts;
      if (parts.length !== 3) return null;
      if (letterCase === "upper" && UPPER_LETTERS.includes(char)) {
        return { id: base, category: "letter", name: `Uppercase ${char}`, attributes: { char, case: "upper" } };
      }
      if (letterCase === "lower" && LOWER_LETTERS.includes(char)) {
        return { id: base, category: "letter", name: `Lowercase ${char}`, attributes: { char, case: "lower" } };
      }
      return null;
    }
    case "number": {
      const value = Number(parts[1]);
      if (parts.length !== 2 || !/^\d+$/.test(parts[1]) || value > NUMBER_MAX) return null;
      return { id: base, category: "number", name: `Number ${value}`, attributes: { value } };
    }
    case "dots": {
      const count = Number(parts[1]);
      if (parts.length !== 2 || !/^\d+$/.test(parts[1]) || count < 1 || count > DOTS_MAX) return null;
      return {
        id: base,
        category: "dots",
        name: `${count} dot${count === 1 ? "" : "s"}`,
        attributes: { count },
      };
    }
    case "figure": {
      const figure = parts[1];
      if (parts.length !== 2 || !(FIGURES as readonly string[]).includes(figure)) return null;
      return { id: base, category: "figure", name: capitalize(figure), attributes: { figure } };
    }
    default:
      return null;
  }
}

/** Variant suffixes (without the "@") that produce a visibly different artifact. */
export function variantSuffixes(base: Artifact, kinds: readonly string[]): string[] {
  const out: string[] = [];
  const a = base.attributes;
  if (kinds.includes("rotation") && base.category === "shape" && a.shape) {
    for (const deg of SHAPE_ROTATIONS[a.shape] || []) out.push(`r${deg}`);
  }
  if (kinds.includes("mirror")) {
    const mirrors =
      (base.category === "letter" && MIRROR_LETTERS.has(a.char!)) ||
      (base.category === "number" && MIRROR_NUMBERS.has(a.value!)) ||
      (base.category === "figure" && MIRROR_FIGURES.has(a.figure!));
    if (mirrors) out.push("mirror");
  }
  return out;
}

/** Resolves any artifact id (including variants) to its artifact, or null if invalid. */
export function getArtifact(id: string): Artifact | null {
  if (typeof id !== "string" || id.length > 60) return null;
  const [baseId, variant, extra] = id.split("@");
  if (extra !== undefined) return null;
  const base = parseBase(baseId);
  if (!base) return null;
  if (variant === undefined) return base;

  if (!variantSuffixes(base, ["rotation", "mirror"]).includes(variant)) return null;
  if (variant === "mirror") {
    return {
      id,
      category: base.category,
      name: `${base.name} (mirrored)`,
      attributes: { ...base.attributes, mirror: true },
    };
  }
  const rotation = Number(variant.slice(1)) as 90 | 180 | 270;
  return {
    id,
    category: base.category,
    name: `${base.name} (rotated ${rotation}°)`,
    attributes: { ...base.attributes, rotation },
  };
}

/** Strips the variant suffix. */
export const baseIdOf = (id: string): string => id.split("@")[0];

// --- Pools used by the level configs ------------------------------------------

export const POOLS: Record<string, string[]> = {
  shapes: SHAPES.map((s) => `shape:${s}`),
  colors: COLOR_NAMES.map((c) => `color:${c}`),
  letters_upper: UPPER_LETTERS.map((c) => `letter:upper:${c}`),
  letters_lower: LOWER_LETTERS.map((c) => `letter:lower:${c}`),
  numbers: Array.from({ length: NUMBER_MAX + 1 }, (_, n) => `number:${n}`),
  figures: FIGURES.map((f) => `figure:${f}`),
  colored_shapes: SHAPES.flatMap((s) => COLOR_NAMES.map((c) => `shape:${s}:${c}`)),
};

/** Every base artifact (no variants), for the public registry endpoint. */
export function listArtifacts(): Artifact[] {
  const ids = [
    ...POOLS.shapes,
    ...POOLS.colors,
    ...POOLS.letters_upper,
    ...POOLS.letters_lower,
    ...POOLS.numbers,
    ...Array.from({ length: DOTS_MAX }, (_, n) => `dots:${n + 1}`),
    ...POOLS.figures,
    ...POOLS.colored_shapes,
  ];
  return ids.map((id) => getArtifact(id)!);
}

// --- Similarity ---------------------------------------------------------------
// Groups of things young children commonly confuse. Used to pick distractors that
// look closer to the target as the level's similarity setting rises.

const SIMILAR_SHAPES = [
  ["circle", "oval", "crescent"],
  ["square", "rectangle", "diamond"],
  ["triangle", "pentagon", "hexagon", "star"],
  ["cross", "arrow", "heart"],
];
const SIMILAR_COLORS = [
  ["red", "orange", "pink"],
  ["blue", "purple"],
  ["green", "yellow"],
  ["brown", "black", "grey", "white"],
];
const SIMILAR_UPPER = ["EF", "OQCGD", "MNW", "PRB", "ILTJ", "UVY", "KX", "AH", "SZ"];
const SIMILAR_LOWER = ["bdpq", "nmhu", "iljt", "aoec", "vwy", "gq", "rn", "sz", "kx", "ft"];
const SIMILAR_NUMBERS = [
  [6, 9, 8, 0],
  [1, 7],
  [2, 5],
  [3, 8],
  [12, 21],
  [13, 18],
  [16, 19],
  [10, 0],
  [11, 17],
  [14, 4],
  [15, 5],
  [20, 2],
];
const SIMILAR_FIGURES = [
  ["apple", "ball", "sun"],
  ["cat", "bird", "fish"],
  ["car", "boat"],
  ["tree", "flower"],
  ["house", "cup"],
];

const neighbours = <T,>(groups: readonly (readonly T[])[], value: T): T[] => {
  const out: T[] = [];
  for (const group of groups) {
    if (group.includes(value)) {
      for (const member of group) if (member !== value && !out.includes(member)) out.push(member);
    }
  }
  return out;
};

/** Base ids (same category) that look similar to `base`. */
export function similarBaseIds(base: Artifact): string[] {
  const a = base.attributes;
  switch (base.category) {
    case "shape": {
      const shapes = neighbours(SIMILAR_SHAPES, a.shape!);
      if (!a.color) return shapes.map((s) => `shape:${s}`);
      // Attribute combinations: a similar shape in the same colour, or the same shape
      // in a similar colour.
      return [
        ...shapes.map((s) => `shape:${s}:${a.color}`),
        ...neighbours(SIMILAR_COLORS, a.color).map((c) => `shape:${a.shape}:${c}`),
      ];
    }
    case "color":
      return neighbours(SIMILAR_COLORS, a.color!).map((c) => `color:${c}`);
    case "letter": {
      const groups = (a.case === "upper" ? SIMILAR_UPPER : SIMILAR_LOWER).map((g) => g.split(""));
      const sameCase = neighbours(groups, a.char!).map((c) => `letter:${a.case}:${c}`);
      // The other case of the same letter is the classic look-alike.
      const other =
        a.case === "upper"
          ? `letter:lower:${a.char!.toLowerCase()}`
          : `letter:upper:${a.char!.toUpperCase()}`;
      return [...sameCase, other];
    }
    case "number": {
      const v = a.value!;
      const near = [v - 1, v + 1].filter((n) => n >= 0 && n <= NUMBER_MAX);
      const all = [...neighbours(SIMILAR_NUMBERS, v), ...near];
      return Array.from(new Set(all)).map((n) => `number:${n}`);
    }
    case "figure":
      return neighbours(SIMILAR_FIGURES, a.figure!).map((f) => `figure:${f}`);
    default:
      return [];
  }
}

/**
 * For a coloured shape: the closest possible look-alikes — the same shape in every
 * other colour and the same colour on every other shape (a red triangle versus a blue
 * triangle versus a red circle).
 */
export function attributeSiblings(base: Artifact): string[] {
  const a = base.attributes;
  if (base.category !== "shape" || !a.color) return [];
  return [
    ...COLOR_NAMES.filter((c) => c !== a.color).map((c) => `shape:${a.shape}:${c}`),
    ...SHAPES.filter((s) => s !== a.shape).map((s) => `shape:${s}:${a.color}`),
  ];
}
