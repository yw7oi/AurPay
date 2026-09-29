import { err, getAuthUser, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { newRef, verifyPin } from "@/lib/urpay-server/security";
import { fmtAr, isoNaive } from "@/lib/urpay-server/serializers";
import { notify } from "@/lib/urpay-server/notify";
import { checkBudgetCrossing } from "@/lib/urpay-server/budget";

export const dynamic = "force-dynamic";

/* POST /api/bills/pay — wallet.py pay_bill
 * Validate every condition BEFORE mutating (atomic in single-threaded JS). */
export async function POST(req: Request) {
  return runRoute(async () => {
    const body = await parseJsonBody<{ bill_id?: unknown; pin?: unknown }>(req);
    const user = await getAuthUser(req);

    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!verifyPin(pin, user.pin_salt, user.pin_hash)) {
      return err(403, "رمز الـ PIN غير صحيح");
    }
    const billId = body.bill_id;
    if (typeof billId !== "number" || !Number.isInteger(billId)) {
      return err(404, "الفاتورة غير موجودة");
    }

    const db = getDb();
    const bill = db.bills.find((b) => b.id === billId);
    if (!bill || bill.user_id !== user.id) {
      return err(404, "الفاتورة غير موجودة");
    }
    if (bill.status === "paid") {
      return err(409, "هذه الفاتورة مدفوعة مسبقًا");
    }
    if (user.balance < bill.amount) {
      return err(406, "الرصيد غير كافٍ — عبي محفظتك أولًا");
    }

    const now = Date.now();
    const ref = newRef();

    user.balance -= bill.amount;
    bill.status = "paid";
    bill.paid_at = now;
    bill.receipt_ref = ref;

    db.txns.push({
      id: ++db.seq.txns,
      reference: ref,
      user_id: user.id,
      type: "bill_payment",
      direction: "out",
      amount: bill.amount,
      balance_after: user.balance,
      title: `فاتورة ${bill.biller_name}`,
      subtitle: bill.period || "",
      category: bill.category,
      counterparty_id: null,
      bill_id: bill.id,
      created_at: now,
    });

    notify(db, user.id, {
      kind: "payment",
      title: `تم دفع فاتورة ${bill.biller_name}`,
      body: `المرجع ${ref} · رصيدك بعد الدفع ${fmtAr(user.balance)} د.ع`,
      amount: bill.amount,
      reference: ref,
    });

    // budget guard — fires a notification if THIS payment crossed the limit
    checkBudgetCrossing(db, user, bill.category, bill.amount);

    return jsonOk({
      reference: ref,
      title: `فاتورة ${bill.biller_name}`,
      subtitle: bill.period || "",
      amount: bill.amount,
      balance_after: user.balance,
      created_at: isoNaive(now),
    });
  });
}
