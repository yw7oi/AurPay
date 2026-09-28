import { err, getAuthUser, jsonOk, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/* POST /api/scheduled/[id]/cancel — scheduled.py cancel_scheduled */
export async function POST(req: Request, ctx: Ctx) {
  return runRoute(async () => {
    const user = getAuthUser(req);
    const db = getDb();

    const { id } = await ctx.params;
    const spId = Number(id);
    if (!Number.isInteger(spId)) {
      return err(404, "الجدولة غير موجودة أو منتهية");
    }

    const sp = db.scheduled.find((row) => row.id === spId);
    if (
      !sp ||
      sp.user_id !== user.id ||
      (sp.status !== "pending" && sp.status !== "paused")
    ) {
      return err(404, "الجدولة غير موجودة أو منتهية");
    }
    sp.status = "cancelled";
    return jsonOk({ message: "تم إلغاء الجدولة" });
  });
}
