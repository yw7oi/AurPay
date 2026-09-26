"""Scheduled payments — PIN-authorized mandates executed automatically."""
import secrets
import string
from datetime import datetime, timedelta

from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import ScheduledPayment, User, utcnow
from ..scheduler import MAX_AHEAD, MIN_AHEAD, run_due_scheduled
from ..security import get_current_user, verify_pin

router = APIRouter(prefix="/api", tags=["scheduled"])


def _sp_dict(sp: ScheduledPayment) -> dict:
    return {
        "id": sp.id, "kind": sp.kind, "label": sp.label,
        "category": sp.category, "biller_name": sp.biller_name,
        "subscriber_no": sp.subscriber_no,
        "receiver_name": sp.receiver_name,
        "receiver_card_masked": (f"•••• {sp.receiver_card[-4:]}"
                                 if sp.receiver_card else ""),
        "amount": sp.amount, "frequency": sp.frequency,
        "next_run_at": sp.next_run_at.isoformat() if sp.next_run_at else None,
        "last_run_at": sp.last_run_at.isoformat() if sp.last_run_at else None,
        "status": sp.status, "created_at": sp.created_at.isoformat(),
    }


class ScheduleCreate(BaseModel):
    kind: str = Field(pattern="^(bill|transfer)$")
    biller_code: str = ""
    subscriber_no: str = ""
    receiver_card: str = ""
    amount: int = Field(gt=1000, le=5_000_000)
    execute_at: str  # ISO datetime (UTC from the client)
    frequency: str = Field(default="once", pattern="^(once|monthly)$")
    pin: str


@router.get("/scheduled")
async def list_scheduled(user: User = Depends(get_current_user),
                         session: AsyncSession = Depends(get_session)):
    # lazy housekeeping — executes anything due (covers scheduler downtime)
    await run_due_scheduled(session)

    # pending list INCLUDES paused rows so the user can see & resume them;
    # totals only count actually-runnable (pending) mandates.
    pending = (await session.execute(
        select(ScheduledPayment).where(
            ScheduledPayment.user_id == user.id,
            ScheduledPayment.status.in_(["pending", "paused"]),
        ).order_by(ScheduledPayment.next_run_at))).scalars().all()
    history = (await session.execute(
        select(ScheduledPayment).where(
            ScheduledPayment.user_id == user.id,
            ScheduledPayment.status.notin_(["pending", "paused"]),
        ).order_by(ScheduledPayment.last_run_at.desc(),
                   ScheduledPayment.created_at.desc()).limit(8))).scalars().all()

    runnable = [sp for sp in pending if sp.status == "pending"]
    monthly_total = sum(sp.amount for sp in runnable if sp.frequency == "monthly")
    return {
        "pending": [_sp_dict(sp) for sp in pending],
        "history": [_sp_dict(sp) for sp in history],
        "monthly_total": monthly_total,
        "pending_total": sum(sp.amount for sp in runnable),
    }


@router.post("/scheduled", status_code=201)
async def create_scheduled(body: ScheduleCreate,
                           user: User = Depends(get_current_user),
                           session: AsyncSession = Depends(get_session)):
    if not verify_pin(body.pin, user.pin_salt, user.pin_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "رمز الـ PIN غير صحيح")

    # parse the execution time (accept both "Z" and naive ISO)
    try:
        when = datetime.fromisoformat(body.execute_at.replace("Z", "+00:00"))
        if when.tzinfo is not None:
            when = when.astimezone(tz=None).replace(tzinfo=None)
    except ValueError:
        raise HTTPException(422, "صيغة التاريخ غير صحيحة — استخدم ISO")

    now = utcnow()
    if when < now + MIN_AHEAD:
        when = now + MIN_AHEAD  # clamp near-instant scheduling
    if when > now + MAX_AHEAD:
        raise HTTPException(422, "ما تصير جدولة أبعد من سنة")

    category = biller_name = receiver_name = ""

    if body.kind == "bill":
        from ..constants import BILLERS
        biller = next((b for bs in BILLERS.values() for b in bs
                       if b["code"] == body.biller_code), None)
        if biller is None:
            raise HTTPException(404, "الجهة غير موجودة — تحقق من قائمة الجهات")
        category = next((cat for cat, bs in BILLERS.items()
                         if any(b["code"] == biller["code"] for b in bs)), "")
        biller_name = biller["name"]
    else:
        card = "".join(ch for ch in body.receiver_card if ch.isdigit())
        if len(card) != 16:
            raise HTTPException(422, "رقم بطاقة المستلم يجب أن يكون 16 رقمًا")
        receiver = (await session.execute(
            select(User).where(User.card_number == card)
        )).scalar_one_or_none()
        if receiver is None:
            raise HTTPException(404, "المستلم غير موجود — تحقق من رقم البطاقة")
        if receiver.id == user.id:
            raise HTTPException(405, "ما تصير تحوّل لنفسك 😅")
        body.receiver_card = card
        receiver_name = receiver.full_name

    sp = ScheduledPayment(
        user_id=user.id, kind=body.kind,
        category=category, biller_code=body.biller_code,
        biller_name=biller_name,
        subscriber_no=body.subscriber_no or "".join(
            secrets.choice(string.digits) for _ in range(8)),
        receiver_card=body.receiver_card if body.kind == "transfer" else "",
        receiver_name=receiver_name,
        amount=body.amount, frequency=body.frequency,
        next_run_at=when, status="pending", created_at=now,
    )
    session.add(sp)
    await session.commit()
    await session.refresh(sp)
    return {"message": "تم إنشاء الجدولة — ستنفّذ تلقائيًا بوقتها", "scheduled": _sp_dict(sp)}


