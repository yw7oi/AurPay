"""Savings goals — earmarked money (أهداف التوفير).

A goal holds money moved OUT of the spendable wallet balance. Deposits and
withdrawals are PIN-verified and recorded as transactions with
category='savings' (excluded from spending analytics — the money isn't
spent, it's earmarked). A goal auto-completes when its target is reached.
"""
import secrets
import string

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import SavingsGoal, Transaction, User, utcnow
from ..notify import notify
from ..security import get_current_user, verify_pin

router = APIRouter(prefix="/api/goals", tags=["goals"])

REF_ALPHABET = string.ascii_uppercase + string.digits


def new_ref() -> str:
    return "UR-" + "".join(secrets.choice(REF_ALPHABET) for _ in range(8))

MIN_DEPOSIT = 1_000
MAX_DEPOSIT = 5_000_000
MAX_GOALS = 8
ALLOWED_EMOJI = {"🎯", "🕌", "✈️", "🎓", "🚗", "🏠", "💍", "📱", "💻", "👶", "🏝️", "🎁"}
DEFAULT_EMOJI = "🎯"


def _fmt(n: int) -> str:
    return f"{n:,}".replace(",", "،")


def _goal_dict(g: SavingsGoal) -> dict:
    pct = round(g.saved_amount / g.target_amount * 100, 1) if g.target_amount else 0
    return {
        "id": g.id, "name": g.name, "emoji": g.emoji,
        "target_amount": g.target_amount, "saved_amount": g.saved_amount,
        "remaining": max(0, g.target_amount - g.saved_amount),
        "pct": min(pct, 100.0),
        "status": g.status,
        "created_at": g.created_at.isoformat(),
    }


def _receipt(ref: str, title: str, amount: int, balance_after: int) -> dict:
    return {
        "reference": ref, "title": title, "subtitle": "",
        "amount": amount, "balance_after": balance_after,
        "created_at": utcnow().isoformat(),
    }


async def _get_goal(session: AsyncSession, user: User, goal_id: int) -> SavingsGoal:
    g = await session.get(SavingsGoal, goal_id)
    if g is None or g.user_id != user.id:
        raise HTTPException(404, "الهدف غير موجود")
    return g


@router.get("")
async def list_goals(user: User = Depends(get_current_user),
                     session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(SavingsGoal).where(SavingsGoal.user_id == user.id)
        .order_by(SavingsGoal.status.desc(), SavingsGoal.created_at))).scalars().all()
    items = [_goal_dict(g) for g in rows]
    return {
        "items": items,
        "totals": {
            "count": len(items),
            "target": sum(g.target_amount for g in rows),
            "saved": sum(g.saved_amount for g in rows),
        },
    }


class GoalCreate(BaseModel):
    name: str = Field(min_length=2, max_length=48)
    target_amount: int = Field(ge=10_000, le=100_000_000)
    emoji: str = DEFAULT_EMOJI


@router.post("", status_code=201)
async def create_goal(body: GoalCreate,
                     user: User = Depends(get_current_user),
                     session: AsyncSession = Depends(get_session)):
    count = len((await session.execute(
        select(SavingsGoal.id).where(SavingsGoal.user_id == user.id))).scalars().all())
    if count >= MAX_GOALS:
        raise HTTPException(422, f"عندك الحد الأقصى {MAX_GOALS} أهداف — احذف واحد أولًا")
    emoji = body.emoji if body.emoji in ALLOWED_EMOJI else DEFAULT_EMOJI
    g = SavingsGoal(
        user_id=user.id, name=body.name.strip(), emoji=emoji,
        target_amount=body.target_amount, saved_amount=0,
        status="active", created_at=utcnow(),
    )
    session.add(g)
    await session.commit()
    await session.refresh(g)
    return {"message": f"انشاء هدف «{g.name}» — وفّر له {_fmt(g.target_amount)} د.ع", "goal": _goal_dict(g)}


class GoalDeposit(BaseModel):
    amount: int = Field(ge=MIN_DEPOSIT, le=MAX_DEPOSIT)
    pin: str


