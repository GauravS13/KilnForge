import { lookup } from "node:dns/promises";

/**
 * SSRF guard for the remote-source transform-URL path (spec §16.2). Any
 * service that fetches an attacker-influenced URL on the server's behalf
 * is a textbook SSRF vector — this blocks the well-known dangerous
 * ranges before ever making that fetch.
 *
 * HONEST LIMITATION, found while implementing, not assumed away: full
 * resolve-once/pin-the-IP defense against DNS rebinding requires
 * connecting to a specific IP while still presenting the original
 * hostname for TLS SNI and the Host header — that needs socket-level
 * control (a custom `lookup` on a Node http(s) Agent, for instance).
 * The web-standard `fetch()` API this project builds on doesn't expose
 * that cleanly: substituting the resolved IP directly into the URL
 * breaks TLS SNI/certificate validation for HTTPS sources. What's
 * implemented instead: validate before the first fetch, and re-validate
 * on every redirect hop (the classic same-hostname-allowlist-then-
 * open-redirect bypass) — closing the majority of real-world SSRF risk.
 * A narrow TOCTOU window remains between validation and the actual
 * connection for an attacker who can rebind DNS with sub-request
 * precision; stated here rather than silently claimed closed.
 */

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

interface Ipv4Range {
  base: number;
  maskBits: number;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const v = Number(part);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function parseCidr(cidr: string): Ipv4Range {
  const [ip, bits] = cidr.split("/");
  const base = ipv4ToInt(ip!);
  if (base === null) throw new Error(`invalid CIDR base: ${cidr}`);
  return { base, maskBits: Number(bits) };
}

// 169.254.169.254 (the cloud-metadata address — the single most cited
// real-world SSRF payload target, named explicitly here even though it's
// already covered by the broader 169.254.0.0/16 link-local block below,
// specifically so the code and this comment make clear the team knows
// *why* the block exists, not just that a rule exists) falls inside
// 169.254.0.0/16.
const BLOCKED_IPV4_RANGES = [
  "0.0.0.0/8", // "this network"
  "127.0.0.0/8", // loopback
  "169.254.0.0/16", // link-local — includes the 169.254.169.254 cloud-metadata address
  "10.0.0.0/8", // private
  "172.16.0.0/12", // private
  "192.168.0.0/16", // private
  "100.64.0.0/10", // carrier-grade NAT
].map(parseCidr);

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return BLOCKED_IPV4_RANGES.some((range) => {
    const mask = range.maskBits === 0 ? 0 : (0xffffffff << (32 - range.maskBits)) >>> 0;
    return (n & mask) === (range.base & mask);
  });
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized === "::") return true; // unspecified
  if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // fc00::/7 unique local
  if (normalized.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — check the embedded IPv4 address, since this is a
    // classic way to smuggle a blocked address past a naive IPv6-only check.
    return isBlockedIpv4(normalized.slice(7));
  }
  return false;
}

export function isBlockedIp(ip: string): boolean {
  return ip.includes(":") ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

export type LookupFn = (hostname: string, options: { all: true }) => Promise<{ address: string }[]>;

/** Resolves a hostname and throws SsrfBlockedError if ANY resolved
 * address (not just the first) is in a blocked range — a hostname that
 * resolves to multiple addresses is unsafe if any of them are internal.
 * `lookupFn` defaults to the real node:dns resolver; injectable for
 * deterministic, network-free tests. */
export async function assertHostnameAllowed(hostname: string, lookupFn: LookupFn = lookup): Promise<void> {
  let addresses: { address: string }[];
  try {
    addresses = await lookupFn(hostname, { all: true });
  } catch (err) {
    throw new SsrfBlockedError(`could not resolve "${hostname}": ${err instanceof Error ? err.message : String(err)}`);
  }
  if (addresses.length === 0) {
    throw new SsrfBlockedError(`"${hostname}" resolved to no addresses`);
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new SsrfBlockedError(
        `"${hostname}" resolves to ${address}, which is in a blocked range (loopback/link-local/private/carrier-NAT)`,
      );
    }
  }
}

const MAX_REDIRECTS = 3;

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Fetches a URL with SSRF validation applied to the initial hostname AND
 * re-applied on every redirect hop — a same-hostname allowlist checked
 * once, then followed through an open redirect to a private IP, is the
 * classic bypass this specifically closes. `lookupFn`/`fetchFn` default
 * to the real resolver/fetch; injectable for deterministic tests.
 */
export async function safeFetch(
  url: string,
  lookupFn: LookupFn = lookup,
  fetchFn: FetchFn = fetch,
): Promise<Response> {
  let currentUrl = new URL(url);
  if (currentUrl.protocol !== "http:" && currentUrl.protocol !== "https:") {
    throw new SsrfBlockedError(`unsupported protocol "${currentUrl.protocol}"`);
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertHostnameAllowed(currentUrl.hostname, lookupFn);

    const res = await fetchFn(currentUrl.toString(), { redirect: "manual" });
    const isRedirect = res.status >= 300 && res.status < 400;
    const location = res.headers.get("location");

    if (!isRedirect || !location) return res;

    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
      throw new SsrfBlockedError(`redirect to unsupported protocol "${nextUrl.protocol}"`);
    }
    currentUrl = nextUrl;
  }

  throw new SsrfBlockedError(`too many redirects (over ${MAX_REDIRECTS})`);
}