@router.post("/scheduled/{sp_id}/cancel")
async def cancel_scheduled(sp_id: int,
                           user: User = Depends(get_current_user),
                           session: AsyncSession = Depends(get_session)):
    sp = await session.get(ScheduledPayment, sp_id)
    if sp is None or sp.user_id != user.id or sp.status not in ("pending", "paused"):
        raise HTTPException(404, "الجدولة غير موجودة أو منتهية")
    sp.status = "cancelled"
    await session.commit()
    return {"message": "تم إلغاء الجدولة"}


@router.post("/scheduled/{sp_id}/pause")
async def pause_scheduled(sp_id: int,
                          user: User = Depends(get_current_user),
                          session: AsyncSession = Depends(get_session)):
    """Freeze a pending mandate — the scheduler skips it until resumed."""
    sp = await session.get(ScheduledPayment, sp_id)
    if sp is None or sp.user_id != user.id or sp.status != "pending":
        raise HTTPException(404, "الجدولة غير موجودة أو موقوفة سابقًا")
    sp.status = "paused"
    await session.commit()
    return {"message": "تم إيقاف الجدولة مؤقتًا — استأنفها وقتما تحب", "scheduled": _sp_dict(sp)}


@router.post("/scheduled/{sp_id}/resume")
async def resume_scheduled(sp_id: int,
                           user: User = Depends(get_current_user),
                           session: AsyncSession = Depends(get_session)):
    """Un-freeze a paused mandate. If its time passed while paused, re-arm
    it to +5 minutes so it doesn't fire the instant it's resumed."""
    sp = await session.get(ScheduledPayment, sp_id)
    if sp is None or sp.user_id != user.id or sp.status != "paused":
        raise HTTPException(404, "الجدولة غير موقوفة")
    now = utcnow()
    if sp.next_run_at < now + MIN_AHEAD:
        sp.next_run_at = now + timedelta(minutes=5)
    sp.status = "pending"
    await session.commit()
    await session.refresh(sp)
    return {"message": "تم استئناف الجدولة", "scheduled": _sp_dict(sp)}


class ScheduleEdit(BaseModel):
    """Change a pending mandate's amount and/or next run (PIN-verified)."""
    amount: int | None = Field(default=None, gt=1000, le=5_000_000)
    execute_at: str | None = None  # ISO datetime
    pin: str


@router.post("/scheduled/{sp_id}/edit")
async def edit_scheduled(sp_id: int, body: ScheduleEdit,
                         user: User = Depends(get_current_user),
                         session: AsyncSession = Depends(get_session)):
    sp = await session.get(ScheduledPayment, sp_id)
    if sp is None or sp.user_id != user.id or sp.status not in ("pending", "paused"):
        raise HTTPException(404, "الجدولة غير موجودة أو منتهية")
    if not verify_pin(body.pin, user.pin_salt, user.pin_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "رمز الـ PIN غير صحيح")

    if body.amount is None and body.execute_at is None:
        raise HTTPException(422, "لا يوجد تغيير — أرسل مبلغًا أو تاريخًا جديدًا")

    when = sp.next_run_at
    if body.execute_at:
        try:
            when = datetime.fromisoformat(body.execute_at.replace("Z", "+00:00"))
            if when.tzinfo is not None:
                when = when.astimezone(tz=None).replace(tzinfo=None)
        except ValueError:
            raise HTTPException(422, "صيغة التاريخ غير صحيحة — استخدم ISO")
        now = utcnow()
        if when < now + MIN_AHEAD:
            when = now + MIN_AHEAD  # clamp near-instant
        if when > now + MAX_AHEAD:
            raise HTTPException(422, "ما تصير جدولة أبعد من سنة")

    if body.amount is not None:
        sp.amount = body.amount
    sp.next_run_at = when
    await session.commit()
    await session.refresh(sp)
    return {"message": "تم تعديل الجدولة", "scheduled": _sp_dict(sp)}
