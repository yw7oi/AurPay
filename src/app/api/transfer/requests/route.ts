import { getAuthUser, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { isoNaive } from "@/lib/urpay-server/serializers";
import { expireStaleRequests } from "@/lib/urpay-server/transfer";

export const dynamic = "force-dynamic";

/* GET /api/transfer/requests — wallet.py my_transfer_requests */
export async function GET(req: Request) {
  return runRoute(async () => {
    const user = await getAuthUser(req);
    const db = getDb();
    expireStaleRequests(db, user); // TTL housekeeping

    const rows = db.transferRequests
      .filter(
        (r) =>
          (r.sender_id === user.id || r.receiver_id === user.id) &&
          r.status === "pending",
      )
      .sort((a, b) => b.created_at - a.created_at);

    return Response.json(
      rows.map((r) => {
        const otherId = r.sender_id === user.id ? r.receiver_id : r.sender_id;
        const other = db.users.find((u) => u.id === otherId);
        return {
          id: r.id,
          amount: r.amount,
          status: r.status,
          role: r.sender_id === user.id ? ("sender" as const) : ("receiver" as const),
          counterparty: other ? other.full_name : "",
          counterparty_card: other ? `•••• ${other.card_number.slice(-4)}` : "",
          created_at: isoNaive(r.created_at),
        };
      }),
    );
  });
}
