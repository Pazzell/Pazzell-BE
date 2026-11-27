"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const antiCheat_1 = require("../services/session/antiCheat");
describe("antiCheat.evaluateTiming", () => {
    it("returns 'ok' when duration is at or above the soft floor", () => {
        expect((0, antiCheat_1.evaluateTiming)(5000, 3000, 500)).toBe("ok");
        expect((0, antiCheat_1.evaluateTiming)(3000, 3000, 500)).toBe("ok");
    });
    it("returns 'soft' when duration is between the hard and soft floors", () => {
        expect((0, antiCheat_1.evaluateTiming)(1000, 3000, 500)).toBe("soft");
    });
    it("returns 'hard' when duration is below the hard floor", () => {
        expect((0, antiCheat_1.evaluateTiming)(100, 3000, 500)).toBe("hard");
        expect((0, antiCheat_1.evaluateTiming)(-50, 3000, 500)).toBe("hard");
    });
});
describe("antiCheat.evaluateVideoWatchTime", () => {
    // 120s video, soft = 80% (96s), hard = 20% (24s)
    it("returns 'ok' when watched close to full duration", () => {
        expect((0, antiCheat_1.evaluateVideoWatchTime)(119000, 120, 0.8, 0.2)).toBe("ok");
    });
    it("returns 'soft' when watched well under the soft threshold but above hard", () => {
        expect((0, antiCheat_1.evaluateVideoWatchTime)(50000, 120, 0.8, 0.2)).toBe("soft");
    });
    it("returns 'hard' when watched far too briefly", () => {
        expect((0, antiCheat_1.evaluateVideoWatchTime)(5000, 120, 0.8, 0.2)).toBe("hard");
    });
});
