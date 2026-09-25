"""Notifications center — bell icon feed.

Notifications are pushed by wallet/agent actions (see app/notify.py) and
lazily generated for bill due-dates and the weekly spend digest when the
feed is fetched.
"""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..constants import CATEGORY_AR
from ..db import get_session
from ..models import (Bill, Budget, Notification, SavingsGoal, ScheduledPayment,
                     Transaction, User, utcnow)
from ..security import get_current_user

router = APIRouter(prefix="/api", tags=["notifications"])

DUE_SOON_DAYS = 3
FEED_LIMIT = 30


class NotificationOut(BaseModel):
    id: int
    kind: str
    title: str
    body: str
    amount: int | None
    reference: str
    is_read: bool
    created_at: str


async def _lazy_due_notifications(session: AsyncSession, user: User) -> None:
    """Create bill-due notifications for unpaid bills due within 3 days.

    Deduplicated via reference = "due-{bill_id}" — a notification is only
    created once per bill. Caller commits.
    """
    horizon = utcnow() + timedelta(days=DUE_SOON_DAYS)
    bills = (await session.execute(
        select(Bill).where(
            Bill.user_id == user.id,
            Bill.status == "unpaid",
            Bill.due_date <= horizon,
        ))).scalars().all()
    if not bills:
        return
    existing_refs = set((await session.execute(
        select(Notification.reference).where(
            Notification.user_id == user.id,
            Notification.reference.like("due-%"),
        ))).scalars().all())
    now = utcnow()
    for b in bills:
        ref = f"due-{b.id}"
        if ref in existing_refs:
            continue
        overdue = b.due_date < now
        days = (b.due_date.date() - now.date()).days
        when = ("متأخرة" if overdue else
                "تستحق اليوم" if days == 0 else
                "تستحق غدًا" if days == 1 else f"تستحق بعد {days} أيام")
        session.add(Notification(
            user_id=user.id, kind="bill_due",
            title=f"فاتورة {b.biller_name} {when}",
            body=(f"المبلغ {b.amount:,} د.ع".replace(",", "،") +
                  ("" if b.period else f" · {b.period}") +
                  " — دفعها الآن يوفّر عليك غرامة التأخير."),
            amount=b.amount, reference=ref, is_read=False, created_at=now,
        ))


async def _lazy_welcome(session: AsyncSession, user: User) -> None:
    """First-ever fetch for a user with no notifications → welcome message."""
    any_row = (await session.execute(
        select(Notification.id).where(Notification.user_id == user.id)
        .limit(1))).scalar_one_or_none()
    if any_row is not None:
        return
    session.add(Notification(
        user_id=user.id, kind="welcome",
        title=f"أهلاً {user.first_name} بأور پاي 👋",
        body="محفظتك جاهزة — ادفع فواتيرك، حوّل لأصدقائك، أو خلّي المساعد أور يسوي كلشي بمحادثة وحدة.",
        amount=None, reference="welcome", is_read=False, created_at=utcnow(),
    ))


def _fmt(n: int) -> str:
    return f"{n:,}".replace(",", "،")


async def _lazy_weekly_digest(session: AsyncSession, user: User) -> None:
    """One proactive spend digest per ISO week — generated on feed fetch.

    Summarises the last 7 days of outgoing spend (top category), budget
    overshoot warnings, and upcoming scheduled payments / bills due within
    7 days. Deduplicated via reference "digest-{isoyear}-W{isoweek}".
    Only created when there is something to report. Caller commits.
    """
    now = utcnow()
    iso = now.isocalendar()
    ref = f"digest-{iso[0]}-W{iso[1]}"
    seen = (await session.execute(
        select(Notification.id).where(
            Notification.user_id == user.id,
            Notification.reference == ref,
        ).limit(1))).scalar_one_or_none()
    if seen is not None:
        return

    week_ago = now - timedelta(days=7)

    # 1) last-7-day out spend per category
    cat_rows = (await session.execute(
        select(Transaction.category, func.sum(Transaction.amount))
        .where(Transaction.user_id == user.id,
               Transaction.direction == "out",
               Transaction.created_at >= week_ago)
        .group_by(Transaction.category)
        .order_by(func.sum(Transaction.amount).desc()))).all()
    week_total = sum(int(r[1] or 0) for r in cat_rows)
    top = None
    if cat_rows and cat_rows[0][1]:
        top = (CATEGORY_AR.get(cat_rows[0][0] or "other", "أخرى"), int(cat_rows[0][1]))

    # 2) budget overshoot (month-to-date)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    budget_rows = (await session.execute(
        select(Budget).where(Budget.user_id == user.id))).scalars().all()
    warnings = []
    for b in budget_rows:
        spent = (await session.scalar(
            select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                Transaction.user_id == user.id,
                Transaction.direction == "out",
                Transaction.category == b.category,
                Transaction.created_at >= month_start,
            ))) or 0
        if b.monthly_limit and spent > b.monthly_limit:
            warnings.append(
                f"تجاوزت ميزانية {CATEGORY_AR.get(b.category, b.category)} "
                f"({_fmt(spent)} من {_fmt(b.monthly_limit)})")

    # 3) upcoming scheduled payments + bills due within 7 days
    horizon = now + timedelta(days=7)
    scheduled = (await session.execute(
        select(ScheduledPayment).where(
            ScheduledPayment.user_id == user.id,
            ScheduledPayment.status == "pending",
            ScheduledPayment.next_run_at <= horizon,
        ).order_by(ScheduledPayment.next_run_at))).scalars().all()
    upcoming = [f"{_fmt(s.amount)} د.ع — {s.label} "
                f"{'غدًا' if (s.next_run_at.date() - now.date()).days == 1 else str((s.next_run_at.date() - now.date()).days) + ' يوم'}"
                for s in scheduled[:2]]
    due_bills = (await session.execute(
        select(Bill).where(
            Bill.user_id == user.id,
            Bill.status == "unpaid",
            Bill.due_date <= horizon,
        ).order_by(Bill.due_date))).scalars().all()
    for b in due_bills[:2]:
        days = (b.due_date.date() - now.date()).days
        when = ("اليوم" if days == 0 else "غدًا" if days == 1 else f"بعد {days} أيام")
        upcoming.append(f"فاتورة {b.biller_name} {when} ({_fmt(b.amount)} د.ع)")

    if week_total == 0 and not warnings and not upcoming:
        return  # nothing to report this week

    parts = []
    if week_total > 0:
        line = f"صرفك هذا الأسبوع {_fmt(week_total)} د.ع"
        if top:
            line += f" — أكثر تصنيف: {top[0]} ({_fmt(top[1])})"
        parts.append(line)
    parts.extend(f"⚠️ {w}" for w in warnings[:2])
    parts.extend(f"📅 {u}" for u in upcoming[:3])
    title = "ملخص أسبوعك مع أور 📊"
    if week_total > 0:
        title += f" — {_fmt(week_total)} د.ع"
    body = (" · ".join(parts))[:280]

    session.add(Notification(
        user_id=user.id, kind="spend_digest",
        title=title, body=body,
        amount=week_total or None, reference=ref, is_read=False, created_at=now,
    ))


