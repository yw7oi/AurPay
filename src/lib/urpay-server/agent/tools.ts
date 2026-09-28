/* Bill Pay Agent — tool implementations against the in-memory store.
 * 1:1 port of mini-services/urpay-backend/app/agent/tools.py.
 *
 * Every tool takes (db, user, …) and returns a plain result dict — it NEVER
 * throws — so the LLM loop (and the deterministic local engine) can feed the
 * result straight back into the conversation. Result keys are snake_case,
 * exactly like the Python originals. */

import type { Db, SavingsGoalRow, UserRow } from "../types";
import { BILLERS, CATEGORY_AR, BUDGETABLE_CATEGORIES } from "../constants";
import type { BillerRow } from "../constants";
import { verifyPin, newRef } from "../security";
import { notify } from "../notify";
import { checkBudgetCrossing } from "../budget";
import { runDueScheduled, MIN_AHEAD_MS, MAX_AHEAD_MS } from "../scheduler";
import { fmtAr, isoNaive, isoDate, monthStart, scheduledLabel } from "../serializers";
import { SequenceMatcher } from "./sequence";

/* ------------------------------------------------------------------ utils --- */

/** Python round() — banker's rounding (half to even), used for scores. */
export function pyRound(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** digits;
  let scaled = x * f;
  const near = Math.round(scaled);
  if (Math.abs(scaled - near) < 1e-9) scaled = near; // kill float noise
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  let rounded: number;
  if (diff > 0.5) rounded = floor + 1;
  else if (diff < 0.5) rounded = floor;
  else rounded = floor % 2 === 0 ? floor : floor + 1; // exact .5 → even
  return rounded / f;
}

