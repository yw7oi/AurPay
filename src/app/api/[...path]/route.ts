import { NextRequest } from "next/server";

/**
 * Thin proxy: forwards /api/* (except /api/internal/*) to the UrPay FastAPI
 * backend on port 8000. Keeps the browser on a single origin — works both in
 * the sandbox (port 3000 exposed) and locally via start.bat.
 */
const BACKEND = process.env.URPAY_BACKEND_URL ?? "http://127.0.0.1:8000";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
  "accept-encoding",
]);

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = `${BACKEND}/api/${path.join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });

  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  if (!["GET", "HEAD"].includes(req.method)) {
    init.body = await req.arrayBuffer();
    // @ts-expect-error -- required by undici for streaming bodies
    init.duplex = "half";
  }

  try {
    const upstream = await fetch(target, init);
    const respHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) respHeaders.set(key, value);
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "backend unreachable";
    return Response.json(
      { detail: `تعذر الوصول لخدمة أور پاي (${message}) — تأكد من تشغيل الباكند على المنفذ 8000` },
      { status: 502 },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
export const dynamic = "force-dynamic";