async def _lazy_morning_brief(session: AsyncSession, user: User) -> None:
    """One daily morning brief — generated on the first feed fetch of the day.

    Balance + bills due today/tomorrow + scheduled payments executing within
    24h + the closest active savings goal. Deduplicated via reference
    "brief-{YYYY-MM-DD}" (server-local date). Always has the balance line,
    so it's created once every day. Caller commits.
    """
    now = utcnow()
    ref = f"brief-{now.date().isoformat()}"
    seen = (await session.execute(
        select(Notification.id).where(
            Notification.user_id == user.id,
            Notification.reference == ref,
        ).limit(1))).scalar_one_or_none()
    if seen is not None:
        return

    parts = [f"رصيدك الآن {_fmt(user.balance)} د.ع"]

    # bills due within 24h (today/tomorrow)
    horizon = now + timedelta(days=1)
    due = (await session.execute(
        select(Bill).where(
            Bill.user_id == user.id,
            Bill.status == "unpaid",
            Bill.due_date <= horizon,
        ).order_by(Bill.due_date))).scalars().all()
    for b in due[:2]:
        days = (b.due_date.date() - now.date()).days
        when = "تستحق اليوم" if days <= 0 else "تستحق غدًا"
        parts.append(f"⚠️ فاتورة {b.biller_name} {when} ({_fmt(b.amount)} د.ع)")

    # scheduled payments executing within 24h
    sched = (await session.execute(
        select(ScheduledPayment).where(
            ScheduledPayment.user_id == user.id,
            ScheduledPayment.status == "pending",
            ScheduledPayment.next_run_at <= horizon,
        ).order_by(ScheduledPayment.next_run_at))).scalars().all()
    for s in sched[:2]:
        parts.append(f"📅 بينفّذ اليوم {_fmt(s.amount)} د.ع — {s.label}")

    # nearest active savings goal (encouragement nudge)
    goal = (await session.execute(
        select(SavingsGoal).where(
            SavingsGoal.user_id == user.id,
            SavingsGoal.status == "active",
        ).order_by(SavingsGoal.saved_amount.desc()).limit(1))).scalars().first()
    if goal is not None and goal.target_amount:
        pct = round(goal.saved_amount / goal.target_amount * 100)
        parts.append(f"🎯 هدف «{goal.name}» وصّل {pct}%")

    body = (" · ".join(parts))[:280]
    session.add(Notification(
        user_id=user.id, kind="morning_brief",
        title=f"موجز يومك مع أور ☀️ — {_fmt(user.balance)} د.ع",
        body=body,
        amount=None, reference=ref, is_read=False, created_at=now,
    ))


@router.get("/notifications")
async def my_notifications(user: User = Depends(get_current_user),
                           session: AsyncSession = Depends(get_session)):
    await _lazy_welcome(session, user)
    await _lazy_due_notifications(session, user)
    await _lazy_weekly_digest(session, user)
    await _lazy_morning_brief(session, user)
    await session.commit()

    rows = (await session.execute(
        select(Notification).where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(FEED_LIMIT))).scalars().all()
    unread = (await session.execute(
        select(Notification.id).where(
            Notification.user_id == user.id,
            Notification.is_read == False,  # noqa: E712
        ))).scalars().all()
    return {
        "items": [NotificationOut(
            id=n.id, kind=n.kind, title=n.title, body=n.body,
            amount=n.amount, reference=n.reference, is_read=n.is_read,
            created_at=n.created_at.isoformat(),
        ) for n in rows],
        "unread": len(unread),
    }


@router.post("/notifications/read-all")
async def read_all(user: User = Depends(get_current_user),
                   session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(Notification).where(
            Notification.user_id == user.id,
            Notification.is_read == False,  # noqa: E712
        ))).scalars().all()
    for n in rows:
        n.is_read = True
    await session.commit()
    return {"message": "تم تعليم الكل كمقروء", "updated": len(rows)}


@router.post("/notifications/{notification_id}/read")
async def read_one(notification_id: int,
                   user: User = Depends(get_current_user),
                   session: AsyncSession = Depends(get_session)):
    n = await session.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise HTTPException(404, "الإشعار غير موجود")
    n.is_read = True
    await session.commit()
    return {"message": "تم"}
