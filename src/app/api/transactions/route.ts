import { getAuthUser, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { txnPublic } from "@/lib/urpay-server/serializers";

export const dynamic = "force-dynamic";

/* GET /api/transactions?limit=50&type= — wallet.py my_transactions
 * Newest-first (created_at desc, id desc as a deterministic tiebreaker). */
export async function GET(req: Request) {
  return runRoute(async () => {
    const user = getAuthUser(req);
    const params = new URL(req.url).searchParams;

    const limitRaw = params.get("limit");
    let limit = 50;
    if (limitRaw !== null) {
      const parsed = Number(limitRaw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return Response.json({ detail: "حد غير صالح" }, { status: 422 });
      }
      if (parsed > 200) {
        return Response.json({ detail: "الحد الأقصى 200 عملية" }, { status: 422 });
      }
      limit = parsed;
    }
    const typeFilter = params.get("type");

    const db = getDb();
    let rows = db.txns.filter((t) => t.user_id === user.id);
    if (typeFilter) rows = rows.filter((t) => t.type === typeFilter);
    rows = [...rows]
      .sort((a, b) => b.created_at - a.created_at || b.id - a.id)
      .slice(0, limit);

    return Response.json(rows.map(txnPublic));
  });
}
