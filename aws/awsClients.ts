import { S3Client } from "@aws-sdk/client-s3";
import { SESClient } from "@aws-sdk/client-ses";
import { SQSClient } from "@aws-sdk/client-sqs";
import { SNSClient } from "@aws-sdk/client-sns";

const region = process.env.AWS_REGION || "us-east-1";

const credentials =
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined;

let _s3: S3Client | null = null;
let _ses: SESClient | null = null;
let _sqs: SQSClient | null = null;
let _sns: SNSClient | null = null;

export const getS3Client = (): S3Client => {
  if (!_s3) _s3 = new S3Client({ region, credentials });
  return _s3;
};

export const getSESClient = (): SESClient => {
  if (!_ses) _ses = new SESClient({ region, credentials });
  return _ses;
};

export const getSQSClient = (): SQSClient => {
  if (!_sqs) _sqs = new SQSClient({ region, credentials });
  return _sqs;
};

export const getSNSClient = (): SNSClient => {
  if (!_sns) _sns = new SNSClient({ region, credentials });
  return _sns;
};
