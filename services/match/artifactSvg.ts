import { Artifact, PLAIN_SHAPE_HEX } from "./artifacts";

// Renders any artifact as a self-contained SVG on a 100x100 viewBox, so it is crisp at
// every size. The frontend may use these strings directly or draw its own components
// from the artifact attributes; both are equivalent.

const FONT = "'Arial Rounded MT Bold','Nunito','Baloo 2',Arial,sans-serif";
const INK = "#111827";

const regularPolygon = (sides: number, radius: number, startDeg: number): string =>
  Array.from({ length: sides }, (_, i) => {
    const angle = ((startDeg + (360 / sides) * i) * Math.PI) / 180;
    return `${(50 + radius * Math.cos(angle)).toFixed(1)},${(50 + radius * Math.sin(angle)).toFixed(1)}`;
  }).join(" ");

const starPoints = (): string =>
  Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 === 0 ? 46 : 19;
    const angle = ((-90 + 36 * i) * Math.PI) / 180;
    return `${(50 + radius * Math.cos(angle)).toFixed(1)},${(52 + radius * Math.sin(angle)).toFixed(1)}`;
  }).join(" ");

function shapeMarkup(shape: string, fill: string): string {
  // A thin outline keeps white and yellow shapes visible on a light background.
  const paint = `fill="${fill}" stroke="#0F172A" stroke-opacity="0.25" stroke-width="2"`;
  switch (shape) {
    case "circle":
      return `<circle cx="50" cy="50" r="40" ${paint}/>`;
    case "square":
      return `<rect x="12" y="12" width="76" height="76" rx="6" ${paint}/>`;
    case "triangle":
      return `<polygon points="50,10 92,86 8,86" ${paint}/>`;
    case "rectangle":
      return `<rect x="6" y="26" width="88" height="48" rx="6" ${paint}/>`;
    case "star":
      return `<polygon points="${starPoints()}" ${paint}/>`;
    case "heart":
      return `<path d="M50 88C20 64 6 46 6 31A22 22 0 0 1 50 27A22 22 0 0 1 94 31C94 46 80 64 50 88Z" ${paint}/>`;
    case "diamond":
      return `<polygon points="50,6 82,50 50,94 18,50" ${paint}/>`;
    case "oval":
      return `<ellipse cx="50" cy="50" rx="44" ry="28" ${paint}/>`;
    case "pentagon":
      return `<polygon points="${regularPolygon(5, 44, -90)}" ${paint}/>`;
    case "hexagon":
      return `<polygon points="${regularPolygon(6, 44, 0)}" ${paint}/>`;
    case "crescent":
      return `<path d="M64 8A44 44 0 1 0 64 92A34 34 0 1 1 64 8Z" ${paint}/>`;
    case "cross":
      return `<polygon points="36,8 64,8 64,36 92,36 92,64 64,64 64,92 36,92 36,64 8,64 8,36 36,36" ${paint}/>`;
    case "arrow":
      return `<polygon points="8,38 56,38 56,16 94,50 56,84 56,62 8,62" ${paint}/>`;
    default:
      return "";
  }
}

function dotsMarkup(count: number): string {
  const cols = count <= 3 ? count : count === 4 ? 2 : count <= 9 ? 3 : 4;
  const rows = Math.ceil(count / cols);
  const cell = 100 / Math.max(cols, rows);
  const radius = cell * 0.32;
  const offsetY = (100 - rows * cell) / 2;
  let out = "";
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, count - row * cols);
    const offsetX = (100 - inRow * cell) / 2;
    const cx = offsetX + cell * ((i % cols) + 0.5);
    const cy = offsetY + cell * (row + 0.5);
    out += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${radius.toFixed(1)}" fill="${INK}"/>`;
  }
  return out;
}