/** Python f"{n:,}" — plain English thousands separators. */
function en(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** tools.py fmt_iqd — thousands as spaces + currency suffix. */
export function fmtIqd(amount: number): string {
  return en(amount).replace(/,/g, " ") + " د.ع";
}

export type BillDict = {
  id: number;
  category: string;
  biller: string;
  subscriber_no: string;
  amount: number;
  period: string;
  due_date: string;
  status: string;
  overdue: boolean;
};

function billToDict(b: Db["bills"][number]): BillDict {
  return {
    id: b.id,
    category: b.category,
    biller: b.biller_name,
    subscriber_no: b.subscriber_no,
    amount: b.amount,
    period: b.period,
    due_date: isoNaive(b.due_date),
    status: b.status,
    overdue: b.status === "unpaid" && b.due_date < Date.now(),
  };
}

export type ReceiptDict = {
  reference: string;
  title: string;
  subtitle?: string;
  amount: number;
  balance_after: number;
  created_at: string;
};

/* ------------------------------------------------------------- balance/bills --- */

export function getBalance(db: Db, user: UserRow) {
  return { balance: user.balance, formatted: fmtIqd(user.balance) };
}

export type ListBillsResult = {
  count: number;
  unpaid_total: number;
  unpaid_total_formatted: string;
  bills: BillDict[];
};

export function listBills(db: Db, user: UserRow, status = "unpaid"): ListBillsResult {
  let bills = db.bills.filter((b) => b.user_id === user.id);
  if (status === "unpaid" || status === "paid") {
    bills = bills.filter((b) => b.status === status);
  }
  bills = [...bills].sort((a, b) => a.due_date - b.due_date);
  const unpaidTotal = bills
    .filter((b) => b.status === "unpaid")
    .reduce((s, b) => s + b.amount, 0);
  return {
    count: bills.length,
    unpaid_total: unpaidTotal,
    unpaid_total_formatted: fmtIqd(unpaidTotal),
    bills: bills.slice(0, 15).map(billToDict),
  };
}

/** pay_bill — full port incl. the wrong-bill guard (Arabic keyword aliases). */
export function payBill(
  db: Db,
  user: UserRow,
  billId: number,
  pin: string,
  hint = "",
): { ok: boolean; error?: string; detail?: string; receipt_ref?: string | null; balance?: number; amount?: number; receipt?: ReceiptDict; balance_formatted?: string } {
  if (!verifyPin(pin ?? "", user.pin_salt, user.pin_hash)) {
    return { ok: false, error: "pin" };
  }

  const bill = db.bills.find((b) => b.id === billId);
  if (bill == null || bill.user_id !== user.id) {
    return { ok: false, error: "not_found" };
  }

  // guard against the agent paying the WRONG bill: if the caller passed a
  // category/biller hint, it must match the target bill.
  if (hint) {
    const h = hint.trim().toLowerCase();
    const target = `${bill.category} ${bill.biller_name} ${bill.biller_code}`.toLowerCase();
    const aliases: Record<string, string> = {
      "كهرب": "electricity", "power": "electricity", "electricity": "electricity",
      "ماء": "water", "مياه": "water", "water": "water",
      "نت": "internet", "internet": "internet", "انترنت": "internet",
      "شحن": "mobile", "mobile": "mobile", "زين": "mobile", "باقة": "mobile",
      "جامع": "education", "education": "education", "رسوم": "education", "مدرس": "education",
      "مرور": "traffic", "مخالف": "traffic", "traffic": "traffic", "غرام": "traffic",
    };
    let wanted: string | null = null;
    for (const [k, cat] of Object.entries(aliases)) {
      if (h.includes(k)) {
        wanted = cat;
        break;
      }
    }
    if (wanted && wanted !== bill.category) {
      return {
        ok: false,
        error: "wrong_bill",
        detail:
          `رقم ${billId} هو فاتورة ${bill.biller_name} وليس المطابقة لطلب المستخدم ` +
          "— أعد التحقق من رقم الفاتورة الصحيح من list_bills",
      };
    }
    if (wanted === null && !target.includes(h)) {
      return {
        ok: false,
        error: "wrong_bill",
        detail: `اسم الجهة غير مطابق — فاتورة رقم ${billId} هي ${bill.biller_name}`,
      };
    }
  }

  if (bill.status === "paid") {
    return { ok: false, error: "already_paid", receipt_ref: bill.receipt_ref ?? null };
  }

  if (user.balance < bill.amount) {
    return { ok: false, error: "insufficient", balance: user.balance, amount: bill.amount };
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
  checkBudgetCrossing(db, user, bill.category, bill.amount);

  return {
    ok: true,
    receipt: {
      reference: ref,
      title: `فاتورة ${bill.biller_name}`,
      subtitle: bill.period || "",
      amount: bill.amount,
      balance_after: user.balance,
      created_at: isoNaive(now),
    },
    balance_formatted: fmtIqd(user.balance),
  };
}

/* ---------------------------------------------------------------------------
 * Smart people search — forgiving Arabic/Latin name matching.
 * Understands: partial names, first+family without the middle name, the
 * definite article «ال», the attached لام («لزينب»), common misspellings,
 * English transliteration ("zainab mousawi"), and city hints («من النجف»).
 * --------------------------------------------------------------------------- */

const AR_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;
const LATIN_WORD_RE = /^[a-z]+$/;

// rough Arabic→Latin letter map — enough for transliteration search
const AR_TO_LATIN: Record<string, string> = {
  "ا": "a", "ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "h", "خ": "kh",
  "د": "d", "ذ": "dh", "ر": "r", "ز": "z", "س": "s", "ش": "sh", "ص": "s",
  "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh", "ف": "f", "ق": "q",
  "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "w", "ي": "y",
  "پ": "p", "چ": "ch", "ژ": "zh", "ک": "k", "ی": "y", "گ": "g", "ڤ": "v",
};

// filler words that carry no identity (علي/على deliberately NOT here —
// علي is one of the most common first names)
const NAME_STOPWORDS = new Set([
  "الى", "اللي", "اللى", "لي", "لها", "له", "منو", "مين", "من", "هو", "هي",
  "هذا", "هذي", "هذيل", "ذيج", "دي", "شخص", "الشخص", "الشخصية", "المستلم",
  "المستلمه", "المتلقي", "المحوله", "حواله", "حوالة", "تحويل", "حول", "حو",
  "حولله", "دفع", "المبلغ", "مبلغ", "دينار", "دع", "الف", "الاف", "تو",
  "سيند", "اسم", "ابحث", "دور", "بحث", "رقم", "بطاقه", "بطاقة", "كارت",
  "عنده", "عندها", "بيها", "به", "في", "و", "بس", "فقط", "المحفظه", "محفظه",
  "شسمه", "شسمها", "وين", "فين", "بصورة", "رمز", "pin",
  "to", "for", "send", "transfer", "user", "name", "card", "number",
  "who", "find", "search", "the", "of", "is",
]);

/** Normalize a name/query for forgiving comparison (_norm_name). */
export function normName(text: string): string {
  let t = (text ?? "").toLowerCase().trim();
  t = t.replace(AR_DIACRITICS, "");
  for (const ch of ["أ", "إ", "آ", "ٱ"]) t = t.split(ch).join("ا");
  t = t
    .replace(/ى/g, "ي")
    .replace(/ئ/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ة/g, "ه");
  // Python [^\w\s] is Unicode-aware: keep letters/digits/underscore
  t = t.replace(/[^\p{L}\p{N}_\s]/gu, " ");
  return t.replace(/\s+/g, " ").trim();
}

/** Generous variants of a token to fight Arabic orthography. */
function tokenVariants(tok: string): string[] {
  const out = [tok];
  if (tok.startsWith("ال") && tok.length > 3) out.push(tok.slice(2)); // «الموسوي» → «موسوي»
  if (tok.startsWith("ل") && tok.length > 3) out.push(tok.slice(1)); // attached لام: «لزينب» → «زينب»
  if (tok.startsWith("بال") && tok.length > 4) out.push(tok.slice(3));
  return out;
}

/** Fold common Latin digraphs so transliterations line up. */
function latinNorm(s: string): string {
  return s
    .replace(/ou/g, "w")
    .replace(/oo/g, "w")
    .replace(/ee/g, "i")
    .replace(/y/g, "i")
    .replace(/ai/g, "e");
}

function stripVowels(s: string): string {
  return s.replace(/[aeiou]/g, "");
}

/** (full, skeleton) Latin renderings of an Arabic token. */
function latinForms(tok: string): [string, string][] {
  let lat = "";
  for (const ch of tok) lat += AR_TO_LATIN[ch] ?? "";
  if (!lat) return [];
  const full = latinNorm(lat);
  return [[full, stripVowels(full)]];
}

/** Similarity of two normalized tokens in [0, 1]. */
function tokenScore(a: string, b: string): number {
  if (!a || !b) return 0.0;
  if (a === b) return 1.0;
  if (a.length >= 3 && b.length >= 3) {
    if (b.startsWith(a) || a.startsWith(b)) return 0.9;
    if (b.includes(a) || a.includes(b)) return 0.82;
  }
  const ratio = new SequenceMatcher(a, b).ratio();
  // fuzzy (edit-distance) matches are discounted ×0.85: a real typo still
  // scores high, but genuinely different names (موسى vs الموسوي) rank
  // clearly below an exact family-name hit
  return ratio >= 0.72 ? ratio * 0.85 : 0.0;
}

/** Best score between a query token and a name token (Arabic or Latin). */
function pairScore(qt: string, nt: string): number {
  let best = tokenScore(qt, nt);
  if (best >= 0.9) return best;
  if (LATIN_WORD_RE.test(qt)) {
    // Latin query ↔ Arabic name
    const qn = latinNorm(qt);
    const qs = stripVowels(qn);
    for (const [full, skel] of latinForms(nt)) {
      best = Math.max(best, tokenScore(qn, full));
      if (qs === skel) {
        best = Math.max(best, 1.0); // exact consonant skeleton
      } else if (
        qs.length >= 3 &&
        skel.length >= 3 &&
        (skel.startsWith(qs) || qs.startsWith(skel))
      ) {
        best = Math.max(best, 0.75); // skeleton prefix — weak signal
      }
    }
  }
  return best;
}

/** Score one candidate: [score, matched name tokens, has_strong_match]. */
function scoreUser(
  qTokens: string[],
  u: UserRow,
): [number, string[], boolean] {
  const nameTokens: string[] = [];
  for (const part of [u.full_name, u.first_name, u.father_name, u.family_name]) {
    for (const t of normName(part ?? "").split(" ")) {
      if (t && !nameTokens.includes(t)) nameTokens.push(t);
    }
  }
  const cityTokens = normName(u.city ?? "")
    .split(" ")
    .filter((c) => c.length >= 3);

  let total = 0.0;
  const matched: string[] = [];
  let strong = false;
  let cityHit = false;
  for (const qt of qTokens) {
    const qv = tokenVariants(qt);
    let best = 0.0;
    let hitTok: string | null = null;
    for (const nt of nameTokens) {
      for (const a of qv) {
        for (const b of tokenVariants(nt)) {
          const s = pairScore(a, b);
          if (s > best) {
            best = s;
            hitTok = nt;
          }
        }
      }
    }
    if (best >= 0.72) {
      total += best;
      strong = strong || best >= 0.9;
      if (hitTok !== null && !matched.includes(hitTok)) matched.push(hitTok);
    } else if (qv.some((a) => cityTokens.some((c) => tokenScore(a, c) >= 0.8))) {
      cityHit = true;
      total += 0.5; // city hint — disambiguates only
    }
  }
  if (qTokens.length === 0) return [0.0, [], false];
  let score = total / qTokens.length;
  if (cityHit) score = Math.min(1.0, score + 0.06);
  return [score, matched, strong];
}

export type SearchHit = {
  id: number;
  full_name: string;
  city: string;
  card_masked: string;
  card_number: string;
  score: number;
  matched_on: string[];
};

export type SearchResult = {
  count: number;
  note?: string;
  results: SearchHit[];
};

/** Smart recipient search — ranked fuzzy matches (name + city + card). */
export function searchUsers(db: Db, user: UserRow, query: string): SearchResult {
  const q = (query ?? "").trim();
  if (q.length < 2) return { count: 0, results: [] };

  const hits = new Map<
    number,
    { u: UserRow; score: number; matched: string[]; strong: boolean }
  >();

  // 1) card digits — a pure-digit query (any length ≥ 4) or long runs in text
  const compact = q.replace(/[\s-]/g, "");
  const runs = /^\d{4,19}$/.test(compact)
    ? [compact]
    : (q.match(/\d{8,}/g) ?? []);
  for (const run of runs) {
    const rows = db.users
      .filter((u) => u.id !== user.id && u.card_number.includes(run))
      .slice(0, 4);
    for (const u of rows) {
      hits.set(u.id, { u, score: 1.0, matched: ["بطاقة"], strong: true });
    }
  }

  // 2) smart name matching over the candidate pool
  const qTokens = normName(q)
    .split(" ")
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !NAME_STOPWORDS.has(t));
  if (qTokens.length > 0) {
    for (const u of db.users.filter((x) => x.id !== user.id).slice(0, 2000)) {
      const [score, matched, strong] = scoreUser(qTokens, u);
      if (score >= 0.55 && strong && !hits.has(u.id)) {
        hits.set(u.id, { u, score, matched, strong });
      }
    }
  }

  const ranked = [...hits.values()].sort(
    (a, b) => b.score - a.score || b.matched.length - a.matched.length || a.u.id - b.u.id,
  );
  const top = ranked.slice(0, 8);

  let note = "";
  if (top.length > 0) {
    const bestSc = top[0].score;
    const runner = top.length > 1 ? top[1].score : 0.0;
    if (bestSc >= 0.9 && bestSc - runner >= 0.1) {
      note =
        "النتيجة الأولى هي المقصودة بوضوح (أعلى تطابق بفارق ملموس) — " +
        "اعتمدها مباشرة وأكمل طلب المستخدم دون سؤال.";
    } else if (top.length === 1) {
      note = "نتيجة وحيدة — اعتمدها مباشرة.";
    }
  }

  return {
    count: top.length,
    note,
    results: top.map((h) => ({
      id: h.u.id,
      full_name: h.u.full_name,
      city: h.u.city,
      card_masked: `•••• ${h.u.card_number.slice(-4)}`,
      card_number: h.u.card_number,
      score: pyRound(h.score, 2),
      matched_on: h.matched.slice(0, 4),
    })),
  };
}

/* -------------------------------------------------------------- transfer --- */

export function transferMoney(
  db: Db,
  user: UserRow,
  receiverCard: string,
  amount: number,
  pin: string,
): { ok: boolean; error?: string; balance?: number; amount?: number; receipt?: ReceiptDict; balance_formatted?: string } {
  if (!verifyPin(pin ?? "", user.pin_salt, user.pin_hash)) {
    return { ok: false, error: "pin" };
  }

  const card = (receiverCard ?? "").replace(/\D/g, "");
  if (card.length !== 16) return { ok: false, error: "bad_card" };

  const receiver = db.users.find((u) => u.card_number === card);
  if (receiver == null) return { ok: false, error: "not_found" };
  if (receiver.id === user.id) return { ok: false, error: "self" };

  const amt = Math.trunc(amount);
  if (amt <= 0) return { ok: false, error: "bad_amount" };
  if (user.balance < amt) {
    return { ok: false, error: "insufficient", balance: user.balance, amount: amt };
  }

  const now = Date.now();
  const ref = newRef();

  user.balance -= amt;
  db.txns.push({
    id: ++db.seq.txns,
    reference: ref,
    user_id: user.id,
    type: "transfer_out",
    direction: "out",
    amount: amt,
    balance_after: user.balance,
    title: `حوالة إلى ${receiver.full_name}`,
    subtitle: `بطاقة •••• ${receiver.card_number.slice(-4)}`,
    category: "transfer",
    counterparty_id: receiver.id,
    bill_id: null,
    created_at: now,
  });

  receiver.balance += amt;
  db.txns.push({
    id: ++db.seq.txns,
    reference: ref,
    user_id: receiver.id,
    type: "transfer_in",
    direction: "in",
    amount: amt,
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
    amount: amt,
    reference: ref,
  });
  notify(db, user.id, {
    kind: "transfer_out",
    title: `تم تحويل ${fmtAr(amt)} د.ع إلى ${receiver.full_name}`,
    body: `المرجع ${ref} · رصيدك بعد التحويل ${fmtAr(user.balance)} د.ع`,
    amount: amt,
    reference: ref,
  });
  checkBudgetCrossing(db, user, "transfer", amt);

  return {
    ok: true,
    receipt: {
      reference: ref,
      title: `حوالة إلى ${receiver.full_name}`,
      subtitle: `بطاقة •••• ${receiver.card_number.slice(-4)}`,
      amount: amt,
      balance_after: user.balance,
      created_at: isoNaive(now),
    },
    balance_formatted: fmtIqd(user.balance),
  };
}

/* ---------------------------------------------------------------- wallet --- */

/** Simulated cash-in at an AurPay kiosk — PIN-protected. */
export function topupWallet(
  db: Db,
  user: UserRow,
  amount: number,
  pin: string,
): { ok: boolean; error?: string; detail?: string; receipt?: ReceiptDict; balance_formatted?: string } {
  if (!verifyPin(pin ?? "", user.pin_salt, user.pin_hash)) {
    return { ok: false, error: "pin" };
  }
  const amt = Math.trunc(amount);
  if (amt <= 1000 || amt > 5_000_000) {
    return {
      ok: false,
      error: "bad_amount",
      detail: "المبلغ لازم يكون بين 1,000 و 5,000,000 د.ع",
    };
  }

  const now = Date.now();
  const ref = newRef();
  user.balance += amt;
  db.txns.push({
    id: ++db.seq.txns,
    reference: ref,
    user_id: user.id,
    type: "topup",
    direction: "in",
    amount: amt,
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
    body: `انضاف ${fmtAr(amt)} د.ع لرصيدك · المرجع ${ref}`,
    amount: amt,
    reference: ref,
  });

  return {
    ok: true,
    receipt: {
      reference: ref,
      title: "تعبئة محفظة — وكيل أور پاي",
      subtitle: "كاش إن · إيداع نقدي",
      amount: amt,
      balance_after: user.balance,
      created_at: isoNaive(now),
    },
    balance_formatted: fmtIqd(user.balance),
  };
}

export function recentTransactions(db: Db, user: UserRow, limit = 5) {
  const lim = Math.max(1, Math.min(Math.trunc(limit || 5), 20));
  const rows = db.txns
    .filter((t) => t.user_id === user.id)
    .sort((a, b) => b.created_at - a.created_at || b.id - a.id)
    .slice(0, lim);
  return {
    count: rows.length,
    transactions: rows.map((t) => ({
      reference: t.reference,
      type: t.type,
      direction: t.direction,
      title: t.title,
      amount: t.amount,
      created_at: isoNaive(t.created_at),
    })),
  };
}

/* ------------------------------------------------------------- spending --- */

export type SpendingCategory = {
  category: string;
  name_ar: string;
  spent: number;
  monthly_limit?: number;
  pct?: number;
  status?: string;
};

/** Month-to-date spend by category + budget status. */
export function getSpending(db: Db, user: UserRow) {
  const start = monthStart(Date.now());
  const spentMap = new Map<string, number>();
  for (const t of db.txns) {
    if (
      t.user_id === user.id &&
      t.direction === "out" &&
      t.category !== "savings" &&
      t.created_at >= start
    ) {
      spentMap.set(t.category, (spentMap.get(t.category) ?? 0) + t.amount);
    }
  }
  const budgets = new Map<string, number>();
  for (const b of db.budgets) {
    if (b.user_id === user.id) budgets.set(b.category, b.monthly_limit);
  }

  const categories: SpendingCategory[] = [];
  let totalOut = 0;
  const sortedCats = [...spentMap.entries()].sort((a, b) => b[1] - a[1]);
  for (const [cat, s] of sortedCats) {
    totalOut += s;
    const entry: SpendingCategory = {
      category: cat,
      name_ar: CATEGORY_AR[cat] ?? cat,
      spent: s,
    };
    const limit = budgets.get(cat);
    if (limit) {
      entry.monthly_limit = limit;
      entry.pct = pyRound((s / limit) * 100, 1);
      entry.status = s > limit ? "over" : s >= 0.8 * limit ? "near" : "ok";
    }
    categories.push(entry);
  }
  // budgeted categories with zero spend so far
  for (const [cat, limit] of budgets) {
    if (!spentMap.has(cat)) {
      categories.push({
        category: cat,
        name_ar: CATEGORY_AR[cat] ?? cat,
        spent: 0,
        monthly_limit: limit,
        pct: 0.0,
        status: "ok",
      });
    }
  }
  return {
    month_start: isoNaive(start),
    total_spent_this_month: totalOut,
    categories,
  };
}

/** Set (or remove, when limit=0) a monthly spending limit per category. */
export function setBudget(
  db: Db,
  user: UserRow,
  category: string,
  monthlyLimit: number,
): { ok: boolean; error?: string; detail?: string; categories?: string[]; removed?: boolean; message?: string; category?: string; monthly_limit?: number; spent_this_month?: number } {
  const cat = (category ?? "").trim().toLowerCase();
  if (!BUDGETABLE_CATEGORIES.includes(cat)) {
    return { ok: false, error: "bad_category", categories: BUDGETABLE_CATEGORIES };
  }
  const limit = Math.trunc(monthlyLimit);
  if (limit < 0 || limit > 20_000_000) {
    return {
      ok: false,
      error: "bad_amount",
      detail: "الحد لازم يكون بين 0 (حذف) و 20,000,000 د.ع",
    };
  }

  const existing = db.budgets.find(
    (b) => b.user_id === user.id && b.category === cat,
  );
  const ar = CATEGORY_AR[cat] ?? cat;

  if (limit === 0) {
    if (existing) {
      db.budgets.splice(db.budgets.indexOf(existing), 1);
      return { ok: true, removed: true, message: `انحذفت ميزانية ${ar}` };
    }
    return { ok: true, removed: true, message: "ما كانت معينة أصلًا" };
  }

  if (existing) {
    existing.monthly_limit = limit;
    existing.updated_at = Date.now();
  } else {
    db.budgets.push({
      id: ++db.seq.budgets,
      user_id: user.id,
      category: cat,
      monthly_limit: limit,
      created_at: Date.now(),
      updated_at: Date.now(),
    });
  }

  // include month-to-date spend for context
  const start = monthStart(Date.now());
  const spent = db.txns
    .filter(
      (t) =>
        t.user_id === user.id &&
        t.direction === "out" &&
        t.category === cat &&
        t.created_at >= start,
    )
    .reduce((s, t) => s + t.amount, 0);

  return {
    ok: true,
    category: cat,
    monthly_limit: limit,
    spent_this_month: spent,
    message:
      `تم تعيين ميزانية ${ar} بمبلغ ${fmtAr(limit)} د.ع شهريًا — ` +
      `صرفك هذا الشهر ${fmtAr(spent)} د.ع`,
  };
}

export function getProfile(db: Db, user: UserRow) {
  return {
    full_name: user.full_name,
    city: user.city,
    district: user.district,
    phone: user.phone,
    card_masked: `•••• ${user.card_number.slice(-4)}`,
    balance: user.balance,
    age: user.age,
  };
}

/* --------------------------------------------------- scheduled payments --- */

const SCHED_ALIASES: Record<string, string> = {
  "كهرب": "electricity", "electricity": "electricity", "power": "electricity",
  "ماء": "water", "مياه": "water", "water": "water",
  "نت": "internet", "internet": "internet", "انترنت": "internet", "إنترنت": "internet",
  "شحن": "mobile", "mobile": "mobile", "زين": "mobile", "باقة": "mobile",
  "جامع": "education", "education": "education", "رسوم": "education", "مدرس": "education",
  "مرور": "traffic", "مخالف": "traffic", "traffic": "traffic", "غرام": "traffic",
  "صح": "health", "مستشف": "health", "علاج": "health", "فحص": "health",
  "طب": "health", "أسنان": "health", "اسنان": "health", "health": "health",
  "hospital": "health", "medical": "health", "تطعيم": "health",
  "غاز": "gas", "اسطوان": "gas", "gas": "gas",
};

/** Resolve a biller from a code, a (partial) name, or an Arabic category
 * word — preferring billers that serve the user's governorate. */
export function resolveBiller(
  target: string,
  userCity = "",
): [BillerRow, string] | null {
  const t = (target ?? "").trim();
  if (!t) return null;
  // 1. exact biller code
  for (const [cat, bs] of Object.entries(BILLERS)) {
    for (const b of bs) {
      if (b.code === t) return [b, cat];
    }
  }
  // 2. name containment
  for (const [cat, bs] of Object.entries(BILLERS)) {
    for (const b of bs) {
      if (b.name.includes(t) || t.includes(b.name)) return [b, cat];
    }
  }
  // 3. Arabic/English category keyword
  const low = t.toLowerCase();
  let cat: string | null = null;
  for (const [k, c] of Object.entries(SCHED_ALIASES)) {
    if (low.includes(k)) {
      cat = c;
      break;
    }
  }
  if (cat) {
    const bs = BILLERS[cat];
    const city = (userCity ?? "").trim();
    if (city) {
      for (const b of bs) {
        if (b.name.includes(city)) return [b, cat];
      }
    }
    return [bs[0], cat];
  }
  return null;
}

/* ---------------------------------------------------------- _parse_when --- */

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** "first of next month at 09:00" for the given now. */
function firstOfNextMonthAt9(now: number): number {
  const d = new Date(now);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth() + 1; // 1-based
  if (m < 12) m += 1;
  else {
    y += 1;
    m = 1;
  }
  return Date.UTC(y, m - 1, 1, 9, 0, 0, 0);
}

/** The date of `ms` at 09:00 UTC. */
function at9(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0, 0, 0);
}

