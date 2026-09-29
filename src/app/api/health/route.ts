import { ensureLoaded, persistenceInfo, probeStore } from "@/lib/urpay-server/persist";

export const dynamic = "force-dynamic";

/* GET /api/health — public.py.
 * `db` tells you which storage mode the instance is running in:
 *   memory → no shared store configured (demo data resets per instance)
 *   turso  → shared Turso/libSQL database (accounts/transfers survive)
 *   blob   → shared Vercel Blob state file (zero-config, survives)
 *   failed → a store was configured but is unreachable (fail-open to memory)
 * `db.env` (booleans only, never values) shows WHICH credentials this
 *   deployment can see — all-false with a connected store means the
 *   deployment predates the connection and needs a Redeploy.
 * `serverless` = running on Vercel; `hint` explains memory-mode risks there.
 *
 * GET /api/health?probe=1 additionally runs a REAL write→read→delete
 * round-trip through the active store and returns `probe` with the raw
 * error + an Arabic `advice` naming the most likely fix — the definitive
 * "is my Blob store actually linked and working?" check.
 * ensureLoaded() so the report reflects the ACTUAL post-hydration state —
 * an operator checking health right after connecting a Blob store must see
 * "blob", not a transient "starting". */
export async function GET(req: Request) {
  await ensureLoaded();
  const wantProbe = new URL(req.url).searchParams.get("probe") === "1";
  const probe = wantProbe ? await probeStore() : null;
  return Response.json({
    status: "ok",
    service: "urpay-backend",
    db: persistenceInfo(),
    ...(probe ? { probe } : {}),
  });
}
