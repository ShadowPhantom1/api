import "server-only";
import dns from "node:dns";
import net from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";
import { env } from "@/lib/env";

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan"];
const DEFAULT_ALLOWED_PORTS = [80, 443];

export type SafeFetchErrorCode =
  | "invalid_url"
  | "blocked_destination"
  | "blocked_port"
  | "host_not_allowed"
  | "dns_failure"
  | "timeout"
  | "network_error"
  | "response_too_large"
  | "too_many_redirects"
  | "unsupported_protocol";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly status: number;
  constructor(code: SafeFetchErrorCode, message: string, status = 400) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Only globally routable ("unicast") addresses are allowed. Everything else —
 * loopback, RFC1918, link-local/metadata, CGNAT, multicast, documentation,
 * unique-local v6, mapped v4, etc. — is rejected.
 */
export function isPrivateIp(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return true;
  const parsed = ipaddr.parse(ip);
  if (parsed.kind() === "ipv6") {
    const range = parsed.range();
    if (range === "ipv4Mapped") {
      return isPrivateIp((parsed as ipaddr.IPv6).toIPv4Address().toString());
    }
    return range !== "unicast";
  }
  return parsed.range() !== "unicast";
}

export function hostMatches(pattern: string, hostname: string): boolean {
  const p = pattern.trim().toLowerCase();
  const h = hostname.trim().toLowerCase();
  if (!p) return false;
  if (p.startsWith("*.")) {
    const base = p.slice(2);
    return h === base || h.endsWith(`.${base}`);
  }
  return h === p;
}

function allowPrivateForTests(requested: boolean): boolean {
  if (!requested) return false;
  if (process.env.NODE_ENV === "production") {
    throw new SafeFetchError(
      "blocked_destination",
      "Private-address requests are disabled in production.",
      403,
    );
  }
  return true;
}

export interface TargetValidation {
  url: URL;
  hostname: string;
  addresses: string[];
}

export async function validateTargetUrl(
  rawUrl: string,
  options: {
    allowPrivate?: boolean;
    allowedHosts?: string[];
    enforceAllowlist?: boolean;
    allowedPorts?: number[];
    skipDns?: boolean;
  } = {},
): Promise<TargetValidation> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError("invalid_url", "The destination URL is not valid.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("unsupported_protocol", "Only http and https destinations are allowed.");
  }
  if (url.username || url.password) {
    throw new SafeFetchError("blocked_destination", "Credentials in URLs are not allowed.");
  }
  if (!url.hostname) {
    throw new SafeFetchError("invalid_url", "The destination URL has no hostname.");
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    hostname === "localhost" ||
    hostname === "metadata.google.internal" ||
    BLOCKED_HOST_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix))
  ) {
    throw new SafeFetchError("blocked_destination", "Internal hostnames are not allowed.");
  }

  const allowedPorts = options.allowedPorts ?? env.allowedPorts ?? DEFAULT_ALLOWED_PORTS;
  const effectivePort = url.port
    ? Number.parseInt(url.port, 10)
    : url.protocol === "https:"
      ? 443
      : 80;
  if (!allowedPorts.includes(effectivePort)) {
    throw new SafeFetchError(
      "blocked_port",
      `Port ${effectivePort} is not allowed. Allowed ports: ${allowedPorts.join(", ")}.`,
    );
  }

  if (options.enforceAllowlist && options.allowedHosts && options.allowedHosts.length > 0) {
    if (!options.allowedHosts.some((allowed) => hostMatches(allowed, hostname))) {
      throw new SafeFetchError(
        "host_not_allowed",
        `Destination host "${hostname}" is not in the gateway allowlist.`,
        403,
      );
    }
  }

  const priv = allowPrivateForTests(Boolean(options.allowPrivate));
  const addresses: string[] = [];

  if (net.isIP(hostname)) {
    if (!priv && isPrivateIp(hostname)) {
      throw new SafeFetchError("blocked_destination", "Private or reserved IP addresses are not allowed.");
    }
    addresses.push(hostname);
  } else if (!options.skipDns) {
    const resolved = await new Promise<dns.LookupAddress[]>((resolve, reject) => {
      dns.lookup(hostname, { all: true, verbatim: true }, (error, result) => {
        if (error) return reject(error);
        resolve(result);
      });
    }).catch((error: NodeJS.ErrnoException) => {
      throw new SafeFetchError("dns_failure", `DNS lookup failed for ${hostname}: ${error.code ?? "error"}`);
    });
    if (!resolved.length) {
      throw new SafeFetchError("dns_failure", `No DNS records found for ${hostname}.`);
    }
    for (const entry of resolved) {
      addresses.push(entry.address);
      if (!priv && isPrivateIp(entry.address)) {
        throw new SafeFetchError(
          "blocked_destination",
          `Host "${hostname}" resolves to a private or reserved address.`,
        );
      }
    }
  }

  return { url, hostname, addresses };
}

