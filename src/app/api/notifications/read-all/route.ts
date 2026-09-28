import { getAuthUser, jsonOk, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";

export const dynamic = "force-dynamic";

/* POST /api/notifications/read-all — notifications.py read_all */
export async function POST(req: Request) {
  return runRoute(async () => {
    const user = getAuthUser(req);
    const db = getDb();

    let updated = 0;
    for (const n of db.notifications) {
      if (n.user_id === user.id && !n.is_read) {
        n.is_read = true;
        updated += 1;
      }
    }
    return jsonOk({
      message: "تم تعليم الكل كمقروء",
      updated,
    });
  });
}
