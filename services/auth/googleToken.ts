import axios from "axios";
import ErrorHandler from "../../utils/ErrorHandler";

// Google sign-in on the web client uses the OAuth token flow, so the backend receives a
// Google access token. It is checked with Google itself: the profile is never taken from
// the request body, otherwise anyone could sign in as any email address.

const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export interface GoogleProfile {
  googleId: string;
  email: string;
  name?: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
}

/** OAuth client ids whose tokens are accepted (comma separated in GOOGLE_CLIENT_ID). */
export function googleClientIds(): string[] {
  const raw = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

const invalidToken = () =>
  new ErrorHandler("Google sign-in could not be verified. Please try again.", 401, "GOOGLE_TOKEN_INVALID");

async function googleGet(url: string, config: Record<string, any>): Promise<any> {
  try {
    return (await axios.get(url, { timeout: 10000, ...config })).data;
  } catch (error: any) {
    // Google answers 400/401 for a token that is expired, revoked or made up.
    if (error.response && error.response.status < 500) throw invalidToken();
    throw new ErrorHandler("Google sign-in is unavailable right now. Please try again.", 502, "GOOGLE_UNAVAILABLE");
  }
}

export async function verifyGoogleAccessToken(accessToken: string): Promise<GoogleProfile> {
  const clientIds = googleClientIds();
  if (clientIds.length === 0) {
    throw new ErrorHandler("Google sign-in is not configured", 503, "GOOGLE_NOT_CONFIGURED");
  }

  // The token must have been issued to this app, not to some other site the player used.
  const info = await googleGet(TOKENINFO_URL, { params: { access_token: accessToken } });
  if (!clientIds.includes(info.aud) && !clientIds.includes(info.azp)) throw invalidToken();

  const profile = await googleGet(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profile.sub || profile.sub !== info.sub) throw invalidToken();
  const verified = profile.email_verified === true || profile.email_verified === "true";
  if (!profile.email || !verified) {
    throw new ErrorHandler(
      "Your Google account has no verified email address",
      400,
      "GOOGLE_EMAIL_UNVERIFIED"
    );
  }

  return {
    googleId: String(profile.sub),
    email: String(profile.email).toLowerCase(),
    name: profile.name,
    givenName: profile.given_name,
    familyName: profile.family_name,
    picture: profile.picture,
  };
}
