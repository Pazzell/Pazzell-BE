// The site's public address, used to build every link the API hands out: team game join
// and result links, quiz share links, the payment return page and the password reset email.

const PRODUCTION_URL = "https://pazzell.com";
const DEV_URL = "http://localhost:3000";

const isLocal = (host: string) =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");

/**
 * One origin from FRONTEND_URL, e.g. "https://pazzell.com". FRONTEND_URL may hold several
 * addresses separated by commas or spaces (say the live site and a local one); a link can
 * only point at one, so the first that is not a local address wins, with any path or
 * trailing slash dropped. In production a link never points at localhost: with no usable
 * address set, the live site is used.
 */
export function frontendUrl(raw: string | undefined = process.env.FRONTEND_URL): string {
  const origins: string[] = [];
  for (const entry of (raw || "").split(/[\s,]+/)) {
    try {
      const url = new URL(entry);
      if (url.protocol === "https:" || url.protocol === "http:") origins.push(url.origin);
    } catch {
      // Not a URL: skipped.
    }
  }
  const publicOrigin = origins.find((origin) => !isLocal(new URL(origin).hostname));
  if (publicOrigin) return publicOrigin;
  if (process.env.NODE_ENV === "production") return PRODUCTION_URL;
  return origins[0] || DEV_URL;
}
