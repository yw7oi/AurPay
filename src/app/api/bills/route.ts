import { getAuthUser, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { billPublic } from "@/lib/urpay-server/serializers";

export const dynamic = "force-dynamic";

/* GET /api/bills?status=all|unpaid|paid — wallet.py
 * Ordered unpaid-first, then by due_date asc. */
export async function GET(req: Request) {
  return runRoute(async () => {
    const user = getAuthUser(req);
    const status = new URL(req.url).searchParams.get("status") ?? "all";

    const db = getDb();
    let bills = db.bills.filter((b) => b.user_id === user.id);
    if (status === "unpaid" || status === "paid") {
      bills = bills.filter((b) => b.status === status);
    }
    bills = [...bills].sort((a, b) => {
      const unpaidFirst =
        (a.status === "unpaid" ? 1 : 0) - (b.status === "unpaid" ? 1 : 0);
      if (unpaidFirst !== 0) return -unpaidFirst; // unpaid first
      return a.due_date - b.due_date;
    });
    return Response.json(bills.map(billPublic));
  });
}
