import { err, getAuthUser, jsonOk, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { scheduledItem } from "@/lib/urpay-server/serializers";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/* POST /api/scheduled/[id]/pause — scheduled.py pause_scheduled
 * Freeze a pending mandate — the scheduler skips it until resumed. */
export async function POST(req: Request, ctx: Ctx) {
  return runRoute(async () => {
    const user = getAuthUser(req);
    const db = getDb();

    const { id } = await ctx.params;
    const spId = Number(id);
    if (!Number.isInteger(spId)) {
      return err(404, "الجدولة غير موجودة أو موقوفة سابقًا");
    }

    const sp = db.scheduled.find((row) => row.id === spId);
    if (!sp || sp.user_id !== user.id || sp.status !== "pending") {
      return err(404, "الجدولة غير موجودة أو موقوفة سابقًا");
    }
    sp.status = "paused";
    return jsonOk({
      message: "تم إيقاف الجدولة مؤقتًا — استأنفها وقتما تحب",
      scheduled: scheduledItem(sp),
    });
  });
}
