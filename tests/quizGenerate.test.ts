import JSZip from "jszip";
import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection, redis } from "../utils/redis";
import { api, createUser, resetState, DAY_MS, TestUser } from "./helpers";
import CustomQuizCardModel from "../models/customQuizCard.model";
import { setConfigValue } from "../services/config/config.service";
import * as claude from "../services/quizGen/claude";
import { cleanText, detectDocumentKind, extractDocumentText } from "../services/quizGen/extract";
import {
  PROMPT_MAX_CHARS,
  excerptForPrompt,
  fingerprint,
  verifyCandidates,
} from "../services/quizGen/generate.service";

const base = "/api/v1/custom-quizzes";

const FACTS = [
  "The accounting equation states that assets equal liabilities plus owner's equity.",
  "Depreciation is the systematic allocation of the cost of a fixed asset over its useful life.",
  "A trial balance is a list of all ledger balances prepared to check arithmetical accuracy.",
  "The going concern concept assumes that a business will continue to operate for the foreseeable future.",
  "Accrued expenses are expenses that have been incurred but not yet paid at the reporting date.",
  "Goodwill is an intangible asset that arises when a business is bought for more than its net assets.",
];
const MATERIAL = FACTS.join("\n");

const candidate = (i: number, extra: Partial<claude.CardCandidate> = {}): claude.CardCandidate => ({
  statement: `Question about fact ${i}?`,
  correctAnswer: `Right answer ${i}`,
  wrongAnswer: `Wrong answer ${i}`,
  quote: FACTS[i % FACTS.length],
  ...extra,
});

/** A one-page PDF with real text, built by hand so the suite needs no fixture file. */
function makePdf(lines: string[]): Buffer {
  const content =
    "BT /F1 12 Tf 72 720 Td 14 TL " +
    lines.map((l) => `(${l.replace(/[()\\]/g, "\\$&")}) Tj T*`).join(" ") +
    " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => (pdf += `${String(o).padStart(10, "0")} 00000 n \n`));
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  zip.file(
    "word/document.xml",
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("") +
      "</w:body></w:document>"
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("Document text extraction", () => {
  it("reads the type from the bytes, not the file name", () => {
    expect(detectDocumentKind(makePdf(["x"]))).toBe("pdf");
    expect(detectDocumentKind(Buffer.from("PK\u0003\u0004rest"))).toBe("docx");
    expect(detectDocumentKind(Buffer.from("plain notes"))).toBe("text");
    expect(detectDocumentKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]))).toBeUndefined();
  });

  it("extracts the text of a PDF", async () => {
    const { kind, text } = await extractDocumentText(makePdf(FACTS.slice(0, 2)));
    expect(kind).toBe("pdf");
    expect(fingerprint(text)).toContain(fingerprint(FACTS[0]));
    expect(fingerprint(text)).toContain(fingerprint(FACTS[1]));
  });

  it("extracts the text of a Word document", async () => {
    const { kind, text } = await extractDocumentText(await makeDocx(FACTS.slice(0, 2)));
    expect(kind).toBe("docx");
    expect(text).toContain(FACTS[0]);
    expect(text).toContain(FACTS[1]);
  });

  it("rejects files it cannot read with a clear code", async () => {
    await expect(extractDocumentText(Buffer.alloc(0))).rejects.toMatchObject({
      code: "DOCUMENT_REQUIRED",
    });
    await expect(extractDocumentText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]))).rejects.toMatchObject({
      code: "INVALID_DOCUMENT_TYPE",
    });
    await expect(extractDocumentText(Buffer.from("PK\u0003\u0004 not a real zip"))).rejects.toMatchObject({
      code: "INVALID_DOCUMENT_TYPE",
    });
    await expect(extractDocumentText(Buffer.from("%PDF-1.4 broken"))).rejects.toMatchObject({
      code: "DOCUMENT_UNREADABLE",
    });
  });

  it("tidies whitespace", () => {
    expect(cleanText("a  b\t c\r\n\r\n\r\n\r\nd \n e")).toBe("a b c\n\nd\ne");
  });
});

