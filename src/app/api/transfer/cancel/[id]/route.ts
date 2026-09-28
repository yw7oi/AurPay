import { err, getAuthUser, jsonOk, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/* POST /api/transfer/cancel/[id] — wallet.py cancel_transfer (sender only) */
export async function POST(req: Request, ctx: Ctx) {
  return runRoute(async () => {
    const user = getAuthUser(req);
    const { id } = await ctx.params;
    const requestId = Number(id);
    if (!Number.isInteger(requestId)) return err(404, "الطلب غير موجود");

    const db = getDb();
    const request = db.transferRequests.find((r) => r.id === requestId);
    if (!request || request.sender_id !== user.id || request.status !== "pending") {
      return err(404, "الطلب غير موجود");
    }
    request.status = "cancelled";
    return jsonOk({ message: "تم إلغاء طلب التحويل" });
  });
}
