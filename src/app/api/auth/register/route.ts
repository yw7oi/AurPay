import { ApiErr, err, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { createToken, makePinSecret, newRef, randomDigits } from "@/lib/urpay-server/security";
import { isoNaive, userPublic } from "@/lib/urpay-server/serializers";
import { validateRegister } from "@/lib/urpay-server/validate";
import { WELCOME_BALANCE } from "@/lib/urpay-server/constants";
import type { UserRow } from "@/lib/urpay-server/types";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/** Starter bills for every new account (auth.py _starter_bills). */
const STARTER_BILLS: [string, string, string, number, string, number][] = [
  ["electricity", "MOE-BGD-R", "وزارة الكهرباء — بغداد الرصافة", 45_000, "الشهر الحالي", 6],
  ["internet", "NET-TARIN", "تارين للاتصالات Tarin", 30_000, "باقة 100 غيغا", 12],
  ["water", "MOW-BGD", "ماء بغداد — عامة الماء", 8_500, "الربع الأول", 3],
];

/* POST /api/auth/register — auth.py (201) */
export async function POST(req: Request) {
  return runRoute(async () => {
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const [input, validationError] = validateRegister(body);
    if (!input) return err(422, validationError);

    const db = getDb();

    if (db.users.some((u) => u.card_number === input.card_number)) {
      return err(409, "هذا الرقم مسجّل مسبقًا — جرّب تسجيل الدخول");
    }
    if (input.phone && db.users.some((u) => u.phone === input.phone)) {
      return err(409, "رقم الهاتف مستخدم من حساب آخر");
    }

    const now = Date.now();
    const { salt, hash } = makePinSecret(input.pin);
    const user: UserRow = {
      id: ++db.seq.users,
      first_name: input.first_name,
      father_name: input.father_name,
      family_name: input.family_name,
      full_name: `${input.first_name} ${input.father_name} ${input.family_name}`,
      gender: "male",
      age: input.age,
      city: input.city,
      district: "",
      phone: input.phone ?? `0770${randomDigits(7)}`,
      email: "",
      card_number: input.card_number,
      pin_salt: salt,
      pin_hash: hash,
      balance: WELCOME_BALANCE,
      avatar_hue: 152,
      is_demo: false,
      created_at: now,
      failed_attempts: 0,
      ban_count: 0,
      locked_until: null,
    };
    db.users.push(user);

    db.txns.push({
      id: ++db.seq.txns,
      reference: newRef(),
      user_id: user.id,
      type: "topup",
      direction: "in",
      amount: WELCOME_BALANCE,
      balance_after: WELCOME_BALANCE,
      title: "رصيد ترحيبي من أور پاي 🎉",
      subtitle: "هدية التسجيل — تجربة المنصة",
      category: "wallet",
      counterparty_id: null,
      bill_id: null,
      created_at: now,
    });

    for (const [cat, code, name, amount, period, dueDays] of STARTER_BILLS) {
      db.bills.push({
        id: ++db.seq.bills,
        user_id: user.id,
        category: cat,
        biller_code: code,
        biller_name: name,
        subscriber_no: randomDigits(8),
        amount,
        period,
        due_date: now + dueDays * DAY,
        status: "unpaid",
        issued_at: now,
        paid_at: null,
        receipt_ref: null,
      });
    }

    const { token, expMs } = createToken(user.id);
    return jsonOk(
      {
        access_token: token,
        expires_at: isoNaive(expMs),
        user: userPublic(user),
      },
      201,
    );
  });
}