/** Strict "YYYY-MM-DD[THH:MM]" parse (Python fromisoformat parity) → epoch ms
 * or null when the calendar date itself is invalid. */
function parseIsoAt(dateStr: string, timeStr: string): number | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const tm = timeStr.match(/^(\d{2}):(\d{2})$/);
  if (!tm) return null;
  const h = Number(tm[1]);
  const mi = Number(tm[2]);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59) return null;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const maxDay = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (day < 1 || day > maxDay) return null;
  return Date.UTC(y, mo - 1, day, h, mi, 0, 0);
}

/** Parse a scheduling time from Arabic phrases or ISO datetime.
 * Returns [epochMs | null, frequencyHint] — the hint is "monthly" when the
 * user asked for a recurring mandate. */
export function parseWhen(text: string): [number | null, string] {
  const t = (text ?? "").trim();
  const low = t.toLowerCase().replace(/\s+/g, " ");
  const now = Date.now();

  if (/كل شهر|شهري|شهر[يي]ا|monthly|every month/.test(low)) {
    return [firstOfNextMonthAt9(now), "monthly"];
  }

  // relative minutes: «بعد دقيقة» / «بعد دقيقتين» / «بعد 5 دقائق»
  let m =
    low.match(/بعد\s+(?:بو?ص?\s*)?(\d+)\s*دقيق/) ||
    low.match(/after\s+(\d+)\s*min/);
  if (m) return [now + Number(m[1]) * MIN_MS, ""];
  if (/بعد\s+دقيق[تي]?ين|بعد دقيقة/.test(low)) return [now + 2 * MIN_MS, ""];

  // relative hours
  m = low.match(/بعد\s+(\d+)\s*ساع/) || low.match(/after\s+(\d+)\s*hour/);
  if (m) return [now + Number(m[1]) * HOUR_MS, ""];
  if (/بعد\s+ساع[تي]?ين/.test(low)) return [now + 2 * HOUR_MS, ""];

  // tomorrow
  if (/غدا|غدًا|بكر[هة]|بكرة|tomorrow/.test(low)) {
    return [at9(now + DAY_MS), ""];
  }

  // relative days: «بعد يومين» / «بعد 3 أيام» / «بعد أسبوع»
  if (/بعد\s+يومين|بعد\s+يومان/.test(low)) return [now + 2 * DAY_MS, ""];
  if (/بعد\s+أسبوع|بعد\s+اسبوع|in a week|next week/.test(low)) {
    return [now + 7 * DAY_MS, ""];
  }
  m = low.match(/بعد\s+(\d+)\s*(?:يوم|أيام|ايام|day|days)/);
  if (m) return [now + Number(m[1]) * DAY_MS, ""];

  // first of next month
  if (/أول الشهر|اول الشهر|بداية الشهر|first of (the )?month|start of month/.test(low)) {
    return [firstOfNextMonthAt9(now), ""];
  }

  // explicit ISO: 2026-10-01 or 2026-10-01T09:00 / 2026-10-01 09:00
  m = t.match(/(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}))?/);
  if (m) {
    const when = parseIsoAt(m[1], m[2] ?? "09:00");
    if (when !== null) return [when, ""];
  }

  // day/month Arabic style: «1-10» or «1/10»
  m = t.match(/(?<![\p{L}\p{N}_])(\d{1,2})[-/](\d{1,2})(?![\p{L}\p{N}_])/u);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    const nd = new Date(now);
    const year =
      month >= nd.getUTCMonth() + 1 ? nd.getUTCFullYear() : nd.getUTCFullYear() + 1;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const maxDay =
      month >= 1 && month <= 12
        ? [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
        : 0;
    if (month >= 1 && month <= 12 && day >= 1 && day <= maxDay) {
      return [Date.UTC(year, month - 1, day, 9, 0, 0, 0), ""];
    }
  }

  if (/الان|الآن|الحين|حالا|باسرع|now|asap/.test(low)) {
    return [now + MIN_AHEAD_MS, ""];
  }

  return [null, ""];
}

