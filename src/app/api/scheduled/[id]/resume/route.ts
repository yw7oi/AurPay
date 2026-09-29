import { err, getAuthUser, jsonOk, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { scheduledItem } from "@/lib/urpay-server/serializers";
import { MIN_AHEAD_MS } from "@/lib/urpay-server/scheduler";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/* POST /api/scheduled/[id]/resume — scheduled.py resume_scheduled
 * Un-freeze a paused mandate. If its time passed while paused, re-arm it to
 * +5 minutes so it doesn't fire the instant it's resumed. */
export async function POST(req: Request, ctx: Ctx) {
  return runRoute(async () => {
    const user = await getAuthUser(req);
    const db = getDb();

    const { id } = await ctx.params;
    const spId = Number(id);
    if (!Number.isInteger(spId)) {
      return err(404, "الجدولة غير موقوفة");
    }

    const sp = db.scheduled.find((row) => row.id === spId);
    if (!sp || sp.user_id !== user.id || sp.status !== "paused") {
      return err(404, "الجدولة غير موقوفة");
    }
    const now = Date.now();
    if (sp.next_run_at < now + MIN_AHEAD_MS) {
      sp.next_run_at = now + 5 * 60_000;
    }
    sp.status = "pending";
    return jsonOk({
      message: "تم استئناف الجدولة",
      scheduled: scheduledItem(sp),
    });
  });
}
