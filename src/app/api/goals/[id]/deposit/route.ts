import { err, getAuthUser, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { fmtAr, goalItem, isoNaive } from "@/lib/urpay-server/serializers";
import { newRef, verifyPin } from "@/lib/urpay-server/security";
import { notify } from "@/lib/urpay-server/notify";
import type { SavingsGoalRow, UserRow } from "@/lib/urpay-server/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const MIN_DEPOSIT = 1_000;
const MAX_DEPOSIT = 5_000_000;

function findGoal(
  db: ReturnType<typeof getDb>,
  user: UserRow,
  goalId: number,
): SavingsGoalRow | null {
  const g = db.goals.find((row) => row.id === goalId);
  if (!g || g.user_id !== user.id) return null;
  return g;
}

/* POST /api/goals/[id]/deposit — goals.py deposit_goal
 * Moves IQD from the spendable balance into the goal (earmarked money). */
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

    const g = findGoal(db, user, goalId);
    if (!g) {
      return err(404, "الهدف غير موجود");
    }

    const amount = body.amount;
    if (
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount < MIN_DEPOSIT ||
      amount > MAX_DEPOSIT
    ) {
      return err(422, "مبلغ الإيداع يجب أن يكون بين 1,000 و 5,000,000 د.ع");
    }
    if (user.balance < amount) {
      return err(400, "رصيدك ما يكفي — عبّي المحفظة أولًا");
    }

    const now = Date.now();
    const ref = newRef();
    user.balance -= amount;
    g.saved_amount += amount;
    g.updated_at = now;

    const justReached = g.status === "active" && g.saved_amount >= g.target_amount;
    if (justReached) {
      g.status = "completed";
    }

    db.txns.push({
      id: ++db.seq.txns,
      reference: ref,
      user_id: user.id,
      type: "goal_deposit",
      direction: "out",
      amount,
      balance_after: user.balance,
      title: `توفير — ${g.name}`,
      subtitle: "إيداع بالهدف" + (justReached ? " 🎉 اكتمل!" : ""),
      category: "savings",
      counterparty_id: null,
      bill_id: null,
      created_at: now,
    });

    if (justReached) {
      notify(db, user.id, {
        kind: "goal_reached",
        title: `وصلت لهدفك «${g.name}» 🎉`,
        body:
          `وفّرت ${fmtAr(g.saved_amount)} من ${fmtAr(g.target_amount)} د.ع — ` +
          "مبروك! تقدر تسحب التوفير لمحفظتك وقتما تحب.",
        amount: g.saved_amount,
        reference: `goal-${g.id}`,
      });
    }

    return jsonOk({
      message:
        `وفّرت ${fmtAr(amount)} د.ع لهدف «${g.name}»` +
        (justReached ? " — واكتمل الهدف 🎉" : ""),
      goal: goalItem(g),
      receipt: {
        reference: ref,
        title: `توفير — ${g.name}`,
        subtitle: "",
        amount,
        balance_after: user.balance,
        created_at: isoNaive(now),
      },
    });
  });
}
