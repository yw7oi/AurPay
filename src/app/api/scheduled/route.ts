import { err, getAuthUser, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { BILLERS } from "@/lib/urpay-server/constants";
import { scheduledItem } from "@/lib/urpay-server/serializers";
import { digitsOnly, parseIsoDatetime } from "@/lib/urpay-server/validate";
import { verifyPin, randomDigits } from "@/lib/urpay-server/security";
import { MAX_AHEAD_MS, MIN_AHEAD_MS, runDueScheduled } from "@/lib/urpay-server/scheduler";
import type { ScheduledRow } from "@/lib/urpay-server/types";

export const dynamic = "force-dynamic";

/* GET /api/scheduled — scheduled.py list_scheduled
 * Lazy housekeeping first (executes anything due — covers scheduler downtime),
 * then the pending list (INCLUDES paused rows so the user can resume them);
 * totals only count actually-runnable (pending) mandates. */
export async function GET(req: Request) {
  return runRoute(async () => {
    const user = getAuthUser(req);
    const db = getDb();

    runDueScheduled(db);

    const pending = db.scheduled
      .filter(
        (sp) =>
          sp.user_id === user.id &&
          (sp.status === "pending" || sp.status === "paused"),
      )
      .sort((a, b) => a.next_run_at - b.next_run_at);

    const history = db.scheduled
      .filter(
        (sp) =>
          sp.user_id === user.id &&
          sp.status !== "pending" &&
          sp.status !== "paused",
      )
      .sort(
        (a, b) =>
          (b.last_run_at ?? 0) - (a.last_run_at ?? 0) || b.created_at - a.created_at,
      )
      .slice(0, 8);

    const runnable = pending.filter((sp) => sp.status === "pending");
    const monthlyTotal = runnable
      .filter((sp) => sp.frequency === "monthly")
      .reduce((s, sp) => s + sp.amount, 0);

    return jsonOk({
      pending: pending.map(scheduledItem),
      history: history.map(scheduledItem),
      monthly_total: monthlyTotal,
      pending_total: runnable.reduce((s, sp) => s + sp.amount, 0),
    });
  });
}

/* POST /api/scheduled — scheduled.py create_scheduled
 * PIN-authorized mandate; executed automatically later without a PIN. */
export async function POST(req: Request) {
  return runRoute(async () => {
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const user = getAuthUser(req);
    const db = getDb();

    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!verifyPin(pin, user.pin_salt, user.pin_hash)) {
      return err(403, "رمز الـ PIN غير صحيح");
    }

    const kind = body.kind;
    if (kind !== "bill" && kind !== "transfer") {
      return err(422, "نوع الجدولة يجب أن يكون bill أو transfer");
    }

    const amount = body.amount;
    if (
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount <= 1000 ||
      amount > 5_000_000
    ) {
      return err(422, "المبلغ يجب أن يكون أكثر من 1,000 د.ع وأقل من 5,000,000 د.ع");
    }

    const frequency = body.frequency === undefined ? "once" : body.frequency;
    if (frequency !== "once" && frequency !== "monthly") {
      return err(422, "التكرار يجب أن يكون once أو monthly");
    }

    /* parse the execution time (accept "Z", offsets and naive ISO) */
    let when = parseIsoDatetime(body.execute_at);
    if (when === null) {
      return err(422, "صيغة التاريخ غير صحيحة — استخدم ISO");
    }
    const now = Date.now();
    if (when < now + MIN_AHEAD_MS) {
      when = now + MIN_AHEAD_MS; // clamp near-instant scheduling
    }
    if (when > now + MAX_AHEAD_MS) {
      return err(422, "ما تصير جدولة أبعد من سنة");
    }

    let category = "";
    let billerName = "";
    let receiverName = "";
    let receiverCard = "";
    let billerCode = "";
    let subscriberNo = "";

    if (kind === "bill") {
      billerCode = typeof body.biller_code === "string" ? body.biller_code : "";
      const biller = Object.values(BILLERS)
        .flat()
        .find((b) => b.code === billerCode);
      if (!biller) {
        return err(404, "الجهة غير موجودة — تحقق من قائمة الجهات");
      }
      category =
        Object.entries(BILLERS).find(([cat, bs]) =>
          bs.some((b) => b.code === biller.code),
        )?.[0] ?? "";
      billerName = biller.name;
    } else {
      const card =
        typeof body.receiver_card === "string" ? digitsOnly(body.receiver_card) : "";
      if (card.length !== 16) {
        return err(422, "رقم بطاقة المستلم يجب أن يكون 16 رقمًا");
      }
      const receiver = db.users.find((u) => u.card_number === card);
      if (!receiver) {
        return err(404, "المستلم غير موجود — تحقق من رقم البطاقة");
      }
      if (receiver.id === user.id) {
        return err(405, "ما تصير تحوّل لنفسك 😅");
      }
      receiverCard = card;
      receiverName = receiver.full_name;
    }

    subscriberNo =
      typeof body.subscriber_no === "string" && body.subscriber_no !== ""
        ? body.subscriber_no
        : randomDigits(8);

    const sp: ScheduledRow = {
      id: ++db.seq.scheduled,
      user_id: user.id,
      kind,
      category,
      biller_code: billerCode,
      biller_name: billerName,
      subscriber_no: subscriberNo,
      receiver_card: receiverCard,
      receiver_name: receiverName,
      amount,
      frequency,
      next_run_at: when,
      last_run_at: null,
      status: "pending",
      created_at: now,
    };
    db.scheduled.push(sp);

    return jsonOk(
      {
        message: "تم إنشاء الجدولة — ستنفّذ تلقائيًا بوقتها",
        scheduled: scheduledItem(sp),
      },
      201,
    );
  });
}
