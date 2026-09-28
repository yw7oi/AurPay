import { err, getAuthUser, jsonOk, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/* POST /api/notifications/[id]/read — notifications.py read_one */
export async function POST(req: Request, ctx: Ctx) {
  return runRoute(async () => {
    const user = getAuthUser(req);
    const db = getDb();

    const { id } = await ctx.params;
    const notifId = Number(id);
    if (!Number.isInteger(notifId)) {
      return err(404, "الإشعار غير موجود");
    }

    const n = db.notifications.find((row) => row.id === notifId);
    if (!n || n.user_id !== user.id) {
      return err(404, "الإشعار غير موجود");
    }
    n.is_read = true;
    return jsonOk({ message: "تم" });
  });
}