const FIGURE_MARKUP: Record<string, string> = {
  apple:
    '<path d="M50 30C38 20 14 26 14 52c0 22 16 40 28 40 4 0 6-2 8-2s4 2 8 2c12 0 28-18 28-40 0-26-24-32-36-22z" fill="#EF4444"/>' +
    '<path d="M50 30c0-8 4-16 12-20" stroke="#92400E" stroke-width="5" fill="none" stroke-linecap="round"/>' +
    '<path d="M56 18c8-8 20-6 22-4-4 8-14 10-22 4z" fill="#22C55E"/>',
  ball:
    '<circle cx="50" cy="50" r="40" fill="#F97316"/>' +
    '<path d="M10 50h80M50 10v80M22 22c14 14 14 42 0 56M78 22c-14 14-14 42 0 56" stroke="#111827" stroke-width="3" fill="none"/>',
  cat:
    '<polygon points="20,40 24,10 44,28" fill="#F97316"/><polygon points="80,40 76,10 56,28" fill="#F97316"/>' +
    '<circle cx="50" cy="56" r="34" fill="#F97316"/>' +
    '<circle cx="38" cy="50" r="5" fill="#111827"/><circle cx="62" cy="50" r="5" fill="#111827"/>' +
    '<polygon points="46,62 54,62 50,68" fill="#EC4899"/>' +
    '<path d="M50 68v6M30 66H12M30 72l-16 6M70 66h18M70 72l16 6" stroke="#111827" stroke-width="2.5" stroke-linecap="round"/>',
  fish:
    '<polygon points="8,28 8,72 34,50" fill="#3B82F6"/><ellipse cx="58" cy="50" rx="36" ry="24" fill="#3B82F6"/>' +
    '<circle cx="76" cy="44" r="5" fill="#FFFFFF"/><circle cx="77" cy="44" r="2.5" fill="#111827"/>' +
    '<path d="M52 36c8 8 8 20 0 28" stroke="#1D4ED8" stroke-width="3" fill="none"/>',
  sun:
    '<path d="M50 6v14M50 80v14M6 50h14M80 50h14M19 19l10 10M71 71l10 10M81 19L71 29M29 71L19 81" stroke="#F97316" stroke-width="6" stroke-linecap="round"/>' +
    '<circle cx="50" cy="50" r="22" fill="#FACC15"/>',
  car:
    '<path d="M8 64V48l14-4 10-18h36l10 18 14 4v16z" fill="#EF4444"/>' +
    '<path d="M38 32h10v12H31zM54 32h10l7 12H54z" fill="#BFDBFE"/>' +
    '<circle cx="30" cy="66" r="10" fill="#111827"/><circle cx="72" cy="66" r="10" fill="#111827"/>' +
    '<circle cx="30" cy="66" r="4" fill="#9CA3AF"/><circle cx="72" cy="66" r="4" fill="#9CA3AF"/>',
  tree:
    '<rect x="44" y="58" width="12" height="34" fill="#92400E"/><circle cx="50" cy="38" r="30" fill="#22C55E"/>',
  house:
    '<polygon points="50,8 94,46 6,46" fill="#EF4444"/><rect x="16" y="46" width="68" height="46" fill="#FACC15"/>' +
    '<rect x="42" y="62" width="16" height="30" fill="#92400E"/>',
  flower:
    '<path d="M50 60v34" stroke="#22C55E" stroke-width="6" stroke-linecap="round"/>' +
    '<circle cx="50" cy="20" r="13" fill="#EC4899"/><circle cx="71" cy="35" r="13" fill="#EC4899"/>' +
    '<circle cx="63" cy="60" r="13" fill="#EC4899"/><circle cx="37" cy="60" r="13" fill="#EC4899"/>' +
    '<circle cx="29" cy="35" r="13" fill="#EC4899"/><circle cx="50" cy="42" r="11" fill="#FACC15"/>',
  boat:
    '<path d="M8 64h84l-14 24H22z" fill="#92400E"/><rect x="47" y="14" width="5" height="50" fill="#111827"/>' +
    '<polygon points="52,16 86,54 52,54" fill="#3B82F6"/>',
  bird:
    '<path d="M40 80v12M52 80v12" stroke="#F97316" stroke-width="4" stroke-linecap="round"/>' +
    '<ellipse cx="46" cy="58" rx="30" ry="22" fill="#FACC15"/><circle cx="72" cy="38" r="16" fill="#FACC15"/>' +
    '<polygon points="86,36 98,42 86,46" fill="#F97316"/><circle cx="76" cy="34" r="3" fill="#111827"/>' +
    '<path d="M34 54c10-8 22-8 30 2-8 8-20 10-30-2z" fill="#F97316"/>',
  cup:
    '<path d="M72 32h8a12 12 0 0 1 0 24h-8" stroke="#A855F7" stroke-width="7" fill="none"/>' +
    '<path d="M18 22h54v40a22 22 0 0 1-22 22H40a22 22 0 0 1-22-22z" fill="#A855F7"/>',
};

const escapeXml = (value: string): string =>
  value.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

function textMarkup(text: string, fontSize: number): string {
  return `<text x="50" y="52" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-weight="700" font-size="${fontSize}" fill="${INK}">${escapeXml(text)}</text>`;
}

function bodyMarkup(artifact: Artifact): string {
  const a = artifact.attributes;
  switch (artifact.category) {
    case "shape":
      return shapeMarkup(a.shape!, a.hex || PLAIN_SHAPE_HEX);
    case "color":
      return `<rect x="8" y="8" width="84" height="84" rx="16" fill="${a.hex}" stroke="#0F172A" stroke-opacity="0.25" stroke-width="2"/>`;
    case "letter":
      return textMarkup(a.char!, 76);
    case "number":
      return textMarkup(String(a.value), a.value! >= 10 ? 58 : 76);
    case "dots":
      return dotsMarkup(a.count!);
    case "figure":
      return FIGURE_MARKUP[a.figure!] || "";
    default:
      return "";
  }
}

export function renderArtifactSvg(artifact: Artifact): string {
  let body = bodyMarkup(artifact);
  const { rotation, mirror } = artifact.attributes;
  if (rotation) body = `<g transform="rotate(${rotation} 50 50)">${body}</g>`;
  if (mirror) body = `<g transform="translate(100 0) scale(-1 1)">${body}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="${escapeXml(artifact.name)}">${body}</svg>`;
}
