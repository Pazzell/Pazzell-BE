"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSNSClient = exports.getSQSClient = exports.getSESClient = exports.getS3Client = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_ses_1 = require("@aws-sdk/client-ses");
const client_sqs_1 = require("@aws-sdk/client-sqs");
const client_sns_1 = require("@aws-sdk/client-sns");
const region = process.env.AWS_REGION || "us-east-1";
const credentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
    : undefined;
let _s3 = null;
let _ses = null;
let _sqs = null;
let _sns = null;
const getS3Client = () => {
    if (!_s3)
        _s3 = new client_s3_1.S3Client({ region, credentials });
    return _s3;
};
exports.getS3Client = getS3Client;
const getSESClient = () => {
    if (!_ses)
        _ses = new client_ses_1.SESClient({ region, credentials });
    return _ses;
};
exports.getSESClient = getSESClient;
const getSQSClient = () => {
    if (!_sqs)
        _sqs = new client_sqs_1.SQSClient({ region, credentials });
    return _sqs;
};
exports.getSQSClient = getSQSClient;
const getSNSClient = () => {
    if (!_sns)
        _sns = new client_sns_1.SNSClient({ region, credentials });
    return _sns;
};
exports.getSNSClient = getSNSClient;
