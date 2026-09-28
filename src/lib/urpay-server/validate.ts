/* Request-body validation — port of the pydantic rules in app/schemas.py
 * (plus the inline models in the routers). Returns the first error as an
 * Arabic detail string, or null when valid. */

import { CITIES } from "./constants";

export const ARABIC_NAME_RE =
  /^[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\s'’-]+$/;

export function digitsOnly(v: string): string {
  return v.replace(/\D/g, "");
}

export type RegisterInput = {
  first_name: string;
  father_name: string;
  family_name: string;
  age: number;
  city: string;
  phone: string | null;
  card_number: string;
  pin: string;
};

/** RegisterRequest (schemas.py) — returns [value] or [null, arabicError]. */
export function validateRegister(body: unknown): [RegisterInput, null] | [null, string] {
  const b = (body ?? {}) as Record<string, unknown>;

  const names: [keyof RegisterInput, string][] = [
    ["first_name", "الاسم الأول"],
    ["father_name", "اسم الأب"],
    ["family_name", "اسم العائلة"],
  ];
  for (const [field, label] of names) {
    const raw = b[field as string];
    if (typeof raw !== "string" || raw.length < 2 || raw.length > 64) {
      return [null, `${label} لازم يكون بين 2 و 64 حرف`];
    }
    const v = raw.trim();
    if (!ARABIC_NAME_RE.test(v) || v.replace(/ /g, "").length < 2) {
      return [null, "الاسم يجب أن يحتوي حروفًا عربية فقط"];
    }
  }

  const age = b.age;
  if (typeof age !== "number" || !Number.isInteger(age) || age < 18 || age > 100) {
    return [null, "العمر يجب أن يكون بين 18 و 100 سنة"];
  }

  const city = b.city;
  if (typeof city !== "string" || !CITIES.includes(city)) {
    return [null, "اختر محافظة عراقية صحيحة"];
  }

  let phone: string | null = null;
  if (b.phone !== undefined && b.phone !== null && b.phone !== "") {
    if (typeof b.phone !== "string" || b.phone.length < 11 || b.phone.length > 14) {
      return [null, "رقم الهاتف غير صالح — 11 إلى 14 رقمًا"];
    }
    phone = b.phone;
  }

  const cardRaw = b.card_number;
  if (typeof cardRaw !== "string") return [null, "رقم البطاقة يجب أن يكون 16 رقمًا"];
  const card = digitsOnly(cardRaw);
  if (!/^\d{16}$/.test(card)) {
    return [null, "رقم البطاقة يجب أن يكون 16 رقمًا"];
  }

  const pin = b.pin;
  if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
    return [null, "الرمز السري PIN يجب أن يكون 6 أرقام"];
  }

  return [
    {
      first_name: (b.first_name as string).trim(),
      father_name: (b.father_name as string).trim(),
      family_name: (b.family_name as string).trim(),
      age,
      city,
      phone,
      card_number: card,
      pin,
    },
    null,
  ];
}

/** LoginRequest (schemas.py) — card must be 16 digits after cleaning. */
export function validateLogin(body: unknown): [string, string] | [null, string] {
  const b = (body ?? {}) as Record<string, unknown>;
  const cardRaw = b.card_number;
  if (typeof cardRaw !== "string") return [null, "رقم البطاقة يجب أن يكون 16 رقمًا"];
  const card = digitsOnly(cardRaw);
  if (!/^\d{16}$/.test(card)) {
    return [null, "رقم البطاقة يجب أن يكون 16 رقمًا"];
  }
  const pin = typeof b.pin === "string" ? b.pin : "";
  return [card, pin];
}

/** TransferRequestIn (schemas.py). */
export function validateTransferRequest(body: unknown):
  [{ receiverCard: string | null; receiverId: number | null; amount: number }, null] |
  [null, string] {
  const b = (body ?? {}) as Record<string, unknown>;
  let receiverCard: string | null = null;
  if (b.receiver_card !== undefined && b.receiver_card !== null && b.receiver_card !== "") {
    if (typeof b.receiver_card !== "string") {
      return [null, "رقم بطاقة المستلم يجب أن يكون 16 رقمًا"];
    }
    receiverCard = digitsOnly(b.receiver_card);
    if (receiverCard.length !== 16) {
      return [null, "رقم بطاقة المستلم يجب أن يكون 16 رقمًا"];
    }
  }
  let receiverId: number | null = null;
  if (b.receiver_id !== undefined && b.receiver_id !== null) {
    if (typeof b.receiver_id !== "number" || !Number.isInteger(b.receiver_id)) {
      return [null, "طلب غير صالح"];
    }
    receiverId = b.receiver_id;
  }
  const amount = b.amount;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 || amount > 100_000_000) {
    return [null, "مبلغ التحويل غير صالح"];
  }
  return [{ receiverCard, receiverId, amount }, null];
}

/** TopUpRequest — 1000 < amount ≤ 5,000,000. */
export function validateTopupAmount(amount: unknown): [number, null] | [null, string] {
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 1000 || amount > 5_000_000) {
    return [null, "المبلغ يجب أن يكون أكثر من 1,000 د.ع وأقل من 5,000,000 د.ع"];
  }
  return [amount, null];
}

/** SimulateBillRequest. */
export function validateSimulateBill(body: unknown):
  [{ category: string; biller_code: string; subscriber_no: string; amount: number }, null] |
  [null, string] {
  const b = (body ?? {}) as Record<string, unknown>;
  const category = b.category;
  const billerCode = b.biller_code;
  const subscriberNo = b.subscriber_no;
  const amount = b.amount;
  if (typeof category !== "string" || typeof billerCode !== "string") {
    return [null, "طلب غير صالح"];
  }
  if (typeof subscriberNo !== "string" || subscriberNo.length < 3 || subscriberNo.length > 24) {
    return [null, "رقم المشترك يجب أن يكون بين 3 و 24 حرفًا/رقمًا"];
  }
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 1000 || amount > 10_000_000) {
    return [null, "المبلغ يجب أن يكون أكثر من 1,000 د.ع وأقل من 10,000,000 د.ع"];
  }
  return [{ category, biller_code: billerCode, subscriber_no: subscriberNo, amount }, null];
}

/**
 * Parse an ISO datetime string to UTC epoch ms — port of
 * `datetime.fromisoformat(body.execute_at.replace("Z", "+00:00"))` followed
 * by the naive-UTC assumption used everywhere in the Python service.
 * Returns null on invalid input.
 */
export function parseIsoDatetime(v: unknown): number | null {
  if (typeof v !== "string" || v.trim() === "") return null;
  let s = v.trim();
  // date-only form -> UTC midnight (Python fromisoformat accepts it)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T00:00:00Z`);
  // normalize "+0300" (no colon) offsets so Date.parse understands them
  s = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  // naive datetime -> treat as UTC (Python compares it against utcnow())
  const hasOffset = /[Zz]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s);
  if (!hasOffset) {
    s += "Z";
  } else if (/z$/.test(s)) {
    s = s.slice(0, -1) + "Z";
  }
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}
