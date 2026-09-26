import { NextRequest } from "next/server";

/**
 * Thin proxy: forwards /api/* (except /api/internal/*) to the UrPay FastAPI
 * backend. The browser talks ONLY to the frontend origin (port 3000) — no
 * CORS, no hardcoded ports client-side; works identically in the sandbox,
 * via start.bat on Windows, or run.sh on Linux/macOS.
 *
 * Backend address resolution — NOT hardcoded to a single port:
 *   1. URPAY_BACKEND_URL env override (any host:port, e.g.
 *      http://localhost:9000 or even a remote machine)
 *   2. http://127.0.0.1:8000   (default — where start.bat / run.sh put it)
 *   3. http://localhost:8000   (IPv6-first machines resolve ::1 → 127.0.0.1)
 * The first candidate that answers wins and is cached; if it later dies the
 * cache is invalidated and the list is re-tried on the next request.
 */
const CANDIDATES: string[] = [];
if (process.env.URPAY_BACKEND_URL) {
  CANDIDATES.push(process.env.URPAY_BACKEND_URL.trim().replace(/\/+$/, ""));
}
CANDIDATES.push("http://127.0.0.1:8000", "http://localhost:8000");

let liveBackend: string | null = null;

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
  "accept-encoding",
]);

/** Seconds to wait for response HEADERS per candidate (streams may run long). */
const CONNECT_TIMEOUT_MS = 4000;

async function tryFetch(target: string, init: RequestInit): Promise<Response> {
  // Manual timeout so long-lived SSE bodies are NOT aborted mid-stream: the
  // timer only guards time-to-headers and is cleared as soon as they arrive.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CONNECT_TIMEOUT_MS);
  try {
    const res = await fetch(target, { ...init, signal: ac.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const suffix = `/api/${path.join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  let body: ArrayBuffer | null = null;
  if (!["GET", "HEAD"].includes(req.method)) {
    body = await req.arrayBuffer();
    // @ts-expect-error -- required by undici for streaming bodies
    init.duplex = "half";
  }

  // Candidate order: the cached winner first, then the full list.
  const order = liveBackend
    ? [liveBackend, ...CANDIDATES.filter((c) => c !== liveBackend)]
    : CANDIDATES;
  const tried: string[] = [];
  let lastError: unknown = null;

  for (const base of order) {
    const attempt: RequestInit = { ...init };
    if (body !== null) attempt.body = body;
    try {
      const upstream = await tryFetch(`${base}${suffix}`, attempt);
      liveBackend = base;
      const respHeaders = new Headers();
      upstream.headers.forEach((value, key) => {
        if (!HOP_BY_HOP.has(key.toLowerCase())) respHeaders.set(key, value);
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: respHeaders,
      });
    } catch (err) {
      tried.push(base);
      lastError = err;
      if (base === liveBackend) liveBackend = null; // stale winner — re-resolve
    }
  }

  const message = lastError instanceof Error ? lastError.message : "backend unreachable";
  return Response.json(
    {
      detail:
        `تعذر الوصول لخدمة أور پاي (${message}). ` +
        "شغّل الخدمة عبر start.bat (ويندوز) أو run.sh (لينكس)، " +
        "أو اضبط عنوان الباكند عبر URPAY_BACKEND_URL " +
        "(الافتراضي: localhost:8000)",
      tried,
    },
    { status: 502 },
  );
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
export const dynamic = "force-dynamic";
