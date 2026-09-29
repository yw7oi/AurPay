/* HTTP helpers for the UrPay API routes.
 *
 * Every error response is `{ detail: string }` — the frontend client ONLY
 * reads `detail` as a plain string, so never return structured bodies. */

import type { UserRow } from "./types";
import { getDb } from "./store";
import { decodeToken } from "./security";
import { ensureLoaded, memoryModeWarning, persistState, refreshNow } from "./persist";

export class ApiErr extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

/** error response helper: always `{ detail: string }` */
export function err(status: number, detail: string): Response {
  return Response.json({ detail }, { status });
}

export function jsonOk(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

/** Parse a JSON request body; 400 with an Arabic detail on bad payloads. */
export async function parseJsonBody<T>(req: Request): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiErr(400, "طلب غير صالح");
  }
  if (body === null || typeof body !== "object") {
    throw new ApiErr(400, "طلب غير صالح");
  }
  return body as T;
}

/** Wrap a route handler so ApiErr throws become `{ detail }` responses.
 *
 * Also the persistence hook point: the shared-database state is (re)loaded
 * before the handler runs and diff-persisted after it — including on the
 * ApiErr path (lockout counters etc. mutate then throw). */
export async function runRoute(fn: () => Promise<Response>): Promise<Response> {
  await ensureLoaded();
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiErr) return err(e.status, e.detail);
    console.error("[urpay] unhandled route error:", e);
    return err(500, "خطأ داخلي بالخادم");
  } finally {
    await persistState();
  }
}

/** Auth guard — port of security.get_current_user.
 *
 * ASYNC + multi-instance guard: when the token is valid but the account is
 * missing from this instance's snapshot (registered moments ago on another
 * instance / behind the sync TTL), it forces a shared-state re-sync and
 * looks ONE more time before answering 401 — this is what stops the
 * "logged in, kicked out after two seconds" loop on Vercel. */
export async function getAuthUser(req: Request): Promise<UserRow> {
  const header = req.headers.get("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    throw new ApiErr(401, "رمز الدخول مفقود — يرجى تسجيل الدخول");
  }
  const token = header.slice(7).trim();
  const userId = decodeToken(token);
  if (userId === null) {
    throw new ApiErr(401, "انتهت صلاحية الجلسة — سجّل الدخول من جديد");
  }
  let user = getDb().users.find((u) => u.id === userId);
  if (!user) {
    await refreshNow();
    user = getDb().users.find((u) => u.id === userId);
    if (!user) {
      const warning = memoryModeWarning();
      throw new ApiErr(
        401,
        warning
          ? `الحساب غير موجود — ${warning}`
          : "الحساب غير موجود",
      );
    }
  }
  return user;
}
