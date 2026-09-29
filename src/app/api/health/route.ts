import { ensureLoaded, persistenceInfo } from "@/lib/urpay-server/persist";

export const dynamic = "force-dynamic";

/* GET /api/health — public.py.
 * `db` tells you which storage mode the instance is running in:
 *   memory → no shared store configured (demo data resets per instance)
 *   turso  → shared Turso/libSQL database (accounts/transfers survive)
 *   blob   → shared Vercel Blob state file (zero-config, survives)
 *   failed → a store was configured but is unreachable (fail-open to memory)
 * `serverless` = running on Vercel; `hint` explains memory-mode risks there.
 * ensureLoaded() so the report reflects the ACTUAL post-hydration state —
 * an operator checking health right after connecting a Blob store must see
 * "blob", not a transient "starting". */
export async function GET() {
  await ensureLoaded();
  return Response.json({
    status: "ok",
    service: "urpay-backend",
    db: persistenceInfo(),
  });
}
