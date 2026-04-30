"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const error_1 = require("../../middlewares/error");
const ErrorHandler_1 = __importDefault(require("../../utils/ErrorHandler"));
describe("Test ErrorMiddleware", () => {
    let mockReq;
    let mockRes;
    let mockNext;
    beforeEach(() => {
        mockReq = {};
        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        mockNext = jest.fn();
    });
    it("should handle default error", () => {
        const error = new ErrorHandler_1.default("Default error", undefined);
        (0, error_1.ErrorMiddleware)(error, mockReq, mockRes, mockNext);
        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith({
            success: false,
            message: "Default error",
        });
    });
    it("should handle CastError", () => {
        const error = { name: "CastError", path: "id" };
        (0, error_1.ErrorMiddleware)(error, mockReq, mockRes, mockNext);
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({
            success: false,
            message: "Resource not found. Invalid: id",
        });
    });
    // Add more cases for JWT errors and duplicate keys.
});
