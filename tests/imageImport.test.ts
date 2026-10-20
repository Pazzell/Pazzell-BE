import sharp from "sharp";
import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import { api, createUser, resetState } from "./helpers";
import TriviaCardModel from "../models/triviaCard.model";
import TriviaTopicModel from "../models/triviaTopic.model";
import { pickMixedCards } from "../services/trivia/mix";
import {
  buildAttribution,
  interleaveEntities,
  isAllowedLicense,
  onWhite,
  pickDistractor,
} from "../services/trivia/imageImport.service";
import * as wikimedia from "../services/trivia/wikimedia";

const card = (type: "image" | "definition", id: number) => ({ type, id });
const cards = (images: number, definitions: number) => [
  ...Array.from({ length: images }, (_, i) => card("image", i)),
  ...Array.from({ length: definitions }, (_, i) => card("definition", i)),
];
const countOf = (picked: { type: string }[], type: string) =>
  picked.filter((c) => c.type === type).length;

describe("Session card mix", () => {
  it("picks 70% image cards and 30% definitions when both are plentiful", () => {
    const picked = pickMixedCards(cards(40, 40), 10, 70);
    expect(picked).toHaveLength(10);
    expect(countOf(picked, "image")).toBe(7);
    expect(countOf(picked, "definition")).toBe(3);
    expect(new Set(picked).size).toBe(10); // no card twice
  });

  it("rounds the image share to the nearest card", () => {
    expect(countOf(pickMixedCards(cards(40, 40), 5, 70), "image")).toBe(4); // 3.5 -> 4
    expect(countOf(pickMixedCards(cards(40, 40), 6, 70), "image")).toBe(4); // 4.2 -> 4
  });

  it("fills with the other type when one runs short", () => {
    const fewImages = pickMixedCards(cards(2, 40), 10, 70);
    expect(countOf(fewImages, "image")).toBe(2);
    expect(countOf(fewImages, "definition")).toBe(8);

    const fewDefinitions = pickMixedCards(cards(40, 1), 10, 70);
    expect(countOf(fewDefinitions, "image")).toBe(9);
    expect(countOf(fewDefinitions, "definition")).toBe(1);

    expect(pickMixedCards(cards(0, 12), 10, 70)).toHaveLength(10);
    expect(pickMixedCards(cards(3, 2), 10, 70)).toHaveLength(5);
  });
});

describe("Image import rules", () => {
  it("puts a transparent picture on a white background and leaves the others alone", async () => {
    const transparent = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const flattened = await onWhite(transparent);
    expect((await sharp(flattened).metadata()).hasAlpha).toBe(false);
    const { data } = await sharp(flattened).raw().toBuffer({ resolveWithObject: true });
    expect([data[0], data[1], data[2]]).toEqual([255, 255, 255]);

    const photo = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#f59e0b" } })
      .jpeg()
      .toBuffer();
    expect(await onWhite(photo)).toBe(photo);
  });

  it("accepts only free licences", () => {
    for (const ok of ["CC0", "CC BY 4.0", "CC BY-SA 3.0 de", "CC BY-SA 4.0", "Public domain", "PD-textlogo"]) {
      expect(isAllowedLicense(ok)).toBe(true);
    }
    for (const bad of ["", "CC BY-NC 2.0", "CC BY-NC-SA 4.0", "CC BY-ND 2.0", "Fair use", "GFDL", "Copyrighted"]) {
      expect(isAllowedLicense(bad)).toBe(false);
    }
  });

  it("credits the author, the licence and the source", () => {
    expect(buildAttribution({ url: "", artist: "Jane Doe", license: "CC BY-SA 4.0" })).toBe(
      "Jane Doe · CC BY-SA 4.0 · Wikimedia Commons"
    );
    expect(buildAttribution({ url: "", artist: "", license: "Public domain" })).toBe(
      "Public domain · Wikimedia Commons"
    );
  });

  it("picks a wrong option of the same gender for people, never the answer itself", () => {
    const pool = [
      { id: "Q1", label: "Ada", fileName: "a.jpg", gender: "Q6581072" },
      { id: "Q2", label: "Bola", fileName: "b.jpg", gender: "Q6581072" },
      { id: "Q3", label: "Chidi", fileName: "c.jpg", gender: "Q6581097" },
      { id: "Q4", label: "ada", fileName: "d.jpg", gender: "Q6581072" },
    ];
    for (let i = 0; i < 20; i++) expect(pickDistractor(pool[0], pool, true)).toBe("Bola");
    expect(pickDistractor(pool[2], pool, true)).not.toBe("Chidi"); // falls back to the rest
    expect(pickDistractor(pool[0], [pool[0]], true)).toBeUndefined();
  });
});

