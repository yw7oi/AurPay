/* Budget helpers — port of app/budget.py.
 * checkBudgetCrossing must be called AFTER the outgoing txn was pushed so
 * the fresh txn is visible to the month-to-date sum. */

import type { Db, UserRow } from "./types";
import { CATEGORY_AR } from "./constants";
import { notify } from "./notify";
import { fmtAr, monthStart } from "./serializers";

export type BudgetCrossing = {
  category: string;
  limit: number;
  spent: number;
  over: number;
};

export function checkBudgetCrossing(
  db: Db,
  user: UserRow,
  category: string,
  paidAmount: number,
): BudgetCrossing | null {
  const now = Date.now();
  const start = monthStart(now);

  const budget = db.budgets.find(
    (b) => b.user_id === user.id && b.category === category,
  );
  if (!budget || budget.monthly_limit <= 0) return null;

  const spentNow = db.txns
    .filter(
      (t) =>
        t.user_id === user.id &&
        t.direction === "out" &&
        t.category === category &&
        t.created_at >= start,
    )
    .reduce((s, t) => s + t.amount, 0);

  const spentBefore = spentNow - paidAmount;
  // fire only on the crossing event (not on every payment after)
  if (spentBefore <= budget.monthly_limit && budget.monthly_limit < spentNow) {
    const over = spentNow - budget.monthly_limit;
    notify(db, user.id, {
      kind: "budget_exceeded",
      title: `تجاوزت ميزانية ${CATEGORY_AR[category] ?? category}`,
      body:
        `صرفك لهذا الشهر ${fmtAr(spentNow)} د.ع من حد ` +
        `${fmtAr(budget.monthly_limit)} د.ع (+${fmtAr(over)}).`,
      amount: spentNow,
      reference: `budget-${category}-${new Date(now).getUTCFullYear()}-${new Date(now).getUTCMonth() + 1}`,
    });
    return { category, limit: budget.monthly_limit, spent: spentNow, over };
  }
  return null;
}
