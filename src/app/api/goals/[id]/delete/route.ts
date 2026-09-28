import { err, getAuthUser, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { newRef, verifyPin } from "@/lib/urpay-server/security";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/* POST /api/goals/[id]/delete — goals.py delete_goal
 * Returns any earmarked money back to the wallet first. */
export async function POST(req: Request, ctx: Ctx) {
  return runRoute(async () => {
    const body = await parseJsonBody<{ pin?: unknown }>(req);
    const user = getAuthUser(req);

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

    const idx = db.goals.findIndex((row) => row.id === goalId && row.user_id === user.id);
    if (idx === -1) {
      return err(404, "الهدف غير موجود");
    }
    const g = db.goals[idx];
    const savedBefore = g.saved_amount;

    /* return any earmarked money back to the wallet first */
    if (savedBefore > 0) {
      const now = Date.now();
      const ref = newRef();
      user.balance += savedBefore;
      db.txns.push({
        id: ++db.seq.txns,
        reference: ref,
        user_id: user.id,
        type: "goal_withdraw",
        direction: "in",
        amount: savedBefore,
        balance_after: user.balance,
        title: `سحب وإنهاء هدف «${g.name}»`,
        subtitle: "إغلاق الهدف ورجعة التوفير",
        category: "savings",
        counterparty_id: null,
        bill_id: null,
        created_at: now,
      });
    }

    db.goals.splice(idx, 1);
    return jsonOk({
      message:
        `انحذف هدف «${g.name}»` +
        (savedBefore > 0 ? " ورجّعنا توفيره لمحفظتك" : ""),
    });
  });
}