describe("Mixing home-country and worldwide people", () => {
  const entity = (id: string) => ({ id, label: id, fileName: `${id}.jpg` });

  it("alternates between the lists and drops repeats", () => {
    const home = [entity("N1"), entity("N2"), entity("N3")];
    const world = [entity("W1"), entity("N1"), entity("W2"), entity("W3")];
    expect(interleaveEntities([home, world]).map((e) => e.id)).toEqual([
      "N1", "W1", "N2", "N3", "W2", "W3",
    ]);
    expect(interleaveEntities([])).toEqual([]);
  });

  it("defaults to mixed, and accepts worldwide or a single country", () => {
    expect(wikimedia.resolveCountryScopes(undefined)).toEqual(["Q1033", undefined]);
    expect(wikimedia.resolveCountryScopes("Mixed")).toEqual(["Q1033", undefined]);
    expect(wikimedia.resolveCountryScopes("worldwide")).toEqual([undefined]);
    expect(wikimedia.resolveCountryScopes("Ghana")).toEqual(["Q117"]);
    expect(wikimedia.resolveCountryScopes("Q30")).toEqual(["Q30"]);
    expect(wikimedia.resolveCountryScopes("atlantis")).toBeUndefined();
  });
});

describe("POST /admin/trivia/import", () => {
  const entities = [
    { id: "Q10", label: "lion", fileName: "Lion.jpg" },
    { id: "Q11", label: "zebra", fileName: "Zebra.jpg" },
    { id: "Q12", label: "hippo", fileName: "Hippo.jpg" },
    { id: "Q13", label: "okapi", fileName: "Okapi.jpg" },
  ];
  const png = () =>
    sharp({ create: { width: 900, height: 600, channels: 3, background: "#f59e0b" } }).png().toBuffer();
  const importCards = (auth: any, body: any) =>
    api().post("/api/v1/admin/trivia/import").set(auth).send(body);

  beforeAll(connectTestDB);
  beforeEach(async () => {
    const buffer = await png();
    jest.spyOn(wikimedia, "fetchEntities").mockResolvedValue(entities);
    jest.spyOn(wikimedia, "fetchCommonsImages").mockResolvedValue(
      new Map([
        ["Lion.jpg", { url: "https://img.test/lion", license: "CC BY-SA 4.0", artist: "A. Photographer" }],
        ["Zebra.jpg", { url: "https://img.test/zebra", license: "CC BY-NC 2.0", artist: "B" }],
        ["Hippo.jpg", { url: "https://img.test/hippo", license: "Public domain", artist: "" }],
        ["Okapi.jpg", { url: "https://img.test/okapi", license: "CC0", artist: "C" }],
      ])
    );
    jest.spyOn(wikimedia, "downloadImage").mockResolvedValue(buffer);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await resetState();
  });
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  it("stores the pictures and adds them to the category's topic as image cards", async () => {
    const admin = await createUser({ role: "admin" });
    const res = await importCards(admin.auth, { category: "animals", count: 3 });
    expect(res.status).toBe(201);
    expect(res.body.import).toMatchObject({
      category: "animals",
      created: 3,
      skipped: { unusableLicense: 1, imageFailed: 0, noWrongOption: 0 },
    });

    const topic = await TriviaTopicModel.findOne({ slug: "animals" }).lean();
    expect(String(topic!._id)).toBe(res.body.import.topic.id);
    const stored = await TriviaCardModel.find({ topicId: String(topic!._id) }).lean();
    expect(stored.map((c) => c.sourceRef).sort()).toEqual(["Q10", "Q12", "Q13"]);

    const lion = stored.find((c) => c.sourceRef === "Q10")!;
    expect(lion).toMatchObject({
      type: "image",
      source: "wikidata",
      attribution: "A. Photographer · CC BY-SA 4.0 · Wikimedia Commons",
    });
    // Our own stored copy, never the source's URL.
    expect(lion.imageUrl).toMatch(/^https:\/\/storage\.pazzell\.test\/pazzell\/cards\/[0-9a-f-]{36}\.webp$/);
    expect(lion.options[lion.correctOptionIndex]).toBe("Lion");
    expect(["Zebra", "Hippo", "Okapi"]).toContain(lion.options[1 - lion.correctOptionIndex]);
  });

  it("never imports the same subject into a topic twice", async () => {
    const admin = await createUser({ role: "admin" });
    await importCards(admin.auth, { category: "animals", count: 3 });
    const again = await importCards(admin.auth, { category: "animals", count: 3 });
    expect(again.body.import.created).toBe(0);
    expect(await TriviaCardModel.countDocuments({})).toBe(3);
  });

  it("can import into a topic the admin chose", async () => {
    const admin = await createUser({ role: "admin" });
    const topic = await TriviaTopicModel.create({ name: "Wildlife", slug: "wildlife", createdBy: admin.id });
    const res = await importCards(admin.auth, { category: "animals", count: 1, topicId: String(topic._id) });
    expect(res.body.import).toMatchObject({ created: 1, topic: { slug: "wildlife" } });
    expect(await TriviaTopicModel.countDocuments({})).toBe(1);
  });

  it("shows the image credit to players and serves a 70/30 mix", async () => {
    const admin = await createUser({ role: "admin" });
    const player = await createUser();
    const { topic } = (await importCards(admin.auth, { category: "animals", count: 3 })).body.import;
    await TriviaCardModel.insertMany(
      Array.from({ length: 10 }, (_, i) => ({
        topicId: topic.id,
        type: "definition",
        text: `Definition ${i}`,
        options: ["Yes", "No"],
        correctOptionIndex: 0,
      }))
    );

    const start = await api()
      .post("/api/v1/trivia/sessions")
      .set(player.auth)
      .send({ sourceType: "topic", sourceId: topic.id, timerSeconds: 5, cardCount: 5 });
    expect(start.status).toBe(201);
    const session = `/api/v1/trivia/sessions/${start.body.session.id}`;
    const questions: any[] = [];
    for (let index = 0; index < 5; index++) {
      questions.push((await api().get(`${session}/question`).set(player.auth)).body.question);
      await api().post(`${session}/answer`).set(player.auth).send({ questionIndex: index, optionIndex: 0 });
    }
    const images = questions.filter((q) => q.type === "image");
    // 70% of 5 is 4 image cards, but only 3 exist: the definitions fill the gap.
    expect(images).toHaveLength(3);
    for (const image of images) expect(image.attribution).toContain("Wikimedia Commons");
    expect(questions.find((q) => q.type === "definition").attribution).toBeNull();
  });

  it("imports music symbols from a fixed list, with the look-alike as the wrong option", async () => {
    jest.restoreAllMocks();
    const category = wikimedia.getImportCategory("music-symbols-beginner")!;
    // No request is made: the list is in the code.
    const listed = await wikimedia.fetchEntities(category, 3);
    expect(listed.map((e) => e.label)).toEqual(["Staff (stave)", "Treble clef", "Bass clef"]);

    const buffer = await png();
    jest.spyOn(wikimedia, "fetchCommonsImages").mockResolvedValue(
      new Map(listed.map((e) => [e.fileName, { url: "https://img.test/s", license: "Public domain", artist: "" }]))
    );
    jest.spyOn(wikimedia, "downloadImage").mockResolvedValue(buffer);

    const admin = await createUser({ role: "admin" });
    const res = await importCards(admin.auth, { category: "music-symbols-beginner", count: 3 });
    expect(res.body.import).toMatchObject({ created: 3, topic: { slug: "music-theory-beginner" } });
    const treble = (await TriviaCardModel.findOne({ sourceRef: "commons:Music-GClef.svg" }).lean())!;
    expect(treble.text).toBe("What is this?");
    expect(treble.options[treble.correctOptionIndex]).toBe("Treble clef");
    expect(treble.options[1 - treble.correctOptionIndex]).toBe("Bass clef");
  });

  it("mixes home-country and worldwide people unless a country is named", async () => {
    const admin = await createUser({ role: "admin" });
    const fetchEntities = jest.spyOn(wikimedia, "fetchEntities");

    await importCards(admin.auth, { category: "pastors", count: 1 });
    expect(fetchEntities.mock.calls.map((call) => call[2])).toEqual(["Q1033", undefined]);

    fetchEntities.mockClear();
    await importCards(admin.auth, { category: "pastors", count: 1, country: "ghana" });
    expect(fetchEntities.mock.calls.map((call) => call[2])).toEqual(["Q117"]);

    // Things that are not people are never narrowed by country.
    fetchEntities.mockClear();
    await importCards(admin.auth, { category: "animals", count: 1, country: "ghana" });
    expect(fetchEntities.mock.calls.map((call) => call[2])).toEqual([undefined]);

    // One of the two lists failing does not stop a mixed import.
    fetchEntities.mockClear();
    fetchEntities.mockRejectedValueOnce(new Error("timeout"));
    const partial = await importCards(admin.auth, { category: "musicians", count: 1 });
    expect(partial.body.import.created).toBe(1);
  });

  it("validates the request and is admin-only", async () => {
    const admin = await createUser({ role: "admin" });
    const gamer = await createUser();

    expect((await importCards(gamer.auth, { category: "animals" })).status).toBe(403);
    expect((await importCards(admin.auth, { category: "dragons" })).body.code).toBe("INVALID_IMPORT_CATEGORY");
    expect((await importCards(admin.auth, { category: "animals", count: 500 })).body.code).toBe("INVALID_IMPORT_COUNT");
    expect((await importCards(admin.auth, { category: "pastors", country: "atlantis" })).body.code).toBe(
      "INVALID_IMPORT_COUNTRY"
    );

    const list = await api().get("/api/v1/admin/trivia/import/categories").set(admin.auth);
    expect(list.body.categories.map((c: any) => c.key)).toEqual(
      expect.arrayContaining(["animals", "plants", "food", "tech", "footballers", "musicians", "celebrities", "pastors"])
    );
  });

  it("reports an unreachable image source as a 502", async () => {
    const admin = await createUser({ role: "admin" });
    jest.spyOn(wikimedia, "fetchEntities").mockRejectedValue(new Error("timeout"));
    const res = await importCards(admin.auth, { category: "animals" });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("IMPORT_SOURCE_UNAVAILABLE");
  });
});