/** undici connect-time DNS lookup with per-answer IP validation (rebinding-safe). */
function guardedLookup(allowPrivate: boolean) {
  return (
    hostname: string,
    options: dns.LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void,
  ) => {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (error, results) => {
      if (error) return callback(error);
      const list = results as dns.LookupAddress[];
      for (const entry of list) {
        if (!allowPrivate && isPrivateIp(entry.address)) {
          const err: NodeJS.ErrnoException = new Error(
            `Blocked connection: ${hostname} resolved to a private address.`,
          );
          err.code = "EBLOCKED";
          return callback(err);
        }
      }
      if ((options as { all?: boolean }).all) {
        return callback(null, list);
      }
      return callback(null, list[0]?.address, list[0]?.family);
    });
  };
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
  maxBytes?: number;
  onExceed?: "throw" | "truncate";
  allowPrivate?: boolean;
  allowedHosts?: string[];
  enforceAllowlist?: boolean;
  allowedPorts?: number[];
  maxRedirects?: number;
}

export interface SafeFetchResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: Buffer;
  truncated: boolean;
  finalUrl: string;
  redirects: number;
  durationMs: number;
  contentType: string;
}

export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const started = Date.now();
  const allowPrivate = Boolean(options.allowPrivate);
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? env.requestTimeoutMs, 500), 120_000);
  const maxBytes = Math.min(Math.max(options.maxBytes ?? env.maxResponseBytes, 256), 10 * 1024 * 1024);
  const maxRedirects = options.maxRedirects ?? 3;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const agent = new Agent({
    connect: {
      lookup: guardedLookup(allowPrivate) as never,
      timeout: Math.min(timeoutMs, 10_000),
    },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });

  let currentUrl = rawUrl;
  let method = (options.method ?? "GET").toUpperCase();
  let headers: Record<string, string> = { ...(options.headers ?? {}) };
  let body = options.body;

  try {
    for (let redirects = 0; ; redirects += 1) {
      await validateTargetUrl(currentUrl, {
        allowPrivate,
        allowedHosts: options.allowedHosts,
        enforceAllowlist: options.enforceAllowlist,
        allowedPorts: options.allowedPorts,
      });

      let response;
      try {
        response = await undiciFetch(currentUrl, {
          method,
          headers,
          body: method === "GET" || method === "HEAD" ? undefined : body,
          redirect: "manual",
          dispatcher: agent,
          signal: controller.signal,
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          throw new SafeFetchError("timeout", `Upstream request timed out after ${timeoutMs}ms.`, 504);
        }
        const cause = (error as { cause?: { code?: string; message?: string } }).cause;
        throw new SafeFetchError(
          "network_error",
          `Upstream request failed${cause?.code ? ` (${cause.code})` : ""}: ${cause?.message ?? (error as Error).message}`,
          502,
        );
      }

      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        if (redirects >= maxRedirects) {
          await response.body?.cancel();
          throw new SafeFetchError("too_many_redirects", "Upstream redirected too many times.", 502);
        }
        const nextUrl = new URL(location, currentUrl);
        const previousHost = new URL(currentUrl).hostname;
        if (nextUrl.hostname !== previousHost) {
          delete headers.authorization;
          delete headers.Authorization;
          delete headers.cookie;
        }
        if ([301, 302, 303].includes(response.status)) {
          method = "GET";
          body = undefined;
          delete headers["content-type"];
          delete headers["content-length"];
        }
        await response.body?.cancel();
        currentUrl = nextUrl.toString();
        continue;
      }

      const collected: Buffer[] = [];
      let total = 0;
      let truncated = false;

      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;
            total += value.byteLength;
            if (total > maxBytes) {
              const remaining = Math.max(0, maxBytes - (total - value.byteLength));
              if (remaining > 0) collected.push(Buffer.from(value.subarray(0, remaining)));
              truncated = true;
              await reader.cancel();
              break;
            }
            collected.push(Buffer.from(value));
          }
        } finally {
          reader.releaseLock();
        }
      }

      if (truncated && options.onExceed === "throw") {
        throw new SafeFetchError(
          "response_too_large",
          `Upstream response exceeded the ${maxBytes} byte limit.`,
          502,
        );
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (Object.keys(responseHeaders).length < 100) responseHeaders[key] = value;
      });

      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: Buffer.concat(collected),
        truncated,
        finalUrl: currentUrl,
        redirects,
        durationMs: Date.now() - started,
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
      };
    }
  } finally {
    clearTimeout(timer);
    await agent.close().catch(() => undefined);
  }
}

