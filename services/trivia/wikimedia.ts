import axios from "axios";
import { IMAGE_MAX_BYTES } from "../upload/image.service";

// Free image source for trivia: Wikidata picks the well-known things in a category,
// Wikimedia Commons supplies the picture together with its licence and author.
// Neither needs an API key; Wikimedia asks for a User-Agent that says who is calling.

const SPARQL_URL = "https://query.wikidata.org/sparql";
const COMMONS_API_URL = "https://commons.wikimedia.org/w/api.php";

const userAgent = () =>
  `PazzellTrivia/1.0 (${process.env.WIKIMEDIA_CONTACT || process.env.FRONTEND_URL || "pazzell"})`;

export interface ImportCategory {
  key: string;
  // Topic the cards go into when the request names none (created if it does not exist).
  topicName: string;
  topicSlug: string;
  topicDescription: string;
  prompt: string; // caption shown with the image
  people: boolean; // people can be narrowed to a country, and get same-gender wrong options
  imageProperty: "P18" | "P154"; // photo, or logo
  where: string; // SPARQL pattern binding ?item
  // Without a country the people classes are huge; this keeps the query to famous entries.
  minSitelinks?: number;
}

const occupation = (...ids: string[]) =>
  `VALUES ?occupation { ${ids.map((id) => `wd:${id}`).join(" ")} } ?item wdt:P106 ?occupation. ` +
  // Keeps historical figures who merely carry the occupation out of the results.
  `?item wdt:P569 ?born. FILTER(YEAR(?born) >= 1930)`;

// To add a category, add an entry here: `where` is any Wikidata pattern that binds ?item.
export const IMPORT_CATEGORIES: ImportCategory[] = [
  {
    key: "animals",
    topicName: "Animals",
    topicSlug: "animals",
    topicDescription: "Name the animal in the picture.",
    prompt: "Which animal is this?",
    people: false,
    imageProperty: "P18",
    where: "?item wdt:P31 wd:Q55983715; wdt:P279* wd:Q729. FILTER(?item NOT IN (wd:Q729, wd:Q5))",
  },
  {
    key: "plants",
    topicName: "Plants",
    topicSlug: "plants",
    topicDescription: "Name the plant in the picture.",
    prompt: "Which plant is this?",
    people: false,
    imageProperty: "P18",
    where: "?item wdt:P31 wd:Q55983715; wdt:P279* wd:Q756. FILTER(?item != wd:Q756)",
  },
  {
    key: "food",
    topicName: "Food",
    topicSlug: "food",
    topicDescription: "Dishes, fruits and things we eat.",
    prompt: "What is this?",
    people: false,
    imageProperty: "P18",
    where:
      "{ ?item wdt:P279* wd:Q746549 } UNION { ?item wdt:P31 wd:Q746549 } UNION { ?item wdt:P279* wd:Q3314483 }",
  },
  {
    key: "tech",
    topicName: "Tech",
    topicSlug: "tech",
    topicDescription: "Companies, apps, languages and the tools behind them.",
    prompt: "Whose logo is this?",
    people: false,
    imageProperty: "P154",
    where:
      "VALUES ?class { wd:Q9143 wd:Q9135 wd:Q6368 wd:Q3220391 wd:Q18388277 } ?item wdt:P31 ?class.",
  },
  {
    key: "footballers",
    topicName: "Football",
    topicSlug: "football",
    topicDescription: "Rules, positions and famous faces from the beautiful game.",
    prompt: "Who is this footballer?",
    people: true,
    imageProperty: "P18",
    where: occupation("Q937857"),
    minSitelinks: 60,
  },
  {
    key: "musicians",
    topicName: "Musicians",
    topicSlug: "musicians",
    topicDescription: "Singers, rappers and the faces of music.",
    prompt: "Who is this musician?",
    people: true,
    imageProperty: "P18",
    where: occupation("Q177220", "Q2252262"),
    minSitelinks: 80,
  },
  {
    key: "celebrities",
    topicName: "Celebrities",
    topicSlug: "celebrities",
    topicDescription: "Actors, comedians and screen stars.",
    prompt: "Who is this?",
    people: true,
    imageProperty: "P18",
    where: occupation("Q33999", "Q10798782", "Q245068"),
    minSitelinks: 80,
  },
  {
    key: "pastors",
    topicName: "Pastors",
    topicSlug: "pastors",
    topicDescription: "Well-known pastors and preachers.",
    prompt: "Who is this pastor?",
    people: true,
    imageProperty: "P18",
    where: occupation("Q152002", "Q30107072"),
  },
];

export const getImportCategory = (key: any): ImportCategory | undefined =>
  IMPORT_CATEGORIES.find((c) => c.key === key);

// Countries accepted by name; any other country works by its Wikidata id (e.g. "Q1033").
export const IMPORT_COUNTRIES: Record<string, string> = {
  nigeria: "Q1033",
  ghana: "Q117",
  kenya: "Q114",
  "south africa": "Q258",
  "united kingdom": "Q145",
  "united states": "Q30",
};

