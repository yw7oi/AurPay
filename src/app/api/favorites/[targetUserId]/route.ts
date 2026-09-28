import { err, getAuthUser, jsonOk, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ targetUserId: string }> };

/* DELETE /api/favorites/[targetUserId] — favorites.py remove_favorite */
export async function DELETE(req: Request, ctx: Ctx) {
  return runRoute(async () => {
    const user = getAuthUser(req);
    const db = getDb();

    const { targetUserId } = await ctx.params;
    const targetId = Number(targetUserId);
    if (!Number.isInteger(targetId)) {
      return err(404, "غير موجود بالمفضلة");
    }

    const idx = db.favorites.findIndex(
      (f) => f.user_id === user.id && f.target_user_id === targetId,
    );
    if (idx === -1) {
      return err(404, "غير موجود بالمفضلة");
    }
    db.favorites.splice(idx, 1);
    return jsonOk({ message: "تمت الإزالة من المفضلة" });
  });
}
