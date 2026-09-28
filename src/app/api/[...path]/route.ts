import { NextRequest } from "next/server";

/* Catch-all for unmatched /api/* paths — REPLACES the old localhost:8000
 * proxy: real routes are handled by their own files, anything else gets a
 * clean 404 with the Arabic detail shape the frontend expects. */
export const dynamic = "force-dynamic";

async function notFound() {
  return Response.json({ detail: "غير موجود" }, { status: 404 });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
