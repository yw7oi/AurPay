import { err, getAuthUser, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { BUDGETABLE_CATEGORIES } from "@/lib/urpay-server/constants";
import { budgetItem, currentMonthLabel, isoNaive, monthStart } from "@/lib/urpay-server/serializers";
import type { BudgetRow } from "@/lib/urpay-server/types";

export const dynamic = "force-dynamic";

/** Month-to-date outgoing spend for one category (budgets.py _month_spent). */
function monthSpent(db: ReturnType<typeof getDb>, userId: number, category: string, start: number): number {
  return db.txns
    .filter(
      (t) =>
        t.user_id === userId &&
        t.direction === "out" &&
        t.category === category &&
        t.created_at >= start,
    )
    .reduce((s, t) => s + t.amount, 0);
}

/* GET /api/budgets — budgets.py my_budgets
 * Budget rows merged with month-to-date spend + status. */
export async function GET(req: Request) {
  return runRoute(async () => {
    const user = await getAuthUser(req);
    const db = getDb();
    const now = Date.now();
    const start = monthStart(now);

    const rows = db.budgets
      .filter((b) => b.user_id === user.id)
      .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));

    const items = rows.map((b) => budgetItem(b, monthSpent(db, user.id, b.category, start)));
    const totalLimit = rows.reduce((s, b) => s + b.monthly_limit, 0);
    const totalSpent = items.reduce((s, it) => s + it.spent, 0);

    return jsonOk({
      month: currentMonthLabel(now),
      month_start: isoNaive(start),
      items,
      total: { limit: totalLimit, spent: totalSpent },
      categories: BUDGETABLE_CATEGORIES,
    });
  });
}

/* PUT /api/budgets — budgets.py upsert_budget
 * A limit of 0 removes the budget (user cleared it). */
export async function PUT(req: Request) {
  return runRoute(async () => {
    const body = await parseJsonBody<{ category?: unknown; monthly_limit?: unknown }>(req);
    const user = await getAuthUser(req);
    const db = getDb();

    const category = body.category;
    if (typeof category !== "string" || !BUDGETABLE_CATEGORIES.includes(category)) {
      return err(422, "هذا التصنيف ما يدعم ميزانية");
    }
    const limit = body.monthly_limit;
    if (
      typeof limit !== "number" ||
      !Number.isInteger(limit) ||
      limit < 0 ||
      limit > 20_000_000
    ) {
      return err(422, "الحد الشهري يجب أن يكون بين 0 و 20,000,000 د.ع");
    }

    /* limit of 0 removes the budget */
    if (limit === 0) {
      db.budgets = db.budgets.filter(
        (b) => !(b.user_id === user.id && b.category === category),
      );
      return jsonOk({
        message: `انحذفت ميزانية ${category}`,
        removed: true,
      });
    }

    const existing = db.budgets.find(
      (b) => b.user_id === user.id && b.category === category,
    );
    if (existing) {
      existing.monthly_limit = limit;
      existing.updated_at = Date.now();
    } else {
      const row: BudgetRow = {
        id: ++db.seq.budgets,
        user_id: user.id,
        category,
        monthly_limit: limit,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      db.budgets.push(row);
    }

    return jsonOk({
      message: "تم تحديث الميزانية ✅",
      budget: { category, monthly_limit: limit },
      removed: false,
    });
  });
}
