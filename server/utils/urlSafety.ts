export function getExternalFetchAllowlist(): string[] {
  const allowed: string[] = [];
  if (process.env.REPLIT_DOMAINS) {
    allowed.push(
      ...process.env.REPLIT_DOMAINS.split(",")
        .map((d) => d.trim())
        .filter(Boolean)
    );
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    allowed.push(process.env.REPLIT_DEV_DOMAIN);
  }
  allowed.push("storage.googleapis.com");
  return allowed;
}

export function isUrlSafeForFetch(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    const allowlist = getExternalFetchAllowlist();
    return allowlist.some((d) => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}
