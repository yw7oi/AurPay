import { err, getAuthUser, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { fmtAr, goalItem, isoNaive } from "@/lib/urpay-server/serializers";
import { newRef, verifyPin } from "@/lib/urpay-server/security";
import type { SavingsGoalRow } from "@/lib/urpay-server/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const MIN_DEPOSIT = 1_000;
const MAX_DEPOSIT = 5_000_000;

/* POST /api/goals/[id]/withdraw — goals.py withdraw_goal
 * Moves earmarked money back to the wallet. amount=null → withdraw all. */
export async function POST(req: Request, ctx: Ctx) {
  return runRoute(async () => {
    const body = await parseJsonBody<{ amount?: unknown; pin?: unknown }>(req);
    const user = await getAuthUser(req);

    const { id } = await ctx.params;
    const goalId = Number(id);
    if (!Number.isInteger(goalId)) {
      return err(404, "الهدف غير موجود");
    }

    const db = getDb();
    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!verifyPin(pin, user.pin_salt, user.pin_hash)) {
      return err(403, "رمز الـ PIN غير صحيح");
    }

    const g: SavingsGoalRow | undefined = db.goals.find(
      (row) => row.id === goalId && row.user_id === user.id,
    );
    if (!g) {
      return err(404, "الهدف غير موجود");
    }

    let amount: number;
    if (body.amount === null || body.amount === undefined) {
      amount = g.saved_amount; // withdraw everything
    } else {
      if (
        typeof body.amount !== "number" ||
        !Number.isInteger(body.amount) ||
        body.amount < MIN_DEPOSIT ||
        body.amount > MAX_DEPOSIT
      ) {
        return err(422, "مبلغ السحب يجب أن يكون بين 1,000 و 5,000,000 د.ع");
      }
      amount = body.amount;
    }
    if (amount <= 0 || amount > g.saved_amount) {
      return err(
        422,
        `المبلغ يجب أن يكون بين ${fmtAr(MIN_DEPOSIT)} و ${fmtAr(g.saved_amount)} د.ع`,
      );
    }

    const now = Date.now();
    const ref = newRef();
    user.balance += amount;
    g.saved_amount -= amount;
    g.updated_at = now;
    if (g.status === "completed" && g.saved_amount < g.target_amount) {
      g.status = "active"; // reflect reality after a big withdrawal
    }

    db.txns.push({
      id: ++db.seq.txns,
      reference: ref,
      user_id: user.id,
      type: "goal_withdraw",
      direction: "in",
      amount,
      balance_after: user.balance,
      title: `سحب من هدف «${g.name}»`,
      subtitle: "رجعة التوفير للمحفظة",
      category: "savings",
      counterparty_id: null,
      bill_id: null,
      created_at: now,
    });

    return jsonOk({
      message: `رجّعنا ${fmtAr(amount)} د.ع من «${g.name}» لمحفظتك`,
      goal: goalItem(g),
      receipt: {
        reference: ref,
        title: `سحب من هدف «${g.name}»`,
        subtitle: "",
        amount,
        balance_after: user.balance,
        created_at: isoNaive(now),
      },
    });
  });
}
