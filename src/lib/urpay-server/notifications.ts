/* Lazy notification generators — port of app/routers/notifications.py.
 * Moved into a lib module so future agent routes can reuse them. */

import type { Db, NotificationRow, UserRow } from "./types";
import { CATEGORY_AR } from "./constants";
import { dayDiff, fmtAr, isoWeek, monthStart, scheduledLabel } from "./serializers";

const DUE_SOON_DAYS = 3;
const DAY = 86_400_000;

function pushNotification(
  db: Db,
  row: Omit<NotificationRow, "id" | "is_read">,
): void {
  db.notifications.push({
    id: ++db.seq.notifications,
    is_read: false,
    ...row,
    title: row.title.slice(0, 160),
    body: row.body.slice(0, 280),
    reference: row.reference.slice(0, 32),
  });
}

/** First-ever fetch for a user with no notifications → welcome message. */
export function lazyWelcome(db: Db, user: UserRow): void {
  if (db.notifications.some((n) => n.user_id === user.id)) return;
  pushNotification(db, {
    user_id: user.id,
    kind: "welcome",
    title: `أهلاً ${user.first_name} بأور پاي 👋`,
    body: "محفظتك جاهزة — ادفع فواتيرك، حوّل لأصدقائك، أو خلّي المساعد أور يسوي كلشي بمحادثة وحدة.",
    amount: null,
    reference: "welcome",
    created_at: Date.now(),
  });
}

/** Bill-due notifications for unpaid bills due within 3 days (dedupe due-{id}). */
export function lazyDueNotifications(db: Db, user: UserRow): void {
  const now = Date.now();
  const horizon = now + DUE_SOON_DAYS * DAY;
  const bills = db.bills.filter(
    (b) =>
      b.user_id === user.id && b.status === "unpaid" && b.due_date <= horizon,
  );
  if (bills.length === 0) return;

  const existingRefs = new Set(
    db.notifications
      .filter((n) => n.user_id === user.id && n.reference.startsWith("due-"))
      .map((n) => n.reference),
  );

  for (const b of bills) {
    const ref = `due-${b.id}`;
    if (existingRefs.has(ref)) continue;
    const overdue = b.due_date < now;
    const days = dayDiff(b.due_date, now);
    const when = overdue
      ? "متأخرة"
      : days === 0
        ? "تستحق اليوم"
        : days === 1
          ? "تستحق غدًا"
          : `تستحق بعد ${days} أيام`;
    pushNotification(db, {
      user_id: user.id,
      kind: "bill_due",
      title: `فاتورة ${b.biller_name} ${when}`,
      // NOTE: the period clause mirrors notifications.py verbatim (it only
      // appends the period when it is EMPTY — a quirk kept for 1:1 parity).
      body:
        `${fmtAr(b.amount)} د.ع` +
        (b.period ? "" : ` · ${b.period}`) +
        " — دفعها الآن يوفّر عليك غرامة التأخير.",
      amount: b.amount,
      reference: ref,
      created_at: now,
    });
  }
}

