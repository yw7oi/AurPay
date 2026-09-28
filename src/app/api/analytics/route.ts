import { getAuthUser, jsonOk, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { AR_MONTHS_SHORT } from "@/lib/urpay-server/constants";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/* GET /api/analytics — analytics.py my_analytics
 * 90-day spend by category (savings excluded), 6-month in/out trend,
 * bill status breakdown, top transfer counterparties. */
export async function GET(req: Request) {
  return runRoute(async () => {
    const user = getAuthUser(req);
    const db = getDb();
    const now = Date.now();
    const windowStart = now - 90 * DAY;

    /* spending by category (last 90 days, outgoing only; savings are
     * earmarked money, not spending — excluded from donut/totals) */
    const catMap = new Map<string, { total: number; count: number }>();
    for (const t of db.txns) {
      if (
        t.user_id !== user.id ||
        t.direction !== "out" ||
        t.category === "savings" ||
        t.created_at < windowStart
      ) {
        continue;
      }
      const cur = catMap.get(t.category) ?? { total: 0, count: 0 };
      cur.total += t.amount;
      cur.count += 1;
      catMap.set(t.category, cur);
    }
    const categories = [...catMap.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([category, v]) => ({
        category: category || "other",
        total: v.total,
        count: v.count,
      }));
    const spendTotal = categories.reduce((s, c) => s + c.total, 0);

    /* monthly trend — port of month_start(back): 0-based JS months,
     * negative values roll back whole years exactly like the Python loop */
    const nowDate = new Date(now);
    const monthStart = (back: number): number => {
      let y = nowDate.getUTCFullYear();
      let m = nowDate.getUTCMonth() - back;
      while (m < 0) {
        m += 12;
        y -= 1;
      }
      return Date.UTC(y, m, 1);
    };
    const months: { label: string; out: number; in: number }[] = [];
    for (let back = 5; back >= 0; back--) {
      const start = monthStart(back);
      const end = monthStart(back - 1);
      let outSum = 0;
      let inSum = 0;
      for (const t of db.txns) {
        if (t.user_id !== user.id || t.created_at < start || t.created_at >= end) {
          continue;
        }
        if (t.direction === "out" && t.category !== "savings") outSum += t.amount;
        else if (t.direction === "in") inSum += t.amount;
      }
      months.push({
        label: AR_MONTHS_SHORT[new Date(start).getUTCMonth()],
        out: outSum,
        in: inSum,
      });
    }

    /* bill status breakdown */
    const myBills = db.bills.filter((b) => b.user_id === user.id);
    const unpaid = myBills.filter((b) => b.status === "unpaid");
    const bills = {
      unpaid_count: unpaid.length,
      unpaid_total: unpaid.reduce((s, b) => s + b.amount, 0),
      overdue_count: unpaid.filter((b) => b.due_date < now).length,
    };

    /* transfer counterparties (top receivers last 90d) */
    const cpMap = new Map<number, { total: number; count: number }>();
    for (const t of db.txns) {
      if (
        t.user_id !== user.id ||
        t.type !== "transfer_out" ||
        t.created_at < windowStart ||
        t.counterparty_id === null
      ) {
        continue;
      }
      const cur = cpMap.get(t.counterparty_id) ?? { total: 0, count: 0 };
      cur.total += t.amount;
      cur.count += 1;
      cpMap.set(t.counterparty_id, cur);
    }
    const topCounterparties = [...cpMap.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 3)
      .flatMap(([cpId, v]) => {
        const cp = db.users.find((u) => u.id === cpId);
        if (!cp) return [];
        return [{
          name: cp.full_name,
          total: v.total,
          count: v.count,
          avatar_hue: cp.avatar_hue,
        }];
      });

    return jsonOk({
      window_days: 90,
      spend_total: spendTotal,
      categories,
      months,
      bills,
      top_counterparties: topCounterparties,
    });
  });
}
