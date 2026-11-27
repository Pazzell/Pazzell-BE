class ErrorHandler extends Error {
    statusCode: Number;
    // Machine-readable error code the frontend can branch on (e.g. CAMPAIGN_REQUIRED)
    code?: string;
    // Extra payload returned alongside the code (e.g. the campaign to play)
    details?: Record<string, any>;

    constructor(message:any, statusCode: Number, code?: string, details?: Record<string, any>){
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;

        Error.captureStackTrace(this, this.constructor);
    }
}

export default ErrorHandler;