/** Create a PIN-authorized scheduled payment mandate.
 * kind: "bill" (target = biller code) or "transfer" (target = 16-digit card).
 * when: Arabic phrase («غدًا», «بعد يومين», «أول الشهر الجاي») or ISO date. */
export function schedulePayment(
  db: Db,
  user: UserRow,
  kind: string,
  target: string,
  amount: number,
  when: string,
  pin: string,
  frequency = "",
): { ok: boolean; error?: string; detail?: string; scheduled?: { id: number; kind: string; label: string; amount: number; frequency: string; next_run_at: string }; message?: string } {
  const k = (kind ?? "").trim().toLowerCase();
  if (k !== "bill" && k !== "transfer") return { ok: false, error: "bad_kind" };

  if (!verifyPin(pin ?? "", user.pin_salt, user.pin_hash)) {
    return { ok: false, error: "pin" };
  }

  const amt = Math.trunc(amount);
  if (!(amt >= 1000 && amt <= 5_000_000)) {
    return {
      ok: false,
      error: "bad_amount",
      detail: "المبلغ لازم يكون بين 1,000 و 5,000,000 د.ع",
    };
  }

  const [whenDt, freqHint] = parseWhen(when);
  if (whenDt === null) {
    return {
      ok: false,
      error: "bad_when",
      detail:
        "ما فهمت التوقيت — استخدم مثلًا «غدًا»، «بعد يومين»، " +
        "«أول الشهر الجاي»، أو تاريخ ISO مثل 2026-10-01",
    };
  }
  let freq = (frequency || freqHint || "once").trim().toLowerCase();
  if (freq !== "once" && freq !== "monthly") freq = "once";

  const now = Date.now();
  let runAt = whenDt;
  if (runAt < now + MIN_AHEAD_MS) runAt = now + MIN_AHEAD_MS;
  if (runAt > now + MAX_AHEAD_MS) {
    return { ok: false, error: "bad_when", detail: "ما تصير جدولة أبعد من سنة" };
  }

  let label: string;
  if (k === "bill") {
    const resolved = resolveBiller(target, user.city);
    if (resolved === null) {
      return {
        ok: false,
        error: "bad_target",
        detail: "ما لقيت الجهة — اذكر نوع الفاتورة (كهرباء، ماء، إنترنت…) أو كود الجهة",
      };
    }
    const [biller, category] = resolved;
    db.scheduled.push({
      id: ++db.seq.scheduled,
      user_id: user.id,
      kind: "bill",
      category,
      biller_code: biller.code,
      biller_name: biller.name,
      subscriber_no: "",
      receiver_card: "",
      receiver_name: "",
      amount: amt,
      frequency: freq,
      next_run_at: runAt,
      last_run_at: null,
      status: "pending",
      created_at: now,
    });
    label = `فاتورة ${biller.name}`;
  } else {
    const card = (target ?? "").replace(/\D/g, "");
    if (card.length !== 16) {
      return {
        ok: false,
        error: "bad_target",
        detail: "رقم بطاقة المستلم لازم 16 رقم",
      };
    }
    const receiver = db.users.find((u) => u.card_number === card);
    if (receiver == null) return { ok: false, error: "not_found" };
    if (receiver.id === user.id) return { ok: false, error: "self" };
    db.scheduled.push({
      id: ++db.seq.scheduled,
      user_id: user.id,
      kind: "transfer",
      category: "",
      biller_code: "",
      biller_name: "",
      subscriber_no: "",
      receiver_card: card,
      receiver_name: receiver.full_name,
      amount: amt,
      frequency: freq,
      next_run_at: runAt,
      last_run_at: null,
      status: "pending",
      created_at: now,
    });
    label = `حوالة إلى ${receiver.full_name}`;
  }

  const sp = db.scheduled[db.scheduled.length - 1];
  const freqTxt = freq === "monthly" ? "وتتكرر شهريًا" : "لمرة واحدة";
  return {
    ok: true,
    scheduled: {
      id: sp.id,
      kind: sp.kind,
      label,
      amount: sp.amount,
      frequency: sp.frequency,
      next_run_at: isoNaive(sp.next_run_at),
    },
    message:
      `تمت الجدولة ✅ ${label} بمبلغ ${fmtAr(amt)} د.ع ` +
      `بتاريخ ${isoDate(sp.next_run_at)} ${freqTxt}.`,
  };
}

