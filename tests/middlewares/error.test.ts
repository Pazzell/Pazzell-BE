import { Request, Response } from "express";
import { ErrorMiddleware } from "../../middlewares/error";
import ErrorHandler from "../../utils/ErrorHandler";

describe("Test ErrorMiddleware", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: jest.Mock;


  beforeEach(() => {
    mockReq = {};
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();

  });

  it("should handle default error", () => {
    const error = new ErrorHandler("Default error", undefined as any);
    ErrorMiddleware(error, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: "Default error",
    });
  });

  it("should handle CastError", () => {
    const error = { name: "CastError", path: "id" } as any;
    ErrorMiddleware(error, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: "Resource not found. Invalid: id",
    });
  });

  // Add more cases for JWT errors and duplicate keys.
});
