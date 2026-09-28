import { err, jsonOk, parseJsonBody, runRoute, getAuthUser } from "@/lib/urpay-server/http";
import { makePinSecret, verifyPin } from "@/lib/urpay-server/security";

export const dynamic = "force-dynamic";

/* POST /api/auth/change-pin — auth.py */
export async function POST(req: Request) {
  return runRoute(async () => {
    const body = await parseJsonBody<{ current_pin?: unknown; new_pin?: unknown }>(req);
    const user = getAuthUser(req);

    const currentPin = typeof body.current_pin === "string" ? body.current_pin : "";
    const newPin = typeof body.new_pin === "string" ? body.new_pin : "";

    if (!verifyPin(currentPin, user.pin_salt, user.pin_hash)) {
      return err(403, "رمز الـ PIN الحالي غير صحيح");
    }
    if (!/^\d{6}$/.test(newPin)) {
      return err(400, "الرمز الجديد لازم يكون 6 أرقام");
    }
    if (newPin === currentPin) {
      return err(400, "الرمز الجديد نفس القديم — اختر رمزًا مختلفًا");
    }

    const { salt, hash } = makePinSecret(newPin);
    user.pin_salt = salt;
    user.pin_hash = hash;
    return jsonOk({ message: "تم تحديث رمز الـ PIN بنجاح" });
  });
}