@router.post("/{goal_id}/deposit")
async def deposit_goal(goal_id: int, body: GoalDeposit,
                       user: User = Depends(get_current_user),
                       session: AsyncSession = Depends(get_session)):
    if not verify_pin(body.pin, user.pin_salt, user.pin_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "رمز الـ PIN غير صحيح")
    g = await _get_goal(session, user, goal_id)
    if user.balance < body.amount:
        raise HTTPException(400, "رصيدك ما يكفي — عبّي المحفظة أولًا")

    now = utcnow()
    ref = new_ref()
    user.balance -= body.amount
    g.saved_amount += body.amount
    g.updated_at = now

    just_reached = g.status == "active" and g.saved_amount >= g.target_amount
    if just_reached:
        g.status = "completed"

    session.add(Transaction(
        reference=ref, user_id=user.id, type="goal_deposit", direction="out",
        amount=body.amount, balance_after=user.balance,
        title=f"توفير — {g.name}", subtitle="إيداع بالهدف" + (" 🎉 اكتمل!" if just_reached else ""),
        category="savings", created_at=now,
    ))
    if just_reached:
        notify(session, user.id, kind="goal_reached",
               title=f"وصلت لهدفك «{g.name}» 🎉",
               body=(f"وفّرت {_fmt(g.saved_amount)} من {_fmt(g.target_amount)} د.ع — "
                     "مبروك! تقدر تسحب التوفير لمحفظتك وقتما تحب."),
               amount=g.saved_amount, reference=f"goal-{g.id}")
    await session.commit()
    return {
        "message": (f"وفّرت {_fmt(body.amount)} د.ع لهدف «{g.name}»" +
                    (" — واكتمل الهدف 🎉" if just_reached else "")),
        "goal": _goal_dict(g),
        "receipt": _receipt(ref, f"توفير — {g.name}", body.amount, user.balance),
    }


class GoalWithdraw(BaseModel):
    amount: int | None = Field(default=None, ge=MIN_DEPOSIT, le=MAX_DEPOSIT)
    pin: str


@router.post("/{goal_id}/withdraw")
async def withdraw_goal(goal_id: int, body: GoalWithdraw,
                        user: User = Depends(get_current_user),
                        session: AsyncSession = Depends(get_session)):
    if not verify_pin(body.pin, user.pin_salt, user.pin_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "رمز الـ PIN غير صحيح")
    g = await _get_goal(session, user, goal_id)
    amount = body.amount if body.amount is not None else g.saved_amount
    if amount <= 0 or amount > g.saved_amount:
        raise HTTPException(422, f"المبلغ يجب أن يكون بين {_fmt(MIN_DEPOSIT)} و {_fmt(g.saved_amount)} د.ع")

    now = utcnow()
    ref = new_ref()
    user.balance += amount
    g.saved_amount -= amount
    g.updated_at = now
    if g.status == "completed" and g.saved_amount < g.target_amount:
        g.status = "active"  # reflect reality after a big withdrawal

    session.add(Transaction(
        reference=ref, user_id=user.id, type="goal_withdraw", direction="in",
        amount=amount, balance_after=user.balance,
        title=f"سحب من هدف «{g.name}»", subtitle="رجعة التوفير للمحفظة",
        category="savings", created_at=now,
    ))
    await session.commit()
    return {
        "message": f"رجّعنا {_fmt(amount)} د.ع من «{g.name}» لمحفظتك",
        "goal": _goal_dict(g),
        "receipt": _receipt(ref, f"سحب من هدف «{g.name}»", amount, user.balance),
    }


class GoalDelete(BaseModel):
    pin: str


@router.post("/{goal_id}/delete")
async def delete_goal(goal_id: int, body: GoalDelete,
                      user: User = Depends(get_current_user),
                      session: AsyncSession = Depends(get_session)):
    if not verify_pin(body.pin, user.pin_salt, user.pin_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "رمز الـ PIN غير صحيح")
    g = await _get_goal(session, user, goal_id)
    saved_before = g.saved_amount

    # return any earmarked money back to the wallet first
    if saved_before > 0:
        now = utcnow()
        ref = new_ref()
        user.balance += saved_before
        session.add(Transaction(
            reference=ref, user_id=user.id, type="goal_withdraw", direction="in",
            amount=saved_before, balance_after=user.balance,
            title=f"سحب وإنهاء هدف «{g.name}»", subtitle="إغلاق الهدف ورجعة التوفير",
            category="savings", created_at=now,
        ))
    await session.delete(g)
    await session.commit()
    return {"message": f"انحذف هدف «{g.name}»" + (" ورجّعنا توفيره لمحفظتك" if saved_before > 0 else "")}
