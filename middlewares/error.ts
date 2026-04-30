import { Request, Response, NextFunction } from "express";
import ErrorHandler from "../utils/ErrorHandler";

export const ErrorMiddleware = (err: any, req: Request, res: Response, next: NextFunction) => {
    err.statusCode = err.statusCode || 500;
    err.message = err.message || "Internal server error";

    // MongoDB CastError - Invalid ObjectId
    if (err.name === "CastError") {
        const message = `Invalid ${err.path}: ${err.value}. Please provide a valid ID.`;
        err = new ErrorHandler(message, 400);
    }

    // MongoDB Duplicate key error
    if (err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        const value = err.keyValue[field];
        const message = `${field.charAt(0).toUpperCase() + field.slice(1)} '${value}' already exists. Please use a different ${field}.`;
        err = new ErrorHandler(message, 409);
    }

    // Mongoose Validation Error
    if (err.name === "ValidationError") {
        const errors = Object.values(err.errors).map((val: any) => val.message);
        const message = `Validation failed: ${errors.join(', ')}`;
        err = new ErrorHandler(message, 400);
    }

    // JWT Errors
    if (err.name === "JsonWebTokenError") {
        const message = "Authentication token is invalid. Please log in again.";
        err = new ErrorHandler(message, 401);
    }

    if (err.name === "TokenExpiredError") {
        const message = "Authentication token has expired. Please log in again.";
        err = new ErrorHandler(message, 401);
    }

    // Multer file upload errors
    if (err.name === "MulterError") {
        let message = "File upload error";
        if (err.code === "LIMIT_FILE_SIZE") {
            message = "File size is too large. Maximum file size is 50MB.";
        } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
            message = "Unexpected file field. Please check the file upload field name.";
        }
        err = new ErrorHandler(message, 400);
    }

    // Handle specific HTTP status codes
    if (err.statusCode === 403) {
        err.message = err.message || "Access forbidden. You don't have permission to perform this action.";
    }

    if (err.statusCode === 401) {
        err.message = err.message || "Authentication required. Please log in to continue.";
    }

    if (err.statusCode === 404) {
        err.message = err.message || "The requested resource was not found.";
    }

    // Log error for debugging (only in development)
    if (process.env.NODE_ENV === "development") {
        console.error("Error:", {
            message: err.message,
            statusCode: err.statusCode,
            stack: err.stack,
        });
    }

    // Send error response
    res.status(Number(err.statusCode)).json({
        success: false,
        message: err.message,
        ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
    });
};