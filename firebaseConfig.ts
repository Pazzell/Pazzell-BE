import admin from "firebase-admin";
import "dotenv/config";

// Firebase is used for Google sign-in (ID token verification) and, when
// STORAGE_PROVIDER=firebase, for file storage. It is initialised only when the
// service-account variables are present, so the app still boots without them
// (e.g. S3 storage, or the test suite).
export const isFirebaseConfigured = (): boolean =>
  !!process.env.PROJECT_ID && !!process.env.PRIVATE_KEY && !!process.env.CLIENT_EMAIL;

if (isFirebaseConfigured() && admin.apps.length === 0) {
  const serviceAccount = {
    type: process.env.TYPE,
    project_id: process.env.PROJECT_ID,
    private_key_id: process.env.PRIVATE_KEY_ID,
    private_key: process.env.PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.CLIENT_EMAIL,
    client_id: process.env.CLIENT_ID,
    auth_uri: process.env.AUTH_URI,
    token_uri: process.env.TOKEN_URI,
    auth_provider_x509_cert_url: process.env.AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.CLIENT_CERT_URL,
    universe_domain: process.env.UNIVERSE_DOMAIN
  } as admin.ServiceAccount;

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "yunify-cc2a5.appspot.com"
  });
}

export const getBucket = () => {
  if (!isFirebaseConfigured()) {
    throw new Error("Firebase is not configured (set the service-account variables or use STORAGE_PROVIDER=aws)");
  }
  return admin.storage().bucket();
};
