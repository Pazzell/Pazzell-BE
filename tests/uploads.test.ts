import sharp from "sharp";
import { connectTestDB, closeTestDB } from "./setup";
import { closeRedisConnection } from "../utils/redis";
import { api, createUser, resetState, TestUser } from "./helpers";
import CustomQuizCardModel from "../models/customQuizCard.model";

const image = (width: number, height: number, format: "png" | "jpeg" | "webp" | "gif" = "png") =>
  sharp({ create: { width, height, channels: 3, background: "#22c55e" } })[format]().toBuffer();

const upload = (user: TestUser, buffer: Buffer, filename: string, contentType: string) =>
  api().post("/api/v1/uploads/images").set(user.auth).attach("image", buffer, { filename, contentType });

describe("Image uploads", () => {
  beforeAll(connectTestDB);
  afterEach(resetState);
  afterAll(async () => {
    await closeTestDB();
    await closeRedisConnection();
  });

  it.each([
    ["png", "image/png"],
    ["jpeg", "image/jpeg"],
    ["webp", "image/webp"],
  ] as const)("accepts %s, resizes it and stores it as webp", async (format, contentType) => {
    const user = await createUser();
    const res = await upload(user, await image(2600, 1300, format), `photo.${format}`, contentType);
    expect(res.status).toBe(201);
    expect(res.body.image.url).toMatch(/^https:\/\/storage\.pazzell\.test\/pazzell\/cards\/[0-9a-f-]{36}\.webp$/);
    expect(res.body.image).toMatchObject({ width: 1280, height: 640 });
  });

  it("rejects other file types, whatever they claim to be", async () => {
    const user = await createUser();

    const gif = await upload(user, await image(10, 10, "gif"), "anim.gif", "image/gif");
    expect(gif.status).toBe(400);
    expect(gif.body.code).toBe("INVALID_IMAGE_TYPE");

    // A script renamed to .png with an image mimetype: the bytes are checked, not the label.
    const fake = await upload(user, Buffer.from("<script>alert(1)</script>"), "evil.png", "image/png");
    expect(fake.status).toBe(400);
    expect(fake.body.code).toBe("INVALID_IMAGE_TYPE");

    // A GIF labelled as PNG.
    const disguised = await upload(user, await image(10, 10, "gif"), "pic.png", "image/png");
    expect(disguised.status).toBe(400);

    const svg = await upload(user, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), "x.svg", "image/svg+xml");
    expect(svg.status).toBe(400);
  });

  it("rejects files over 5MB and requests without a file or a session", async () => {
    const user = await createUser();
    const big = await upload(user, Buffer.alloc(5 * 1024 * 1024 + 1024, 1), "big.png", "image/png");
    expect(big.status).toBe(400);
    expect(big.body.code).toBe("LIMIT_FILE_SIZE");

    const none = await api().post("/api/v1/uploads/images").set(user.auth);
    expect(none.status).toBe(400);
    expect(none.body.code).toBe("IMAGE_REQUIRED");

    const anonymous = await api()
      .post("/api/v1/uploads/images")
      .attach("image", await image(10, 10), { filename: "a.png", contentType: "image/png" });
    expect(anonymous.status).toBe(401);
  });

  it("creates image cards from an attached file or from the uploader's own image URL only", async () => {
    const owner = await createUser();
    const other = await createUser();
    const quizId = (await api().post("/api/v1/custom-quizzes").set(owner.auth).send({ title: "Flags" })).body.quiz.id;
    const cards = `/api/v1/custom-quizzes/${quizId}/cards`;

    const multipart = await api()
      .post(cards)
      .set(owner.auth)
      .field("type", "image")
      .field("options", JSON.stringify(["Nigeria", "Ghana", "Kenya", "Togo"]))
      .field("correctOptionIndex", "0")
      .attach("image", await image(300, 200), { filename: "flag.png", contentType: "image/png" });
    expect(multipart.status).toBe(201);
    expect(multipart.body.card).toMatchObject({
      type: "image",
      options: ["Nigeria", "Ghana", "Kenya", "Togo"],
      correctOptionIndex: 0,
    });
    expect(multipart.body.card.imageUrl).toMatch(/\.webp$/);

    const mine = (await upload(owner, await image(50, 50), "a.png", "image/png")).body.image.url;
    const theirs = (await upload(other, await image(50, 50), "b.png", "image/png")).body.image.url;
    const body = (imageUrl: string) => ({ type: "image", imageUrl, options: ["A", "B", "C", "D"], correctOptionIndex: 1 });

    expect((await api().post(cards).set(owner.auth).send(body(mine))).status).toBe(201);
    for (const foreign of [theirs, "https://evil.example/tracker.png", "javascript:alert(1)"]) {
      const res = await api().post(cards).set(owner.auth).send(body(foreign));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_IMAGE_URL");
    }
    expect(await CustomQuizCardModel.countDocuments({ quizId })).toBe(2);
  });
});
