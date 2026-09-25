"""Budget endpoints — per-category monthly spending limits."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..constants import AR_MONTHS, BUDGETABLE_CATEGORIES
from ..db import get_session
from ..models import Budget, Transaction, User, utcnow
from ..security import get_current_user

router = APIRouter(prefix="/api/budgets", tags=["budgets"])

# categories a user can put a limit on (bill categories + transfers)
BUDGETABLE = set(BUDGETABLE_CATEGORIES)


class BudgetIn(BaseModel):
    category: str
    monthly_limit: int = Field(ge=0, le=20_000_000)


def _month_start(now: datetime) -> datetime:
    return datetime(now.year, now.month, 1)


async def _month_spent(session: AsyncSession, user_id: int, category: str,
                       month_start: datetime) -> int:
    return (await session.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.user_id == user_id,
            Transaction.direction == "out",
            Transaction.category == category,
            Transaction.created_at >= month_start,
        ))) or 0


@router.get("")
async def my_budgets(user: User = Depends(get_current_user),
                     session: AsyncSession = Depends(get_session)):
    """Budget rows merged with month-to-date spend + status."""
    now = utcnow()
    start = _month_start(now)
    rows = (await session.execute(
        select(Budget).where(Budget.user_id == user.id)
        .order_by(Budget.category))).scalars().all()

    items = []
    total_limit = 0
    total_spent = 0
    for b in rows:
        spent = await _month_spent(session, user.id, b.category, start)
        pct = round(spent / b.monthly_limit * 100, 1) if b.monthly_limit else 0
        status = "over" if spent > b.monthly_limit else (
            "near" if pct >= 80 else "ok")
        total_limit += b.monthly_limit
        total_spent += spent
        items.append({
            "category": b.category,
            "monthly_limit": b.monthly_limit,
            "spent": spent,
            "remaining": b.monthly_limit - spent,
            "pct": pct,
            "status": status,
        })

    return {
        "month": AR_MONTHS[(now.month - 1) % 12],
        "month_start": start.isoformat(),
        "items": items,
        "total": {"limit": total_limit, "spent": total_spent},
        "categories": BUDGETABLE_CATEGORIES,
    }


@router.put("")
async def upsert_budget(body: BudgetIn,
                        user: User = Depends(get_current_user),
                        session: AsyncSession = Depends(get_session)):
    if body.category not in BUDGETABLE:
        raise HTTPException(422, "هذا التصنيف ما يدعم ميزانية")

    # limit of 0 removes the budget (user cleared it)
    if body.monthly_limit == 0:
        await session.execute(delete(Budget).where(
            Budget.user_id == user.id, Budget.category == body.category))
        await session.commit()
        return {"message": f"انحذفت ميزانية {body.category}", "removed": True}

    existing = (await session.execute(
        select(Budget).where(Budget.user_id == user.id,
                             Budget.category == body.category)
    )).scalar_one_or_none()
    if existing:
        existing.monthly_limit = body.monthly_limit
        existing.updated_at = utcnow()
    else:
        session.add(Budget(user_id=user.id, category=body.category,
                           monthly_limit=body.monthly_limit))
    await session.commit()
    return {
        "message": "تم تحديث الميزانية ✅",
        "budget": {"category": body.category, "monthly_limit": body.monthly_limit},
        "removed": False,
    }
