import { frontendUrl } from "../../services/config/frontendUrl";

describe("frontendUrl", () => {
  const nodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = nodeEnv;
  });

  it("uses a single address as it is, without a trailing slash or path", () => {
    expect(frontendUrl("https://pazzell.com")).toBe("https://pazzell.com");
    expect(frontendUrl("https://pazzell.com/")).toBe("https://pazzell.com");
    expect(frontendUrl(" https://www.pazzell.com/app ")).toBe("https://www.pazzell.com");
  });

  it("picks the public address out of a list that includes local ones", () => {
    expect(frontendUrl("http://localhost:3000,https://pazzell.com")).toBe("https://pazzell.com");
    expect(frontendUrl("http://127.0.0.1:3000, https://pazzell.com, https://staging.pazzell.com")).toBe(
      "https://pazzell.com"
    );
    expect(frontendUrl("http://localhost:3000 https://pazzell.com")).toBe("https://pazzell.com");
  });

  it("never points at localhost in production", () => {
    process.env.NODE_ENV = "production";
    expect(frontendUrl("http://localhost:3000")).toBe("https://pazzell.com");
    expect(frontendUrl("")).toBe("https://pazzell.com");
    expect(frontendUrl("not a url")).toBe("https://pazzell.com");
  });

  it("allows a local address while developing", () => {
    process.env.NODE_ENV = "development";
    expect(frontendUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(frontendUrl("")).toBe("http://localhost:3000");
  });
});
