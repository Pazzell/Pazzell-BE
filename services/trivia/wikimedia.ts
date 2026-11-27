import axios from "axios";
import { IMAGE_MAX_BYTES } from "../upload/image.service";
import { PERSON_PROMPT, THING_PROMPT } from "./imagePrompt";
import { frontendUrl } from "../config/frontendUrl";

// Free image source for trivia: Wikidata picks the well-known things in a category,
// Wikimedia Commons supplies the picture together with its licence and author.
// Neither needs an API key; Wikimedia asks for a User-Agent that says who is calling.

const SPARQL_URL = "https://query.wikidata.org/sparql";
const COMMONS_API_URL = "https://commons.wikimedia.org/w/api.php";

const userAgent = () =>
  `PazzellTrivia/1.0 (${process.env.WIKIMEDIA_CONTACT || frontendUrl()})`;

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
  // A fixed list of Commons pictures, for subjects Wikidata has no usable list of
  // (music symbols). When set, nothing is asked of Wikidata and `where` is unused.
  entries?: WikidataEntity[];
  // Without a country the people classes are huge; this keeps the query to famous entries.
  minSitelinks?: number;
}

const occupation = (...ids: string[]) =>
  `VALUES ?occupation { ${ids.map((id) => `wd:${id}`).join(" ")} } ?item wdt:P106 ?occupation. ` +
  // Keeps historical figures who merely carry the occupation out of the results.
  `?item wdt:P569 ?born. FILTER(YEAR(?born) >= 1930)`;

// A music symbol: a Commons file, its name, and the look-alike offered as the wrong option.
const symbol = (label: string, fileName: string, wrong: string): WikidataEntity => ({
  id: `commons:${fileName}`,
  label,
  fileName,
  wrong,
});

const symbols = (level: string, entries: WikidataEntity[]): ImportCategory => ({
  key: `music-symbols-${level.toLowerCase()}`,
  topicName: `Music Theory: ${level}`,
  topicSlug: `music-theory-${level.toLowerCase()}`,
  topicDescription: `Music theory at ${level.toLowerCase()} level: symbols, terms and what they mean.`,
  prompt: THING_PROMPT,
  people: false,
  imageProperty: "P18",
  where: "",
  entries,
});

