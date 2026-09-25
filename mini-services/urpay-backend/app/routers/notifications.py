"""Notifications center — bell icon feed.

Notifications are pushed by wallet/agent actions (see app/notify.py) and
lazily generated for bill due-dates when the feed is fetched.
"""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Bill, Notification, User, utcnow
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


@router.get("/notifications")
async def my_notifications(user: User = Depends(get_current_user),
                           session: AsyncSession = Depends(get_session)):
    await _lazy_welcome(session, user)
    await _lazy_due_notifications(session, user)
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
