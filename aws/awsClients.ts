import { S3Client } from "@aws-sdk/client-s3";
import { SESClient } from "@aws-sdk/client-ses";

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

export const getS3Client = (): S3Client => {
  if (!_s3) _s3 = new S3Client({ region, credentials });
  return _s3;
};

export const getSESClient = (): SESClient => {
  if (!_ses) _ses = new SESClient({ region, credentials });
  return _ses;
};
