"""Analytics endpoint — spending breakdown + monthly trend."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Bill, Transaction, User, utcnow
from ..security import get_current_user

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

AR_MONTHS_SHORT = [
    "ك2", "شباط", "آذار", "نيسان", "أيار", "حزيران",
    "تموز", "آب", "أيلول", "ت1", "ت2", "ك1",
]


@router.get("")
async def my_analytics(user: User = Depends(get_current_user),
                       session: AsyncSession = Depends(get_session)):
    now = utcnow()
    window_start = now - timedelta(days=90)

    # spending by category (last 90 days, outgoing only)
    cat_rows = (await session.execute(
        select(Transaction.category, func.sum(Transaction.amount), func.count(Transaction.id))
        .where(Transaction.user_id == user.id,
               Transaction.direction == "out",
               Transaction.created_at >= window_start)
        .group_by(Transaction.category)
        .order_by(func.sum(Transaction.amount).desc())
    )).all()

    categories = [{
        "category": c or "other",
        "total": total or 0,
        "count": count or 0,
    } for c, total, count in cat_rows]
    spend_total = sum(c["total"] for c in categories)

    # monthly trend (last 6 months, in/out)
    def month_start(back: int):
        y, m = now.year, now.month - back
        while m <= 0:
            m += 12
            y -= 1
        return datetime(y, m, 1)

    months: list[dict] = []
    for back in range(5, -1, -1):
        start = month_start(back)
        end = month_start(back - 1)
        out_sum = await session.scalar(
            select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                Transaction.user_id == user.id,
                Transaction.direction == "out",
                Transaction.created_at >= start,
                Transaction.created_at < end,
            )) or 0
        in_sum = await session.scalar(
            select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                Transaction.user_id == user.id,
                Transaction.direction == "in",
                Transaction.created_at >= start,
                Transaction.created_at < end,
            )) or 0
        months.append({
            "label": AR_MONTHS_SHORT[(start.month - 1) % 12],
            "out": int(out_sum),
            "in": int(in_sum),
        })

    # bill status breakdown
    unpaid_count = await session.scalar(
        select(func.count(Bill.id)).where(
            Bill.user_id == user.id, Bill.status == "unpaid")) or 0
    unpaid_total = await session.scalar(
        select(func.coalesce(func.sum(Bill.amount), 0)).where(
            Bill.user_id == user.id, Bill.status == "unpaid")) or 0
    overdue_count = await session.scalar(
        select(func.count(Bill.id)).where(
            Bill.user_id == user.id, Bill.status == "unpaid",
            Bill.due_date < now)) or 0

    # transfer counterparties (top receivers last 90d)
    top_rows = (await session.execute(
        select(Transaction.counterparty_id, func.sum(Transaction.amount), func.count(Transaction.id))
        .where(Transaction.user_id == user.id,
               Transaction.type == "transfer_out",
               Transaction.created_at >= window_start,
               Transaction.counterparty_id.isnot(None))
        .group_by(Transaction.counterparty_id)
        .order_by(func.sum(Transaction.amount).desc())
        .limit(3)
    )).all()

    top_counterparties = []
    for cp_id, total, count in top_rows:
        cp = await session.get(User, cp_id)
        if cp:
            top_counterparties.append({
                "name": cp.full_name,
                "total": total or 0,
                "count": count or 0,
                "avatar_hue": cp.avatar_hue,
            })

    return {
        "window_days": 90,
        "spend_total": spend_total,
        "categories": categories,
        "months": months,
        "bills": {
            "unpaid_count": unpaid_count,
            "unpaid_total": unpaid_total,
            "overdue_count": overdue_count,
        },
        "top_counterparties": top_counterparties,
    }
