import { err, getAuthUser, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { newRef, verifyPin } from "@/lib/urpay-server/security";
import { fmtAr, isoNaive } from "@/lib/urpay-server/serializers";
import { notify } from "@/lib/urpay-server/notify";
import { validateTopupAmount } from "@/lib/urpay-server/validate";

export const dynamic = "force-dynamic";

/* POST /api/topup — wallet.py topup_wallet
 * Simulated cash-in at an AurPay agent kiosk — PIN-protected. */
export async function POST(req: Request) {
  return runRoute(async () => {
    const body = await parseJsonBody<{ amount?: unknown; pin?: unknown }>(req);
    const user = await getAuthUser(req);

    const [amount, validationError] = validateTopupAmount(body.amount);
    if (!amount) return err(422, validationError ?? "مبلغ غير صالح");

    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!verifyPin(pin, user.pin_salt, user.pin_hash)) {
      return err(403, "رمز الـ PIN غير صحيح");
    }

    const db = getDb();
    const now = Date.now();
    const ref = newRef();

    user.balance += amount;
    db.txns.push({
      id: ++db.seq.txns,
      reference: ref,
      user_id: user.id,
      type: "topup",
      direction: "in",
      amount,
      balance_after: user.balance,
      title: "تعبئة محفظة — وكيل أور پاي",
      subtitle: "كاش إن · إيداع نقدي",
      category: "wallet",
      counterparty_id: null,
      bill_id: null,
      created_at: now,
    });

    notify(db, user.id, {
      kind: "topup",
      title: "تمت تعبئة المحفظة",
      body: `انضاف ${fmtAr(amount)} د.ع لرصيدك · المرجع ${ref}`,
      amount,
      reference: ref,
    });

    return jsonOk({
      reference: ref,
      title: "تعبئة محفظة — وكيل أور پاي",
      subtitle: "كاش إن · إيداع نقدي",
      amount,
      balance_after: user.balance,
      created_at: isoNaive(now),
    });
  });
}