export function parseBodyAsJson(buffer: Buffer): { json: unknown; parsed: boolean } {
  try {
    return { json: JSON.parse(buffer.toString("utf8")), parsed: true };
  } catch {
    return { json: null, parsed: false };
  }
}

export function isJsonContentType(contentType: string): boolean {
  return /(^|\/|\+)json\b/i.test(contentType) || contentType.includes("application/problem+json");
}

export function isTextContentType(contentType: string): boolean {
  return (
    contentType.startsWith("text/") ||
    isJsonContentType(contentType) ||
    contentType.includes("xml") ||
    contentType.includes("javascript") ||
    contentType.includes("x-www-form-urlencoded")
  );
}

export interface SafeStreamHandle {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array> | null;
  finalUrl: string;
  contentType: string;
  cleanup: () => Promise<void>;
}

/**
 * Streaming variant of safeFetch for SSE passthrough. Validates the same SSRF
 * policy and returns the raw upstream stream; the caller is responsible for
 * enforcing byte limits and invoking cleanup().
 */
export async function safeFetchStream(
  rawUrl: string,
  options: SafeFetchOptions & { streamTimeoutMs?: number } = {},
): Promise<SafeStreamHandle> {
  const timeoutMs = Math.min(Math.max(options.streamTimeoutMs ?? 120_000, 1000), 300_000);
  const allowPrivate = Boolean(options.allowPrivate);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const agent = new Agent({
    connect: {
      lookup: guardedLookup(allowPrivate) as never,
      timeout: Math.min(options.timeoutMs ?? 15_000, 15_000),
    },
    headersTimeout: options.timeoutMs ?? 30_000,
    bodyTimeout: timeoutMs,
  });

  const cleanup = async () => {
    clearTimeout(timer);
    await agent.close().catch(() => undefined);
  };

  let currentUrl = rawUrl;
  let headers = { ...(options.headers ?? {}) };

  try {
    for (let redirects = 0; ; redirects += 1) {
      await validateTargetUrl(currentUrl, {
        allowPrivate,
        allowedHosts: options.allowedHosts,
        enforceAllowlist: options.enforceAllowlist,
        allowedPorts: options.allowedPorts,
      });

      const response = await undiciFetch(currentUrl, {
        method: options.method ?? "POST",
        headers,
        body: options.body,
        redirect: "manual",
        dispatcher: agent,
        signal: controller.signal,
      });

      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        if (redirects >= (options.maxRedirects ?? 2)) {
          await response.body?.cancel();
          throw new SafeFetchError("too_many_redirects", "Upstream redirected too many times.", 502);
        }
        const nextUrl = new URL(location, currentUrl);
        if (nextUrl.hostname !== new URL(currentUrl).hostname) {
          headers = { ...headers };
          for (const key of Object.keys(headers)) {
            if (["authorization", "cookie"].includes(key.toLowerCase())) delete headers[key];
          }
        }
        await response.body?.cancel();
        currentUrl = nextUrl.toString();
        continue;
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        if (Object.keys(responseHeaders).length < 100) responseHeaders[key] = value;
      });

      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: response.body as unknown as ReadableStream<Uint8Array> | null,
        finalUrl: currentUrl,
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
        cleanup,
      };
    }
  } catch (error) {
    await cleanup();
    if ((error as Error).name === "AbortError") {
      throw new SafeFetchError("timeout", "Upstream streaming request timed out.", 504);
    }
    throw error;
  }
}
