import { err, getAuthUser, jsonOk, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { fmtAr } from "@/lib/urpay-server/serializers";
import { notify } from "@/lib/urpay-server/notify";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/* POST /api/transfer/decline/[id] — wallet.py decline_transfer (receiver only) */
export async function POST(req: Request, ctx: Ctx) {
  return runRoute(async () => {
    const user = getAuthUser(req);
    const { id } = await ctx.params;
    const requestId = Number(id);
    if (!Number.isInteger(requestId)) return err(404, "الطلب غير موجود");

    const db = getDb();
    const request = db.transferRequests.find((r) => r.id === requestId);
    if (!request || request.receiver_id !== user.id || request.status !== "pending") {
      return err(404, "الطلب غير موجود");
    }
    request.status = "declined";

    const sender = db.users.find((u) => u.id === request.sender_id);
    if (sender) {
      notify(db, sender.id, {
        kind: "transfer_declined",
        title: `${user.full_name} رفض حوالتك`,
        body: `مبلغ ${fmtAr(request.amount)} د.ع رُدّ لرصيدك المتاح.`,
        amount: request.amount,
        reference: `tr-${request.id}`,
      });
    }
    return jsonOk({ message: "تم رفض الحوالة" });
  });
}