// The country whose people are mixed in with worldwide ones by default.
export const HOME_COUNTRY_ID = IMPORT_COUNTRIES.nigeria;
export const COUNTRY_MIXED = "mixed";
export const COUNTRY_WORLDWIDE = "worldwide";

/**
 * Which people to fetch, as a list of country ids to query (undefined = worldwide):
 *  - nothing or "mixed": home-country and worldwide people, alternating;
 *  - "worldwide": no country filter;
 *  - a country name or Wikidata id: that country only.
 * Returns undefined when the value is none of these.
 */
export function resolveCountryScopes(value: any): (string | undefined)[] | undefined {
  if (value === undefined || value === null || value === "") return [HOME_COUNTRY_ID, undefined];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (lower === COUNTRY_MIXED) return [HOME_COUNTRY_ID, undefined];
  if (lower === COUNTRY_WORLDWIDE) return [undefined];
  if (/^Q\d+$/.test(trimmed)) return [trimmed];
  return IMPORT_COUNTRIES[lower] ? [IMPORT_COUNTRIES[lower]] : undefined;
}

export interface WikidataEntity {
  id: string; // Wikidata id, e.g. "Q615"
  label: string;
  fileName: string; // Commons file name, without the "File:" prefix
  gender?: string;
}

/** The best-known entries of a category that have a picture, most famous first. */
export async function fetchEntities(
  category: ImportCategory,
  limit: number,
  countryId?: string
): Promise<WikidataEntity[]> {
  const narrowed = category.people && countryId;
  const query = `SELECT ?item ?itemLabel ?image ?gender ?links WHERE {
    ${category.where}
    ${narrowed ? `?item wdt:P27 wd:${countryId}.` : ""}
    ?item wdt:${category.imageProperty} ?image; wikibase:sitelinks ?links.
    ${!narrowed && category.minSitelinks ? `FILTER(?links > ${category.minSitelinks})` : ""}
    OPTIONAL { ?item wdt:P21 ?gender }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  } ORDER BY DESC(?links) LIMIT ${limit}`;

  const response = await axios.get(SPARQL_URL, {
    params: { query, format: "json" },
    headers: { "User-Agent": userAgent(), Accept: "application/sparql-results+json" },
    timeout: 70_000,
  });

  const seen = new Set<string>();
  const entities: WikidataEntity[] = [];
  for (const row of (response.data as any)?.results?.bindings || []) {
    const id = String(row.item?.value || "").split("/").pop() as string;
    const label = String(row.itemLabel?.value || "").trim();
    const encodedName = String(row.image?.value || "").split("Special:FilePath/")[1];
    // An item with several images or genders comes back once per combination; a label
    // equal to the id means the item has no English name.
    if (!id || seen.has(id) || !label || /^Q\d+$/.test(label) || !encodedName) continue;
    seen.add(id);
    entities.push({
      id,
      label,
      fileName: decodeURIComponent(encodedName).replace(/_/g, " "),
      gender: row.gender?.value ? String(row.gender.value).split("/").pop() : undefined,
    });
  }
  return entities;
}

export interface CommonsImage {
  url: string; // a rendition about 800px wide (PNG/JPG even when the original is SVG/TIFF)
  license: string;
  artist: string;
}

const stripHtml = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Licence, author and a download URL for each Commons file, keyed by file name. */
export async function fetchCommonsImages(fileNames: string[]): Promise<Map<string, CommonsImage>> {
  const found = new Map<string, CommonsImage>();
  for (let i = 0; i < fileNames.length; i += 50) {
    const response = await axios.get(COMMONS_API_URL, {
      params: {
        action: "query",
        format: "json",
        prop: "imageinfo",
        iiprop: "url|extmetadata",
        iiurlwidth: 800,
        iiextmetadatafilter: "LicenseShortName|Artist",
        titles: fileNames.slice(i, i + 50).map((name) => `File:${name}`).join("|"),
      },
      headers: { "User-Agent": userAgent() },
      timeout: 30_000,
    });
    for (const page of Object.values<any>((response.data as any)?.query?.pages || {})) {
      const info = page?.imageinfo?.[0];
      if (!info) continue;
      found.set(String(page.title).replace(/^File:/, ""), {
        url: info.thumburl || info.url,
        license: stripHtml(String(info.extmetadata?.LicenseShortName?.value || "")),
        artist: stripHtml(String(info.extmetadata?.Artist?.value || "")),
      });
    }
  }
  return found;
}

export async function downloadImage(url: string): Promise<Buffer> {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    headers: { "User-Agent": userAgent() },
    timeout: 30_000,
  });
  const buffer = Buffer.from(response.data as ArrayBuffer);
  if (buffer.length > IMAGE_MAX_BYTES) throw new Error("image too large");
  return buffer;
}
