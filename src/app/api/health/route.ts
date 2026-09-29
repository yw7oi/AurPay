import { persistenceInfo } from "@/lib/urpay-server/persist";

export const dynamic = "force-dynamic";

/* GET /api/health — public.py.
 * `db` tells you which storage mode the instance is running in:
 *   memory → no TURSO_DATABASE_URL set (demo data resets per instance)
 *   turso  → shared persistent database (accounts/transfers survive)
 *   failed → Turso was configured but is unreachable (fail-open to memory)
 */
export async function GET() {
  return Response.json({
    status: "ok",
    service: "urpay-backend",
    db: persistenceInfo(),
  });
}
