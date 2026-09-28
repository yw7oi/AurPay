/* Scheduled payment executor — port of app/scheduler.py.
 *
 * In the Python service a background asyncio loop scans for due mandates
 * every 20s. In this serverless port, runDueScheduled() is invoked lazily
 * from the /api/scheduled and /api/notifications routes (covers downtime
 * gaps identically). */

import type { Db, ScheduledRow, UserRow } from "./types";
import { checkBudgetCrossing } from "./budget";
import { notify } from "./notify";
import { newRef } from "./security";
import { fmtAr, scheduledLabel } from "./serializers";

export const MIN_AHEAD_MS = 30_000; // minimum lead time when creating
export const MAX_AHEAD_MS = 365 * 86_400_000; // max scheduling horizon

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Same day next month (clamped to month length) — port of _next_month. */
export function nextMonth(ms: number): number {
  const d = new Date(ms);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth() + 2; // 1-based next month
  if (m > 12) {
    y += 1;
    m = 1;
  }
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const maxDay = m === 2 && leap ? 29 : MONTH_DAYS[m - 1];
  const day = Math.min(d.getUTCDate(), maxDay);
  return Date.UTC(y, m - 1, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

/** Execute a due scheduled payment (port of execute_one). */
function executeOne(db: Db, sp: ScheduledRow, user: UserRow): void {
  const now = Date.now();
  const ref = newRef();

  if (sp.kind === "bill") {
    if (user.balance < sp.amount) {
      sp.status = "failed";
      sp.last_run_at = now;
      notify(db, user.id, {
        kind: "scheduled_failed",
        title: "تعذّر تنفيذ دفعة مجدولة",
        body:
          `رصيدك ما يكفي لـ${scheduledLabel(sp)} بمبلغ ` +
          `${fmtAr(sp.amount)} د.ع — عبّي محفظتك وأعد جدولتها.`,
        amount: sp.amount,
        reference: `sch-${sp.id}`,
      });
      return;
    }

    user.balance -= sp.amount;
    const bill = {
      id: ++db.seq.bills,
      user_id: user.id,
      category: sp.category,
      biller_code: sp.biller_code,
      biller_name: sp.biller_name,
      subscriber_no: sp.subscriber_no,
      amount: sp.amount,
      period: "دفعة مجدولة تلقائيًا",
      due_date: now,
      status: "paid",
      issued_at: now,
      paid_at: now,
      receipt_ref: ref,
    };
    db.bills.push(bill);
    db.txns.push({
      id: ++db.seq.txns,
      reference: ref,
      user_id: user.id,
      type: "bill_payment",
      direction: "out",
      amount: sp.amount,
      balance_after: user.balance,
      title: scheduledLabel(sp),
      subtitle: "دفع مجدول تلقائيًا",
      category: sp.category,
      counterparty_id: null,
      bill_id: bill.id,
      created_at: now,
    });
    notify(db, user.id, {
      kind: "scheduled_executed",
      title: `نُفّذت دفعتك المجدولة — ${sp.biller_name}`,
      body:
        `دفعنا عنك ${fmtAr(sp.amount)} د.ع · المرجع ${ref} · ` +
        `رصيدك الآن ${fmtAr(user.balance)} د.ع`,
      amount: sp.amount,
      reference: ref,
    });
    checkBudgetCrossing(db, user, sp.category, sp.amount);
  } else if (sp.kind === "transfer") {
    const receiver = db.users.find((u) => u.card_number === sp.receiver_card);
    if (receiver == null || receiver.id === user.id || user.balance < sp.amount) {
      sp.status = "failed";
      sp.last_run_at = now;
      const reason =
        receiver == null ? "المستلم غير متوفر حاليًا" : "رصيدك ما يكفي";
      notify(db, user.id, {
        kind: "scheduled_failed",
        title: "تعذّر تنفيذ حوالة مجدولة",
        body:
          `${scheduledLabel(sp)} بمبلغ ${fmtAr(sp.amount)} د.ع — ${reason}. ` +
          `أعد الجدولة بعد التحقق.`,
        amount: sp.amount,
        reference: `sch-${sp.id}`,
      });
      return;
    }

    user.balance -= sp.amount;
    receiver.balance += sp.amount;
    db.txns.push({
      id: ++db.seq.txns,
      reference: ref,
      user_id: user.id,
      type: "transfer_out",
      direction: "out",
      amount: sp.amount,
      balance_after: user.balance,
      title: `حوالة مجدولة إلى ${receiver.full_name}`,
      subtitle: `بطاقة •••• ${receiver.card_number.slice(-4)} · تلقائيًا`,
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
      amount: sp.amount,
      balance_after: receiver.balance,
      title: `حوالة مجدولة من ${user.full_name}`,
      subtitle: `بطاقة •••• ${user.card_number.slice(-4)} · تلقائيًا`,
      category: "transfer",
      counterparty_id: user.id,
      bill_id: null,
      created_at: now,
    });
    notify(db, receiver.id, {
      kind: "transfer_in",
      title: `وصلتك حوالة مجدولة من ${user.full_name}`,
      body: `المبلغ انضاف لرصيدك · المرجع ${ref}`,
      amount: sp.amount,
      reference: ref,
    });
    notify(db, user.id, {
      kind: "scheduled_executed",
      title: `نُفّذت حوالتك المجدولة إلى ${receiver.full_name}`,
      body:
        `حوّلنا عنك ${fmtAr(sp.amount)} د.ع · المرجع ${ref} · ` +
        `رصيدك الآن ${fmtAr(user.balance)} د.ع`,
      amount: sp.amount,
      reference: ref,
    });
    checkBudgetCrossing(db, user, "transfer", sp.amount);
  }

  // success → schedule the next run or finish
  sp.last_run_at = now;
  if (sp.frequency === "monthly") {
    sp.next_run_at = nextMonth(now);
  } else {
    sp.status = "executed";
  }
}

/** Find + execute all due pending mandates. Returns count executed. */
export function runDueScheduled(db: Db): number {
  const now = Date.now();
  const due = db.scheduled
    .filter((sp) => sp.status === "pending" && sp.next_run_at <= now)
    .sort((a, b) => a.next_run_at - b.next_run_at)
    .slice(0, 25);
  if (due.length === 0) return 0;

  let count = 0;
  for (const sp of due) {
    const user = db.users.find((u) => u.id === sp.user_id);
    if (!user) {
      sp.status = "failed";
      continue;
    }
    try {
      executeOne(db, sp, user); // one bad mandate must never block the rest
      count += 1;
    } catch (e) {
      console.error(`[urpay] scheduled ${sp.id} failed:`, e);
      sp.status = "failed";
    }
  }
  return count;
}