export function listScheduled(db: Db, user: UserRow) {
  runDueScheduled(db);
  const rows = db.scheduled
    .filter((sp) => sp.user_id === user.id && sp.status === "pending")
    .sort((a, b) => a.next_run_at - b.next_run_at);
  return {
    count: rows.length,
    monthly_total: rows
      .filter((sp) => sp.frequency === "monthly")
      .reduce((s, sp) => s + sp.amount, 0),
    items: rows.map((sp) => ({
      id: sp.id,
      kind: sp.kind,
      label: scheduledLabel(sp),
      amount: sp.amount,
      frequency: sp.frequency,
      next_run_at: sp.next_run_at === null ? null : isoNaive(sp.next_run_at),
    })),
  };
}

export function cancelScheduled(
  db: Db,
  user: UserRow,
  scheduledId: number,
): { ok: boolean; error?: string; message?: string } {
  const sp = db.scheduled.find((s) => s.id === scheduledId);
  if (sp == null || sp.user_id !== user.id || sp.status !== "pending") {
    return { ok: false, error: "not_found" };
  }
  sp.status = "cancelled";
  return { ok: true, message: `انحذفت جدولة ${scheduledLabel(sp)}` };
}

/* --------------------------------------------------------- savings goals --- */

export const MAX_GOALS = 8;