// To add a category, add an entry here: `where` is any Wikidata pattern that binds ?item.
export const IMPORT_CATEGORIES: ImportCategory[] = [
  {
    key: "animals",
    topicName: "Animals",
    topicSlug: "animals",
    topicDescription: "Name the animal in the picture.",
    prompt: THING_PROMPT,
    people: false,
    imageProperty: "P18",
    where: "?item wdt:P31 wd:Q55983715; wdt:P279* wd:Q729. FILTER(?item NOT IN (wd:Q729, wd:Q5))",
  },
  {
    key: "plants",
    topicName: "Plants",
    topicSlug: "plants",
    topicDescription: "Name the plant in the picture.",
    prompt: THING_PROMPT,
    people: false,
    imageProperty: "P18",
    where: "?item wdt:P31 wd:Q55983715; wdt:P279* wd:Q756. FILTER(?item != wd:Q756)",
  },
  {
    key: "food",
    topicName: "Food",
    topicSlug: "food",
    topicDescription: "Dishes, fruits and things we eat.",
    prompt: THING_PROMPT,
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
    prompt: THING_PROMPT,
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
    prompt: PERSON_PROMPT,
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
    prompt: PERSON_PROMPT,
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
    prompt: PERSON_PROMPT,
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
    prompt: PERSON_PROMPT,
    people: true,
    imageProperty: "P18",
    where: occupation("Q152002", "Q30107072"),
  },
  {
    key: "instruments",
    topicName: "Musical Instruments",
    topicSlug: "musical-instruments",
    topicDescription: "Name the instrument and learn how each one is played.",
    prompt: THING_PROMPT,
    people: false,
    imageProperty: "P18",
    // A chosen list: the class "musical instrument" on Wikidata also holds microphones,
    // loudspeakers and whole families ("string instrument").
    where: `VALUES ?item { ${[
      "Q6607", "Q5994", "Q8355", "Q11404", "Q11405", "Q8338", "Q79838", "Q9798", "Q8343",
      "Q8371", "Q47369", "Q281460", "Q51290", "Q81982", "Q80284", "Q8350", "Q8377", "Q78987",
      "Q46185", "Q80019", "Q165666", "Q302497", "Q131168", "Q128309", "Q8347", "Q163829",
      "Q159998", "Q180733", "Q61285", "Q258896", "Q193666", "Q201129", "Q189737", "Q190172",
      "Q208320", "Q191000", "Q229205", "Q213100", "Q187851", "Q178389", "Q83509", "Q189388",
      "Q201735", "Q83266", "Q537750", "Q1467960", "Q1043002", "Q220971", "Q270200", "Q6610630",
      "Q626035", "Q208421", "Q183932", "Q206987", "Q789141", "Q185041", "Q218802", "Q726306",
      "Q1500255",
    ]
      .map((id) => `wd:${id}`)
      .join(" ")} }`,
  },
  symbols("Beginner", [
    symbol("Staff (stave)", "Music-staff.svg", "Bar line"),
    symbol("Treble clef", "Music-GClef.svg", "Bass clef"),
    symbol("Bass clef", "Music-Fclef.svg", "Treble clef"),
    symbol("Bar line", "Music-bar.svg", "Ledger line"),
    symbol("Double bar line", "Music-doublebar.svg", "Repeat sign"),
    symbol("Final bar line", "Music-endbar.svg", "Double bar line"),
    symbol("Repeat sign", "Music-repeat.svg", "Final bar line"),
    symbol("Whole note (semibreve)", "Music-wholenote.svg", "Half note (minim)"),
    symbol("Half note (minim)", "Music-halfnote.svg", "Quarter note (crotchet)"),
    symbol("Quarter note (crotchet)", "Music-quarternote.svg", "Eighth note (quaver)"),
    symbol("Eighth note (quaver)", "Music-eighthnote.svg", "Sixteenth note (semiquaver)"),
    symbol("Sixteenth note (semiquaver)", "Music-sixteenthnote.svg", "Eighth note (quaver)"),
    symbol("Whole rest (semibreve rest)", "Music-wholerest.svg", "Half rest (minim rest)"),
    symbol("Half rest (minim rest)", "Music-halfrest.svg", "Whole rest (semibreve rest)"),
    symbol("Quarter rest (crotchet rest)", "Music-quarterrest.svg", "Eighth rest (quaver rest)"),
    symbol("Eighth rest (quaver rest)", "Music-eighthrest.svg", "Quarter rest (crotchet rest)"),
    symbol("Sharp", "Music-sharp.svg", "Natural"),
    symbol("Flat", "Music-flat.svg", "Sharp"),
    symbol("Natural", "Music-natural.svg", "Flat"),
    symbol("Time signature", "Music-timesig.svg", "Key signature"),
  ]),
  symbols("Intermediate", [
    symbol("Sixteenth rest (semiquaver rest)", "Music-sixteenthrest.svg", "Eighth rest (quaver rest)"),
    symbol("Dotted note", "Music-dotnote.svg", "Staccato"),
    symbol("Tie", "Music-tie.svg", "Slur"),
    symbol("Slur", "Music-slur.svg", "Tie"),
    symbol("Beam", "Music-beam.svg", "Tie"),
    symbol("Ledger lines", "Music-ledger.svg", "Bar lines"),
    symbol("Triplet", "Music-triplet.svg", "Slur"),
    symbol("Common time", "Music-commontime.svg", "Cut time"),
    symbol("Cut time", "Music-cuttime.svg", "Common time"),
    symbol("Staccato", "Music-staccato.svg", "Tenuto"),
    symbol("Tenuto", "Music-tenuto.svg", "Staccato"),
    symbol("Accent", "Music-marcato.svg", "Tenuto"),
    symbol("Fermata (pause)", "Music-fermata.svg", "Accent"),
    symbol("Crescendo", "Music-crescendo.svg", "Diminuendo"),
    symbol("Diminuendo", "Music-diminuendo.svg", "Crescendo"),
    symbol("Piano (soft)", "Music dynamic piano.svg", "Forte (loud)"),
    symbol("Forte (loud)", "Music dynamic forte.svg", "Piano (soft)"),
    symbol("Mezzo piano (moderately soft)", "Music dynamic mezzo piano.svg", "Mezzo forte (moderately loud)"),
    symbol("Mezzo forte (moderately loud)", "Music dynamic mezzo forte.svg", "Mezzo piano (moderately soft)"),
    symbol("Pianissimo (very soft)", "Music dynamic pianissimo.svg", "Fortissimo (very loud)"),
    symbol("Fortissimo (very loud)", "Music dynamic fortissimo.svg", "Pianissimo (very soft)"),
    symbol("Breath mark", "Music-breath.svg", "Caesura"),
  ]),
  symbols("Advanced", [
    symbol("Alto clef (C clef)", "Music-Cclef.svg", "Bass clef (F clef)"),
    symbol("Percussion clef", "Music-neutralclef.svg", "Alto clef (C clef)"),
    symbol("Double sharp", "Music-doublesharp.svg", "Double flat"),
    symbol("Double flat", "Music-doubleflat.svg", "Double sharp"),
    symbol("Thirty-second note (demisemiquaver)", "Music-thirtysecondnote.svg", "Sixteenth note (semiquaver)"),
    symbol("Thirty-second rest (demisemiquaver rest)", "Music-thirtysecondrest.svg", "Sixteenth rest (semiquaver rest)"),
    symbol("Double whole note (breve)", "Music-doublewholenote.svg", "Whole note (semibreve)"),
    symbol("Trill", "Music-trill.svg", "Mordent"),
    symbol("Mordent", "Music-mordent.svg", "Turn"),
    symbol("Turn", "Music-turn.svg", "Trill"),
    symbol("Tremolo", "Music-tremolo.svg", "Trill"),
    symbol("Appoggiatura", "Music-appoggiatura.svg", "Acciaccatura"),
    symbol("Acciaccatura", "Music-acciaccatura.svg", "Appoggiatura"),
    symbol("Arpeggio (rolled chord)", "Music-arpeggio.svg", "Glissando"),
    symbol("Glissando", "Music-glissando.svg", "Arpeggio (rolled chord)"),
    symbol("Segno", "Music-segno.png", "Coda"),
    symbol("Coda", "Coda sign.svg", "Segno"),
    symbol("Da capo", "Music-dacapo.svg", "Dal segno"),
    symbol("Dal segno", "Music-dalsegno.svg", "Da capo"),
    symbol("Caesura", "Music-caesura.svg", "Breath mark"),
    symbol("Simile mark", "Music-simile.svg", "Repeat sign"),
  ]),
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
  // The wrong option to show, when a random other entry would make the card too easy.
  wrong?: string;
}

/** The best-known entries of a category that have a picture, most famous first. */
export async function fetchEntities(
  category: ImportCategory,
  limit: number,
  countryId?: string
): Promise<WikidataEntity[]> {
  if (category.entries) return category.entries.slice(0, limit);
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