/** One proactive spend digest per ISO week (ref digest-{year}-W{week}). */
export function lazyWeeklyDigest(db: Db, user: UserRow): void {
  const now = Date.now();
  const [isoYear, isoWeekNum] = isoWeek(now);
  const ref = `digest-${isoYear}-W${isoWeekNum}`;
  if (db.notifications.some((n) => n.user_id === user.id && n.reference === ref)) {
    return;
  }

  const weekAgo = now - 7 * DAY;

  // 1) last-7-day out spend per category
  const catTotals = new Map<string, number>();
  for (const t of db.txns) {
    if (t.user_id !== user.id || t.direction !== "out" || t.created_at < weekAgo) {
      continue;
    }
    catTotals.set(t.category, (catTotals.get(t.category) ?? 0) + t.amount);
  }
  const catRows = [...catTotals.entries()].sort((a, b) => b[1] - a[1]);
  const weekTotal = catRows.reduce((s, [, v]) => s + v, 0);
  let top: [string, number] | null = null;
  if (catRows.length > 0 && catRows[0][1] > 0) {
    top = [CATEGORY_AR[catRows[0][0] ?? "other"] ?? "أخرى", catRows[0][1]];
  }

  // 2) budget overshoot (month-to-date)
  const start = monthStart(now);
  const warnings: string[] = [];
  for (const b of db.budgets.filter((bg) => bg.user_id === user.id)) {
    const spent = db.txns
      .filter(
        (t) =>
          t.user_id === user.id &&
          t.direction === "out" &&
          t.category === b.category &&
          t.created_at >= start,
      )
      .reduce((s, t) => s + t.amount, 0);
    if (b.monthly_limit && spent > b.monthly_limit) {
      warnings.push(
        `تجاوزت ميزانية ${CATEGORY_AR[b.category] ?? b.category} ` +
          `(${fmtAr(spent)} من ${fmtAr(b.monthly_limit)})`,
      );
    }
  }

  // 3) upcoming scheduled payments + bills due within 7 days
  const horizon = now + 7 * DAY;
  const scheduled = db.scheduled
    .filter(
      (sp) =>
        sp.user_id === user.id &&
        sp.status === "pending" &&
        sp.next_run_at <= horizon,
    )
    .sort((a, b) => a.next_run_at - b.next_run_at);
  const upcoming: string[] = scheduled.slice(0, 2).map((s) => {
    const days = dayDiff(s.next_run_at, now);
    return `${fmtAr(s.amount)} د.ع — ${scheduledLabel(s)} ${
      days === 1 ? "غدًا" : `${days} يوم`
    }`;
  });
  const dueBills = db.bills
    .filter(
      (b) =>
        b.user_id === user.id && b.status === "unpaid" && b.due_date <= horizon,
    )
    .sort((a, b) => a.due_date - b.due_date);
  for (const b of dueBills.slice(0, 2)) {
    const days = dayDiff(b.due_date, now);
    const when = days === 0 ? "اليوم" : days === 1 ? "غدًا" : `بعد ${days} أيام`;
    upcoming.push(`فاتورة ${b.biller_name} ${when} (${fmtAr(b.amount)} د.ع)`);
  }

  if (weekTotal === 0 && warnings.length === 0 && upcoming.length === 0) {
    return; // nothing to report this week
  }

  const parts: string[] = [];
  if (weekTotal > 0) {
    let line = `صرفك هذا الأسبوع ${fmtAr(weekTotal)} د.ع`;
    if (top) {
      line += ` — أكثر تصنيف: ${top[0]} (${fmtAr(top[1])})`;
    }
    parts.push(line);
  }
  parts.push(...warnings.slice(0, 2).map((w) => `⚠️ ${w}`));
  parts.push(...upcoming.slice(0, 3).map((u) => `📅 ${u}`));

  let title = "ملخص أسبوعك مع أور 📊";
  if (weekTotal > 0) title += ` — ${fmtAr(weekTotal)} د.ع`;
  const body = parts.join(" · ").slice(0, 280);

  pushNotification(db, {
    user_id: user.id,
    kind: "spend_digest",
    title,
    body,
    amount: weekTotal > 0 ? weekTotal : null,
    reference: ref,
    created_at: now,
  });
}

/** One daily morning brief (ref brief-{YYYY-MM-DD}). */
export function lazyMorningBrief(db: Db, user: UserRow): void {
  const now = Date.now();
  const ref = `brief-${new Date(now).toISOString().slice(0, 10)}`;
  if (db.notifications.some((n) => n.user_id === user.id && n.reference === ref)) {
    return;
  }

  const parts = [`رصيدك الآن ${fmtAr(user.balance)} د.ع`];

  // bills due within 24h (today/tomorrow)
  const horizon = now + DAY;
  const due = db.bills
    .filter(
      (b) =>
        b.user_id === user.id && b.status === "unpaid" && b.due_date <= horizon,
    )
    .sort((a, b) => a.due_date - b.due_date);
  for (const b of due.slice(0, 2)) {
    const days = dayDiff(b.due_date, now);
    const when = days <= 0 ? "تستحق اليوم" : "تستحق غدًا";
    parts.push(`⚠️ فاتورة ${b.biller_name} ${when} (${fmtAr(b.amount)} د.ع)`);
  }

  // scheduled payments executing within 24h
  const sched = db.scheduled
    .filter(
      (sp) =>
        sp.user_id === user.id && sp.status === "pending" && sp.next_run_at <= horizon,
    )
    .sort((a, b) => a.next_run_at - b.next_run_at);
  for (const s of sched.slice(0, 2)) {
    parts.push(`📅 بينفّذ اليوم ${fmtAr(s.amount)} د.ع — ${scheduledLabel(s)}`);
  }

  // nearest active savings goal (encouragement nudge)
  const goal = db.goals
    .filter((g) => g.user_id === user.id && g.status === "active")
    .sort((a, b) => b.saved_amount - a.saved_amount)[0];
  if (goal && goal.target_amount) {
    const pct = Math.round((goal.saved_amount / goal.target_amount) * 100);
    parts.push(`🎯 هدف «${goal.name}» وصّل ${pct}%`);
  }

  const body = parts.join(" · ").slice(0, 280);
  pushNotification(db, {
    user_id: user.id,
    kind: "morning_brief",
    title: `موجز يومك مع أور ☀️ — ${fmtAr(user.balance)} د.ع`,
    body,
    amount: null,
    reference: ref,
    created_at: now,
  });
}