export type GoalDict = {
  id: number;
  name: string;
  emoji: string;
  target: number;
  saved: number;
  remaining: number;
  pct: number;
  status: string;
};

function goalRow(g: SavingsGoalRow): GoalDict {
  const pct = g.target_amount ? pyRound((g.saved_amount / g.target_amount) * 100) : 0;
  return {
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    target: g.target_amount,
    saved: g.saved_amount,
    remaining: Math.max(0, g.target_amount - g.saved_amount),
    pct: Math.min(pct, 100),
    status: g.status,
  };
}

export type ListGoalsResult = {
  count: number;
  total_saved: number;
  items: GoalDict[];
};

/** The user's savings goals with progress (active + completed). */
export function listGoals(db: Db, user: UserRow): ListGoalsResult {
  const rows = db.goals
    .filter((g) => g.user_id === user.id)
    .sort(
      (a, b) =>
        (a.status < b.status ? 1 : a.status > b.status ? -1 : 0) || // status desc
        a.created_at - b.created_at,
    );
  return {
    count: rows.length,
    total_saved: rows.reduce((s, g) => s + g.saved_amount, 0),
    items: rows.map(goalRow),
  };
}

/** Create a savings goal (no PIN — no money moves at creation). */
export function createGoal(
  db: Db,
  user: UserRow,
  name: string,
  targetAmount: number,
): { ok: boolean; error?: string; goal?: ReturnType<typeof goalRow>; message?: string } {
  const n = (name ?? "").trim();
  if (n.length < 2) {
    return { ok: false, error: "اكتب اسم هدف واضح (حرفين على الأقل)" };
  }
  const target = Math.trunc(targetAmount);
  if (!(target >= 10_000 && target <= 100_000_000)) {
    return {
      ok: false,
      error: "الهدف يجب أن يكون بين ١٠,٠٠٠ و ١٠٠,٠٠٠,٠٠٠ د.ع",
    };
  }
  const count = db.goals.filter((g) => g.user_id === user.id).length;
  if (count >= MAX_GOALS) {
    return { ok: false, error: `عندك الحد الأقصى ${MAX_GOALS} أهداف` };
  }
  const g: SavingsGoalRow = {
    id: ++db.seq.goals,
    user_id: user.id,
    name: n,
    emoji: "🎯",
    target_amount: target,
    saved_amount: 0,
    status: "active",
    created_at: Date.now(),
    updated_at: null,
  };
  db.goals.push(g);
  return {
    ok: true,
    goal: goalRow(g),
    message: `سوّينا هدف «${n}» بمبلغ ${fmtIqd(target)} — ابدأ توفّر له`,
  };
}

