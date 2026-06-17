import { createHash } from "crypto";

const TRACKING_PARAM_PREFIXES = ["utm_"];
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
]);

export function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalizeUrl(value: string) {
  try {
    const url = new URL(value.trim());

    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    for (const key of Array.from(url.searchParams.keys())) {
      const lowerKey = key.toLowerCase();
      const isTrackingParam =
        TRACKING_PARAMS.has(lowerKey) ||
        TRACKING_PARAM_PREFIXES.some((prefix) => lowerKey.startsWith(prefix));

      if (isTrackingParam) {
        url.searchParams.delete(key);
      }
    }

    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return value.trim();
  }
}

export function normalizeDoi(value?: string) {
  if (!value) {
    return null;
  }

  const doi = value
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .toLowerCase();

  return doi || null;
}
