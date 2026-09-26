"""Public endpoints — stats, billers, cities, health."""
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..constants import BILLERS, CATEGORIES, CITIES
from ..db import get_session
from ..models import Bill, Transaction, User

router = APIRouter(prefix="/api", tags=["public"])


@router.get("/health")
async def health():
    return {"status": "ok", "service": "urpay-backend"}


@router.get("/stats")
async def stats(session: AsyncSession = Depends(get_session)):
    users = await session.scalar(select(func.count(User.id))) or 0
    txns = await session.scalar(select(func.count(Transaction.id))) or 0
    volume = await session.scalar(
        select(func.sum(Transaction.amount)).where(
            Transaction.direction == "out")) or 0
    paid = await session.scalar(
        select(func.count(Bill.id)).where(Bill.status == "paid")) or 0

    demo = (await session.execute(
        select(User).where(User.is_demo == True).order_by(User.id).limit(1)  # noqa: E712
    )).scalar_one_or_none()

    return {
        "users": users,
        "transactions": txns,
        "volume_iqd": volume,
        "bills_paid": paid,
        "demo": {
            "full_name": demo.full_name,
            "card_number": demo.card_number,
            "pin": "123456",
            "city": demo.city,
        } if demo else None,
    }


@router.get("/billers")
async def billers():
    return {
        "categories": CATEGORIES,
        "billers": BILLERS,
    }


@router.get("/cities")
async def cities():
    return {"cities": CITIES}
