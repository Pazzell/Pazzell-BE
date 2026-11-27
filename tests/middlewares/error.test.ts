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
    const error = { name: "CastError", path: "id", value: "abc" } as any;
    ErrorMiddleware(error, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: "Invalid id: abc. Please provide a valid ID.",
    });
  });

  it("should return the machine-readable code and details of an ErrorHandler", () => {
    const error = new ErrorHandler("Play a sponsored trivia", 403, "CAMPAIGN_REQUIRED", {
      campaign: { id: "c1" },
    });
    ErrorMiddleware(error, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: "Play a sponsored trivia",
      code: "CAMPAIGN_REQUIRED",
      details: { campaign: { id: "c1" } },
    });
  });

  it("should not expose driver or system error codes", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    ErrorMiddleware(error, mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.json).toHaveBeenCalledWith({
      success: false,
      message: "connect ECONNREFUSED",
    });
  });
});
