import { evaluateTiming, evaluateVideoWatchTime } from "../services/session/antiCheat";

describe("antiCheat.evaluateTiming", () => {
  it("returns 'ok' when duration is at or above the soft floor", () => {
    expect(evaluateTiming(5000, 3000, 500)).toBe("ok");
    expect(evaluateTiming(3000, 3000, 500)).toBe("ok");
  });

  it("returns 'soft' when duration is between the hard and soft floors", () => {
    expect(evaluateTiming(1000, 3000, 500)).toBe("soft");
  });

  it("returns 'hard' when duration is below the hard floor", () => {
    expect(evaluateTiming(100, 3000, 500)).toBe("hard");
    expect(evaluateTiming(-50, 3000, 500)).toBe("hard");
  });
});

describe("antiCheat.evaluateVideoWatchTime", () => {
  // 120s video, soft = 80% (96s), hard = 20% (24s)
  it("returns 'ok' when watched close to full duration", () => {
    expect(evaluateVideoWatchTime(119000, 120, 0.8, 0.2)).toBe("ok");
  });

  it("returns 'soft' when watched well under the soft threshold but above hard", () => {
    expect(evaluateVideoWatchTime(50000, 120, 0.8, 0.2)).toBe("soft");
  });

  it("returns 'hard' when watched far too briefly", () => {
    expect(evaluateVideoWatchTime(5000, 120, 0.8, 0.2)).toBe("hard");
  });
});