describe("Draft card checks", () => {
  const verify = (cards: claude.CardCandidate[], limit = 10) =>
    verifyCandidates(cards, MATERIAL, "owner", limit);

  it("keeps a card whose quote is in the document and marks the right option", async () => {
    const [card] = await verify([candidate(0)]);
    expect(card).toMatchObject({ type: "definition", text: "Question about fact 0?", quote: FACTS[0] });
    expect(card.options).toHaveLength(2);
    expect(card.options[card.correctOptionIndex]).toBe("Right answer 0");
    expect(card.options[1 - card.correctOptionIndex]).toBe("Wrong answer 0");
  });

  it("matches a quote across line breaks, hyphenation and curly quotes", async () => {
    const quote = "Assets  equal\nliabilities plus owner’s equi-\nty";
    expect(await verify([candidate(0, { quote })])).toHaveLength(1);
  });

  it("drops a card whose quote is not in the document", async () => {
    const invented = candidate(0, { quote: "Assets are always greater than liabilities in every business." });
    expect(await verify([invented])).toHaveLength(0);
    expect(await verify([candidate(0, { quote: "assets" })])).toHaveLength(0); // proves nothing
    expect(await verify([candidate(0, { quote: "" })])).toHaveLength(0);
  });

  it("drops malformed and repeated cards and stops at the limit", async () => {
    const cards = [
      candidate(0),
      candidate(1, { statement: "QUESTION about fact 0?" }), // same question again
      candidate(2, { wrongAnswer: "right answer 2" }), // both options the same
      candidate(3, { correctAnswer: "x".repeat(81) }), // option too long
      candidate(4, { statement: "y".repeat(301) }), // statement too long
      candidate(5, { wrongAnswer: "" }),
      candidate(1),
      candidate(2),
      candidate(3),
    ];
    const kept = await verify(cards, 3);
    expect(kept.map((c) => c.text)).toEqual([
      "Question about fact 0?",
      "Question about fact 1?",
      "Question about fact 2?",
    ]);
  });

  it("sends a short document whole and samples a long one from start to end", () => {
    expect(excerptForPrompt(MATERIAL)).toBe(MATERIAL);
    const long = Array.from({ length: 30000 }, (_, i) => `word${i}`).join(" ");
    const excerpt = excerptForPrompt(long);
    expect(excerpt.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS + 100);
    expect(excerpt.startsWith("word0 ")).toBe(true);
    expect(excerpt.endsWith(" word29999")).toBe(true);
    expect(excerpt).toContain("[…]");
    // No word is cut in half at a window edge.
    for (const word of excerpt.split(/\s+/)) expect(word === "[…]" || /^word\d+$/.test(word)).toBe(true);
  });
});