/** Move IQD from the wallet balance into a goal (PIN-verified). */
export function depositGoal(
  db: Db,
  user: UserRow,
  goalId: number,
  amount: number,
  pin: string,
): { ok: boolean; error?: string; goal?: ReturnType<typeof goalRow>; receipt?: ReceiptDict; message?: string } {
  if (!verifyPin(pin ?? "", user.pin_salt, user.pin_hash)) {
    return { ok: false, error: "pin_invalid" };
  }
  const g = db.goals.find((x) => x.id === goalId);
  if (g == null || g.user_id !== user.id) {
    return { ok: false, error: "goal_not_found" };
  }
  const amt = Math.trunc(amount);
  if (!(amt >= 1_000 && amt <= 5_000_000)) {
    return { ok: false, error: "التوفير يجب أن يكون بين ١,٠٠٠ و ٥,٠٠٠,٠٠٠ د.ع" };
  }
  if (user.balance < amt) {
    return { ok: false, error: "رصيدك ما يكفي — عبّي المحفظة أولًا" };
  }

  const now = Date.now();
  const ref = newRef();
  user.balance -= amt;
  g.saved_amount += amt;
  g.updated_at = now;
  const justReached = g.status === "active" && g.saved_amount >= g.target_amount;
  if (justReached) g.status = "completed";

  db.txns.push({
    id: ++db.seq.txns,
    reference: ref,
    user_id: user.id,
    type: "goal_deposit",
    direction: "out",
    amount: amt,
    balance_after: user.balance,
    title: `توفير — ${g.name}`,
    subtitle: "إيداع بالهدف" + (justReached ? " 🎉 اكتمل!" : ""),
    category: "savings",
    counterparty_id: null,
    bill_id: null,
    created_at: now,
  });

  if (justReached) {
    notify(db, user.id, {
      kind: "goal_reached",
      title: `وصلت لهدفك «${g.name}» 🎉`,
      body:
        `وفّرت ${fmtIqd(g.saved_amount)} من ${fmtIqd(g.target_amount)} — ` +
        "مبروك! تقدر تسحب التوفير لمحفظتك وقتما تحب.",
      amount: g.saved_amount,
      reference: `goal-${g.id}`,
    });
  }

  const tail = justReached
    ? `اكتمل الهدف 🎉 (${en(g.saved_amount)} د.ع)` // Python keeps plain "," here
    : `وصل ${Math.min(pyRound((g.saved_amount / g.target_amount) * 100), 100)}%`;

  return {
    ok: true,
    goal: goalRow(g),
    receipt: {
      reference: ref,
      title: `توفير — ${g.name}`,
      amount: amt,
      balance_after: user.balance,
      created_at: isoNaive(now),
    },
    message: `وفّرت ${fmtIqd(amt)} لهدف «${g.name}» — ${tail}`,
  };
}
