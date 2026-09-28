import { err, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { createToken, verifyPin } from "@/lib/urpay-server/security";
import { isoNaive, userPublic } from "@/lib/urpay-server/serializers";
import { validateLogin } from "@/lib/urpay-server/validate";
import type { UserRow } from "@/lib/urpay-server/types";

export const dynamic = "force-dynamic";

/* wrong-PIN lockout policy (auth.py) */
const MAX_PIN_ATTEMPTS = 5; // "باقي 4 محاولات" after the first miss → 5 total
const BASE_BAN_MINUTES = 3; // first lockout length
const MAX_BAN_MINUTES = 60; // cap for the escalating lockout

/* POST /api/auth/login — auth.py */
export async function POST(req: Request) {
  return runRoute(async () => {
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const [card, validationError] = validateLogin(body);
    if (!card) return err(422, validationError);

    const db = getDb();
    const user: UserRow | undefined = db.users.find((u) => u.card_number === card);
    const now = Date.now();

    if (user && user.locked_until !== null && user.locked_until > now) {
      const remaining = user.locked_until - now;
      const minutes = Math.max(1, Math.floor(remaining / 60_000));
      return err(
        423,
        `الحساب موقوف مؤقتًا بعد محاولات خاطئة — جرب بعد ${minutes} دقيقة`,
      );
    }

    if (!user) {
      return err(401, "رقم البطاقة أو رمز الـ PIN غير صحيح");
    }

    const pin = typeof body.pin === "string" ? body.pin : "";
    if (!verifyPin(pin, user.pin_salt, user.pin_hash)) {
      user.failed_attempts = (user.failed_attempts ?? 0) + 1;
      if (user.failed_attempts >= MAX_PIN_ATTEMPTS) {
        // lock the account — ban length doubles with each consecutive
        // lockout (3, 6, 12 … minutes) and caps at MAX_BAN_MINUTES
        const banMinutes = Math.min(
          BASE_BAN_MINUTES * 2 ** (user.ban_count ?? 0),
          MAX_BAN_MINUTES,
        );
        user.locked_until = now + banMinutes * 60_000;
        user.ban_count = (user.ban_count ?? 0) + 1;
        user.failed_attempts = 0;
        return err(
          423,
          `انتهت المحاولات — الحساب موقوف لمدة ${banMinutes} دقيقة`,
        );
      }
      const left = MAX_PIN_ATTEMPTS - user.failed_attempts;
      return err(
        401,
        `رقم البطاقة أو رمز الـ PIN غير صحيح — باقي ${left} ` +
          `${left === 1 ? "محاولة" : "محاولات"}`,
      );
    }

    // success — clear the lockout state
    if (user.failed_attempts || user.locked_until || user.ban_count) {
      user.failed_attempts = 0;
      user.locked_until = null;
      user.ban_count = 0;
    }

    const { token, expMs } = createToken(user.id);
    return jsonOk({
      access_token: token,
      expires_at: isoNaive(expMs),
      user: userPublic(user),
    });
  });
}
