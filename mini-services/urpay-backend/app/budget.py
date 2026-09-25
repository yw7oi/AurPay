"""Budget helpers shared by wallet router + agent tools."""
import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .constants import CATEGORY_AR
from .models import Budget, Transaction, User, utcnow
from .notify import notify

log = logging.getLogger("urpay.budget")


async def check_budget_crossing(session: AsyncSession, user: User,
                                category: str, paid_amount: int) -> dict | None:
    """Call AFTER a successful outgoing txn of `paid_amount` in `category`
    has been added to the session (uncommitted). If this payment is the one
    that pushes month-to-date spend past the user's limit, fire a
    budget_exceeded notification. Returns the crossing info or None.

    Must run BEFORE session.commit() so the fresh txn is visible to the
    aggregate query (autoflush includes pending objects).
    """
    now = utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    budget = (await session.execute(
        select(Budget).where(Budget.user_id == user.id,
                             Budget.category == category)
    )).scalar_one_or_none()
    if budget is None or budget.monthly_limit <= 0:
        return None

    spent_now = (await session.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.user_id == user.id,
            Transaction.direction == "out",
            Transaction.category == category,
            Transaction.created_at >= month_start,
        ))) or 0

    spent_before = spent_now - paid_amount
    # fire only on the crossing event (not on every payment after)
    if spent_before <= budget.monthly_limit < spent_now:
        over = spent_now - budget.monthly_limit
        notify(
            session, user.id, kind="budget_exceeded",
            title=f"تجاوزت ميزانية {CATEGORY_AR.get(category, category)}",
            body=(f"صرفك لهذا الشهر {spent_now:,} د.ع من حد "
                  f"{budget.monthly_limit:,} د.ع (+{over:,}).".replace(",", "،")),
            amount=spent_now,
            reference=f"budget-{category}-{now.year}-{now.month}",
        )
        return {"category": category, "limit": budget.monthly_limit,
                "spent": spent_now, "over": over}
    return None
