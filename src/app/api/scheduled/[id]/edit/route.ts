import { err, getAuthUser, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { scheduledItem } from "@/lib/urpay-server/serializers";
import { parseIsoDatetime } from "@/lib/urpay-server/validate";
import { verifyPin } from "@/lib/urpay-server/security";
import { MAX_AHEAD_MS, MIN_AHEAD_MS } from "@/lib/urpay-server/scheduler";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/* POST /api/scheduled/[id]/edit — scheduled.py edit_scheduled
 * Change a pending mandate's amount and/or next run (PIN-verified). */
export async function POST(req: Request, ctx: Ctx) {
  return runRoute(async () => {
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const user = await getAuthUser(req);

    const { id } = await ctx.params;
    const spId = Number(id);
    if (!Number.isInteger(spId)) {
      return err(404, "الجدولة غير موجودة أو منتهية");
    }

    const db = getDb();
    const sp = db.scheduled.find((row) => row.id === spId);
    if (
      !sp ||
      sp.user_id !== user.id ||
      (sp.status !== "pending" && sp.status !== "paused")
    ) {
      return err(404, "الجدولة غير موجودة أو منتهية");
    }

    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!verifyPin(pin, user.pin_salt, user.pin_hash)) {
      return err(403, "رمز الـ PIN غير صحيح");
    }

    const amount = body.amount ?? null;
    const executeAt = body.execute_at ?? null;
    if (amount === null && executeAt === null) {
      return err(422, "لا يوجد تغيير — أرسل مبلغًا أو تاريخًا جديدًا");
    }

    if (amount !== null) {
      if (
        typeof amount !== "number" ||
        !Number.isInteger(amount) ||
        amount <= 1000 ||
        amount > 5_000_000
      ) {
        return err(422, "المبلغ يجب أن يكون أكثر من 1,000 د.ع وأقل من 5,000,000 د.ع");
      }
    }

    let when = sp.next_run_at;
    if (executeAt !== null) {
      const parsed = parseIsoDatetime(executeAt);
      if (parsed === null) {
        return err(422, "صيغة التاريخ غير صحيحة — استخدم ISO");
      }
      when = parsed;
      const now = Date.now();
      if (when < now + MIN_AHEAD_MS) {
        when = now + MIN_AHEAD_MS; // clamp near-instant
      }
      if (when > now + MAX_AHEAD_MS) {
        return err(422, "ما تصير جدولة أبعد من سنة");
      }
    }

    if (amount !== null) {
      sp.amount = amount;
    }
    sp.next_run_at = when;
    return jsonOk({
      message: "تم تعديل الجدولة",
      scheduled: scheduledItem(sp),
    });
  });
}