describe("Trivia from a document (HTTP)", () => {
  let configured: jest.SpyInstance;
  let requestCards: jest.SpyInstance;

  beforeAll(connectTestDB);
  beforeEach(() => {
    configured = jest.spyOn(claude, "isAiConfigured").mockReturnValue(true);
    requestCards = jest
      .spyOn(claude, "requestCards")
      .mockImplementation(async (_text, count) => ({
        title: "Financial accounting basics",
        cards: Array.from({ length: count }, (_, i) => candidate(i, { statement: `Question ${i}?` })),
      }));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await redis.flushall();
    await resetState();
  });
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  const upload = (user: TestUser, buffer: Buffer, name: string, fields: Record<string, any> = {}) => {
    const req = api().post(`${base}/generate`).set(user.auth).attach("document", buffer, name);
    for (const [k, v] of Object.entries(fields)) req.field(k, String(v));
    return req;
  };
  const fromText = (user: TestUser, body: Record<string, any> = {}) =>
    api().post(`${base}/generate`).set(user.auth).send({ text: MATERIAL, ...body });

  it("requires login", async () => {
    expect((await api().post(`${base}/generate`).send({ text: MATERIAL })).status).toBe(401);
    expect((await api().get(`${base}/generate`)).status).toBe(401);
    expect(requestCards).not.toHaveBeenCalled();
  });

  it("returns draft cards from an uploaded text file without saving anything", async () => {
    const user = await createUser();
    const res = await upload(user, Buffer.from(MATERIAL), "accounting.txt", { count: 5 });
    expect(res.status).toBe(200);
    expect(res.body.suggestedTitle).toBe("Financial accounting basics");
    expect(res.body.requested).toBe(5);
    expect(res.body.cards).toHaveLength(5);
    expect(res.body.document).toEqual({
      name: "accounting.txt",
      kind: "text",
      characters: MATERIAL.length,
      sampled: false,
    });
    for (const card of res.body.cards) {
      expect(card.type).toBe("definition");
      expect(card.options[card.correctOptionIndex]).toMatch(/^Right answer/);
      expect(MATERIAL).toContain(card.quote);
    }
    // The model saw the document, and was asked for a few spare cards.
    expect(requestCards).toHaveBeenCalledWith(MATERIAL, 7);
    expect(await CustomQuizCardModel.countDocuments()).toBe(0);
  });

  it("reads PDF and Word uploads", async () => {
    const user = await createUser();
    const pdf = await upload(user, makePdf(FACTS), "notes.pdf", { count: 3 });
    expect(pdf.status).toBe(200);
    expect(pdf.body.document.kind).toBe("pdf");
    expect(pdf.body.cards).toHaveLength(3);

    const docx = await upload(user, await makeDocx(FACTS), "notes.docx", { count: 3 });
    expect(docx.status).toBe(200);
    expect(docx.body.document.kind).toBe("docx");
    expect(docx.body.cards).toHaveLength(3);
  });

  it("gives drafts that the bulk endpoint saves as they are", async () => {
    const user = await createUser();
    const drafts = (await fromText(user, { count: 6 })).body.cards;
    const quiz = await api().post(base).set(user.auth).send({ title: "From my notes" });
    const saved = await api()
      .post(`${base}/${quiz.body.quiz.id}/cards/bulk`)
      .set(user.auth)
      .send({ cards: drafts });
    expect(saved.status).toBe(201);
    expect(saved.body.created).toBe(6);
    expect(saved.body.cards[0]).not.toHaveProperty("quote");
    const published = await api().post(`${base}/${quiz.body.quiz.id}/publish`).set(user.auth);
    expect(published.body.quiz.status).toBe("live");
  });

  it("returns only the cards that the document supports", async () => {
    requestCards.mockResolvedValue({
      title: "Mixed",
      cards: [candidate(0), candidate(1, { quote: "This sentence is nowhere in the material at all." })],
    });
    const user = await createUser();
    const res = await fromText(user, { count: 2 });
    expect(res.status).toBe(200);
    expect(res.body.cards).toHaveLength(1);
    expect(res.body.requested).toBe(2);
  });

  it("validates the request before calling the model", async () => {
    const user = await createUser();
    const none = await api().post(`${base}/generate`).set(user.auth).send({});
    expect(none.body.code).toBe("DOCUMENT_REQUIRED");
    const short = await fromText(user, { text: "Too short to learn from." });
    expect(short.status).toBe(400);
    expect(short.body.code).toBe("DOCUMENT_TOO_SHORT");
    for (const count of [0, 31, "abc", 2.5]) {
      expect((await fromText(user, { count })).body.code).toBe("INVALID_CARD_COUNT");
    }
    const image = await upload(user, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]), "photo.png");
    expect(image.body.code).toBe("INVALID_DOCUMENT_TYPE");
    const big = await upload(user, Buffer.alloc(10 * 1024 * 1024 + 1, "a"), "big.txt");
    expect(big.status).toBe(400);
    expect(big.body.code).toBe("DOCUMENT_TOO_LARGE");
    expect(requestCards).not.toHaveBeenCalled();

    const info = await api().get(`${base}/generate`).set(user.auth);
    expect(info.body.generate.usedToday).toBe(0); // rejected requests cost nothing
  });

  it("answers AI_NOT_CONFIGURED when there is no API key", async () => {
    configured.mockReturnValue(false);
    const user = await createUser();
    const res = await fromText(user);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("AI_NOT_CONFIGURED");
    expect(requestCards).not.toHaveBeenCalled();
    const info = await api().get(`${base}/generate`).set(user.auth);
    expect(info.body.generate.enabled).toBe(false);
  });

  it("really is unconfigured in the test environment", async () => {
    jest.restoreAllMocks();
    expect(claude.isAiConfigured()).toBe(false);
    await expect(claude.requestCards(MATERIAL, 3)).rejects.toMatchObject({
      statusCode: 503,
      code: "AI_NOT_CONFIGURED",
    });
  });

  it("limits freemium players to 3 documents a day and Pro players to 20", async () => {
    const free = await createUser();
    for (let i = 0; i < 3; i++) expect((await fromText(free, { count: 2 })).status).toBe(200);
    const fourth = await fromText(free, { count: 2 });
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe("GENERATION_LIMIT_REACHED");
    expect(fourth.body.details).toMatchObject({ dailyLimit: 3, isPro: false });
    expect(requestCards).toHaveBeenCalledTimes(3);

    const info = await api().get(`${base}/generate`).set(free.auth);
    expect(info.body.generate).toMatchObject({
      enabled: true,
      fileTypes: ["pdf", "docx", "txt", "md"],
      maxFileBytes: 10 * 1024 * 1024,
      count: { default: 10, min: 1, max: 30 },
      dailyLimit: 3,
      usedToday: 3,
      remaining: 0,
    });

    const pro = await createUser({ proUntil: new Date(Date.now() + DAY_MS) });
    const first = await fromText(pro, { count: 2 });
    expect(first.body.usage).toMatchObject({ dailyLimit: 20, usedToday: 1, remaining: 19 });
  });

  it("follows the limit an admin sets", async () => {
    await setConfigValue("customQuiz.generateDailyLimitFree", 1);
    const user = await createUser();
    expect((await fromText(user, { count: 2 })).status).toBe(200);
    expect((await fromText(user, { count: 2 })).body.code).toBe("GENERATION_LIMIT_REACHED");
  });

  it("does not charge the daily allowance for a failed attempt", async () => {
    const user = await createUser();
    requestCards.mockRejectedValueOnce(
      Object.assign(new Error("busy"), { statusCode: 502, code: "AI_UNAVAILABLE" })
    );
    expect((await fromText(user)).status).toBe(502);

    requestCards.mockResolvedValueOnce({ cards: [candidate(0, { quote: "Nothing like the document says." })] });
    const empty = await fromText(user);
    expect(empty.status).toBe(422);
    expect(empty.body.code).toBe("NO_CARDS_GENERATED");

    const info = await api().get(`${base}/generate`).set(user.auth);
    expect(info.body.generate).toMatchObject({ usedToday: 0, remaining: 3 });
  });

  it("does not shadow the quiz routes", async () => {
    const user = await createUser();
    const quiz = await api().post(base).set(user.auth).send({ title: "Mine" });
    const got = await api().get(`${base}/${quiz.body.quiz.id}`).set(user.auth);
    expect(got.status).toBe(200);
    expect(got.body.quiz.title).toBe("Mine");
  });
});
