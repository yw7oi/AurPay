import { err, getAuthUser, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { refreshNow } from "@/lib/urpay-server/persist";
import { newRef, verifyPin } from "@/lib/urpay-server/security";
import { fmtAr, isoNaive } from "@/lib/urpay-server/serializers";
import { notify } from "@/lib/urpay-server/notify";
import { checkBudgetCrossing } from "@/lib/urpay-server/budget";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/* POST /api/transfer/confirm/[id] — wallet.py confirm_transfer */
export async function POST(req: Request, ctx: Ctx) {
  return runRoute(async () => {
    const body = await parseJsonBody<{ pin?: unknown }>(req);
    const user = await getAuthUser(req);

    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!verifyPin(pin, user.pin_salt, user.pin_hash)) {
      return err(403, "رمز الـ PIN غير صحيح");
    }

    const { id } = await ctx.params;
    const requestId = Number(id);
    if (!Number.isInteger(requestId)) {
      return err(404, "طلب التحويل غير موجود أو منتهي");
    }

    const db = getDb();
    let request = db.transferRequests.find((r) => r.id === requestId);
    if (!request || request.sender_id !== user.id || request.status !== "pending") {
      /* multi-instance guard: the request may live on another instance —
       * pull the shared state before answering 404 */
      await refreshNow();
      request = db.transferRequests.find(
        (r) => r.id === requestId && r.sender_id === user.id && r.status === "pending",
      );
      if (!request) {
        return err(404, "طلب التحويل غير موجود أو منتهي");
      }
    }

    const receiver = db.users.find((u) => u.id === request.receiver_id);
    if (!receiver) {
      return err(404, "المستلم غير موجود");
    }
    if (user.balance < request.amount) {
      return err(406, "الرصيد غير كافٍ");
    }

    const now = Date.now();
    const ref = newRef();
    user.balance -= request.amount;
    receiver.balance += request.amount;
    request.status = "confirmed";
    request.confirmed_at = now;

    db.txns.push({
      id: ++db.seq.txns,
      reference: ref,
      user_id: user.id,
      type: "transfer_out",
      direction: "out",
      amount: request.amount,
      balance_after: user.balance,
      title: `حوالة إلى ${receiver.full_name}`,
      subtitle: `بطاقة •••• ${receiver.card_number.slice(-4)}`,
      category: "transfer",
      counterparty_id: receiver.id,
      bill_id: null,
      created_at: now,
    });
    db.txns.push({
      id: ++db.seq.txns,
      reference: ref,
      user_id: receiver.id,
      type: "transfer_in",
      direction: "in",
      amount: request.amount,
      balance_after: receiver.balance,
      title: `حوالة من ${user.full_name}`,
      subtitle: `بطاقة •••• ${user.card_number.slice(-4)}`,
      category: "transfer",
      counterparty_id: user.id,
      bill_id: null,
      created_at: now,
    });

    notify(db, receiver.id, {
      kind: "transfer_in",
      title: `وصلتك حوالة من ${user.full_name}`,
      body: `المبلغ انضاف لرصيدك · المرجع ${ref}`,
      amount: request.amount,
      reference: ref,
    });
    notify(db, user.id, {
      kind: "transfer_out",
      title: `تم تحويل ${fmtAr(request.amount)} د.ع إلى ${receiver.full_name}`,
      body: `المرجع ${ref} · رصيدك بعد التحويل ${fmtAr(user.balance)} د.ع`,
      amount: request.amount,
      reference: ref,
    });
    // budget guard for the transfer category
    checkBudgetCrossing(db, user, "transfer", request.amount);

    return jsonOk({
      message: "تم التحويل بنجاح ✅",
      receipt: {
        reference: ref,
        title: `حوالة إلى ${receiver.full_name}`,
        subtitle: `بطاقة •••• ${receiver.card_number.slice(-4)}`,
        amount: request.amount,
        balance_after: user.balance,
        created_at: isoNaive(now),
      },
    });
  });
}
