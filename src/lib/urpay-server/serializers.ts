/* Serialization helpers — naive-ISO dates, Arabic number formatting and
 * row → API-shape mappers (port of the pydantic response models).
 *
 * Python returns naive UTC `datetime.isoformat()` WITHOUT timezone suffix,
 * e.g. "2026-09-27T12:34:56" — isoNaive() reproduces that exactly. */

import type {
  BillRow, BudgetRow, FavoriteRow, NotificationRow, SavingsGoalRow,
  ScheduledRow, TxnRow, UserRow,
} from "./types";
import { AR_MONTHS } from "./constants";

/** epoch ms -> "2026-09-27T12:34:56" (naive UTC, second precision) */
export function isoNaive(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

/** epoch ms -> "2026-09-27" */
export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** epoch ms -> "12:34" */
export function isoTime(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16);
}

/** Python f"{n:,}".replace(",", "،") — Arabic thousands separator */
export function fmtAr(n: number): string {
  return Math.round(n).toLocaleString("en-US").replace(/,/g, "،");
}

/** Python round(x, 1) — one decimal place */
export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/** UTC calendar-day difference (a - b), matching Python (dateA - dateB).days */
export function dayDiff(aMs: number, bMs: number): number {
  return Math.floor(aMs / 86_400_000) - Math.floor(bMs / 86_400_000);
}

/** UTC first-of-month 00:00 for the given epoch ms */
export function monthStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** ISO-8601 week [isoYear, isoWeek] for the given epoch ms (UTC) */
export function isoWeek(ms: number): [number, number] {
  const d = new Date(ms);
  const dayUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = new Date(dayUtc).getUTCDay(); // 0=Sun
  const isoDow = dow === 0 ? 7 : dow;
  const thursday = dayUtc + (4 - isoDow) * 86_400_000;
  const isoYear = new Date(thursday).getUTCFullYear();
  const jan1 = Date.UTC(isoYear, 0, 1);
  const week = Math.floor((thursday - jan1) / 86_400_000 / 7) + 1;
  return [isoYear, week];
}

export function cardMasked(card: string): string {
  return `•••• •••• •••• ${card.slice(-4)}`;
}

/** ScheduledPayment.label (models.py) */
export function scheduledLabel(sp: ScheduledRow): string {
  if (sp.kind === "bill") return `فاتورة ${sp.biller_name}`;
  return `حوالة إلى ${sp.receiver_name || sp.receiver_card.slice(-4)}`;
}

/* ------------------------------------------------------- response shapes --- */

export function userPublic(u: UserRow) {
  return {
    id: u.id,
    full_name: u.full_name,
    first_name: u.first_name,
    father_name: u.father_name,
    family_name: u.family_name,
    age: u.age,
    city: u.city,
    district: u.district,
    phone: u.phone,
    email: u.email,
    card_number: u.card_number,
    card_masked: cardMasked(u.card_number),
    balance: u.balance,
    avatar_hue: u.avatar_hue,
    is_demo: u.is_demo,
    created_at: isoNaive(u.created_at),
  };
}

export function billPublic(b: BillRow) {
  return {
    id: b.id,
    category: b.category,
    biller_code: b.biller_code,
    biller_name: b.biller_name,
    subscriber_no: b.subscriber_no,
    amount: b.amount,
    period: b.period,
    due_date: isoNaive(b.due_date),
    status: b.status,
    overdue: b.status === "unpaid" && b.due_date < Date.now(),
    issued_at: isoNaive(b.issued_at),
    paid_at: b.paid_at === null ? null : isoNaive(b.paid_at),
    receipt_ref: b.receipt_ref,
  };
}

export function txnPublic(t: TxnRow) {
  return {
    id: t.id,
    reference: t.reference,
    type: t.type,
    direction: t.direction,
    amount: t.amount,
    balance_after: t.balance_after,
    title: t.title,
    subtitle: t.subtitle,
    category: t.category,
    created_at: isoNaive(t.created_at),
  };
}

export function scheduledItem(sp: ScheduledRow) {
  return {
    id: sp.id,
    kind: sp.kind,
    label: scheduledLabel(sp),
    category: sp.category,
    biller_name: sp.biller_name,
    subscriber_no: sp.subscriber_no,
    receiver_name: sp.receiver_name,
    receiver_card_masked: sp.receiver_card
      ? `•••• ${sp.receiver_card.slice(-4)}`
      : "",
    amount: sp.amount,
    frequency: sp.frequency,
    next_run_at: sp.next_run_at === null ? null : isoNaive(sp.next_run_at),
    last_run_at: sp.last_run_at === null ? null : isoNaive(sp.last_run_at),
    status: sp.status,
    created_at: isoNaive(sp.created_at),
  };
}

export function goalItem(g: SavingsGoalRow) {
  const pct = g.target_amount
    ? round1((g.saved_amount / g.target_amount) * 100)
    : 0;
  return {
    id: g.id,
    name: g.name,
    emoji: g.emoji,
    target_amount: g.target_amount,
    saved_amount: g.saved_amount,
    remaining: Math.max(0, g.target_amount - g.saved_amount),
    pct: Math.min(pct, 100),
    status: g.status,
    created_at: isoNaive(g.created_at),
  };
}

export function favoriteItem(fav: FavoriteRow, target: UserRow) {
  return {
    id: fav.id,
    user_id: target.id,
    full_name: target.full_name,
    first_name: target.first_name,
    city: target.city,
    card_number: target.card_number,
    avatar_hue: target.avatar_hue,
  };
}

export function notificationOut(n: NotificationRow) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    amount: n.amount,
    reference: n.reference,
    is_read: n.is_read,
    created_at: isoNaive(n.created_at),
  };
}

export function budgetItem(
  b: BudgetRow,
  spent: number,
): { category: string; monthly_limit: number; spent: number; remaining: number; pct: number; status: "ok" | "near" | "over" } {
  const pct = b.monthly_limit ? round1((spent / b.monthly_limit) * 100) : 0;
  const status: "ok" | "near" | "over" =
    spent > b.monthly_limit ? "over" : pct >= 80 ? "near" : "ok";
  return {
    category: b.category,
    monthly_limit: b.monthly_limit,
    spent,
    remaining: b.monthly_limit - spent,
    pct,
    status,
  };
}

/** budgets.py: AR_MONTHS[current] label */
export function currentMonthLabel(ms = Date.now()): string {
  return AR_MONTHS[new Date(ms).getUTCMonth()];
}
