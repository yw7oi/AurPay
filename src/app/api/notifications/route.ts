import { getAuthUser, jsonOk, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { notificationOut } from "@/lib/urpay-server/serializers";
import { runDueScheduled } from "@/lib/urpay-server/scheduler";
import {
  lazyDueNotifications,
  lazyMorningBrief,
  lazyWeeklyDigest,
  lazyWelcome,
} from "@/lib/urpay-server/notifications";

export const dynamic = "force-dynamic";

const FEED_LIMIT = 30;

/* GET /api/notifications — notifications.py my_notifications
 * The Python service ran a 20s background scheduler loop; in this serverless
 * port the lazy housekeeping below covers due scheduled payments the same way.
 * Then the four lazy generators (welcome, bill-due, weekly digest, morning
 * brief) run in the exact Python order before the feed is returned. */
export async function GET(req: Request) {
  return runRoute(async () => {
    const user = await getAuthUser(req);
    const db = getDb();

    runDueScheduled(db);
    lazyWelcome(db, user);
    lazyDueNotifications(db, user);
    lazyWeeklyDigest(db, user);
    lazyMorningBrief(db, user);

    const rows = db.notifications
      .filter((n) => n.user_id === user.id)
      .sort((a, b) => b.created_at - a.created_at || b.id - a.id)
      .slice(0, FEED_LIMIT);

    const unread = db.notifications.filter(
      (n) => n.user_id === user.id && !n.is_read,
    ).length;

    return jsonOk({
      items: rows.map(notificationOut),
      unread,
    });
  });
}
