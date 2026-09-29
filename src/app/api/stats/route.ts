import { getDb } from "@/lib/urpay-server/store";
import { ensureLoaded, persistState } from "@/lib/urpay-server/persist";

export const dynamic = "force-dynamic";

/* GET /api/stats — public.py (also hydrates the shared DB when configured) */
export async function GET() {
  await ensureLoaded();
  const db = getDb();
  const users = db.users.length;
  const txns = db.txns.length;
  const volume = db.txns
    .filter((t) => t.direction === "out")
    .reduce((s, t) => s + t.amount, 0);
  const paid = db.bills.filter((b) => b.status === "paid").length;
  const demo = db.users.find((u) => u.is_demo) ?? null;

  try {
    return Response.json({
      users,
      transactions: txns,
      volume_iqd: volume,
      bills_paid: paid,
      demo: demo
        ? {
            full_name: demo.full_name,
            card_number: demo.card_number,
            pin: "123456",
            city: demo.city,
          }
        : null,
    });
  } finally {
    /* lazy housekeeping (demo bill restock etc.) can mutate on GETs */
    await persistState();
  }
}
