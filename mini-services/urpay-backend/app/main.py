"""UrPay backend — FastAPI app entry point."""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db, session_factory
from .routers import (agent, analytics, auth, budgets, favorites, notifications,
                      public, scheduled, wallet)
from .scheduler import scheduler_loop
from .seed import seed_if_empty

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()
    async with session_factory() as session:
        result = await seed_if_empty(session)
        logging.getLogger("urpay").info("DB ready: %s", result)
        await _ensure_demo_scheduled(session)
        await _ensure_demo_new_categories(session)
    # background scheduled-payment executor (every 20s)
    sched_task = asyncio.create_task(scheduler_loop(session_factory))
    yield
    sched_task.cancel()


async def _ensure_demo_scheduled(session) -> None:
    """Give the demo user two showcase scheduled mandates (once, idempotent)."""
    from sqlalchemy import select

    from .models import ScheduledPayment, User, utcnow

    demo = (await session.execute(
        select(User).where(User.is_demo == True)  # noqa: E712
        .order_by(User.id).limit(1))).scalar_one_or_none()
    if demo is None:
        return
    has = (await session.execute(
        select(ScheduledPayment.id).where(
            ScheduledPayment.user_id == demo.id,
            ScheduledPayment.status == "pending")
        .limit(1))).scalar_one_or_none()
    if has:
        return

    zainab = (await session.execute(
        select(User).where(User.is_demo == True,  # noqa: E712
                           User.full_name.like("%زينب%"))
        .order_by(User.id).limit(1))).scalar_one_or_none()

    now = utcnow()
    y, m = (now.year, now.month + 1) if now.month < 12 else (now.year + 1, 1)
    first_next_month = now.replace(year=y, month=m, day=1, hour=9, minute=0,
                                   second=0, microsecond=0)

    session.add(ScheduledPayment(
        user_id=demo.id, kind="bill", category="electricity",
        biller_code="MOE-BGD-R", biller_name="وزارة الكهرباء — بغداد الرصافة",
        subscriber_no="77881234", amount=45_000, frequency="monthly",
        next_run_at=first_next_month, status="pending", created_at=now))
    if zainab is not None:
        session.add(ScheduledPayment(
            user_id=demo.id, kind="transfer", receiver_card=zainab.card_number,
            receiver_name=zainab.full_name, amount=100_000, frequency="once",
            next_run_at=now.replace(hour=9, minute=0, second=0, microsecond=0)
            .replace(day=min(now.day + 3, 28)),
            status="pending", created_at=now))
    await session.commit()


async def _ensure_demo_new_categories(session) -> None:
    """Showcase bills for the health & gas categories (once, idempotent),
    and keep the demo wallet stocked with unpaid bills for judges."""
    from datetime import timedelta

    from sqlalchemy import func, select

    from .models import Bill, User, utcnow

    demo = (await session.execute(
        select(User).where(User.is_demo == True)  # noqa: E712
        .order_by(User.id).limit(1))).scalar_one_or_none()
    if demo is None:
        return
    has_health = (await session.execute(
        select(Bill.id).where(Bill.user_id == demo.id, Bill.category == "health")
        .limit(1))).scalar_one_or_none()
    now = utcnow()
    if has_health is None:
        session.add(Bill(
            user_id=demo.id, category="health", biller_code="HLT-KARAMA",
            biller_name="مستشفى الكرامة التعليمي", subscriber_no="55210077",
            amount=65_000, period=f"زيارة {now.year}",
            due_date=now.replace(microsecond=0) + timedelta(days=4),
            status="unpaid", issued_at=now))
        session.add(Bill(
            user_id=demo.id, category="health", biller_code="HLT-BGDLAB",
            biller_name="مركز بغداد للفحوصات الطبية", subscriber_no="88341002",
            amount=38_000, period=f"فحوصات {now.year}",
            due_date=now.replace(microsecond=0) + timedelta(days=9),
            status="unpaid", issued_at=now))
    has_gas = (await session.execute(
        select(Bill.id).where(Bill.user_id == demo.id, Bill.category == "gas")
        .limit(1))).scalar_one_or_none()
    if has_gas is None:
        session.add(Bill(
            user_id=demo.id, category="gas", biller_code="GAS-BGD",
            biller_name="غاز بغداد — نقاط البيع", subscriber_no="33019045",
            amount=12_000, period=f"أسطوانات {now.year}",
            due_date=now.replace(microsecond=0) + timedelta(days=6),
            status="unpaid", issued_at=now))

    # --- keep classic unpaid bills stocked for the demo (QA rounds pay them) --
    unpaid_total = (await session.execute(
        select(func.count(Bill.id)).where(
            Bill.user_id == demo.id, Bill.status == "unpaid"))).scalar() or 0
    if unpaid_total < 5:
        for spec in (
            ("electricity", "MOE-BGD-R", "وزارة الكهرباء — بغداد الرصافة",
             "77881234", 58_000, 3, "حصة أيلول"),
            ("internet", "NET-TARIN", "تارين للاتصالات Tarin",
             "44550132", 45_000, 6, "اشتراك أيلول"),
            ("water", "MOW-BGD", "ماء بغداد — عامة الماء",
             "99112008", 9_500, 8, "قراءة أيلول"),
        ):
            has_cat_unpaid = (await session.execute(
                select(Bill.id).where(
                    Bill.user_id == demo.id, Bill.category == spec[0],
                    Bill.status == "unpaid").limit(1))).scalar_one_or_none()
            if has_cat_unpaid is None:
                session.add(Bill(
                    user_id=demo.id, category=spec[0], biller_code=spec[1],
                    biller_name=spec[2], subscriber_no=spec[3], amount=spec[4],
                    period=f"{spec[6]} {now.year}",
                    due_date=now.replace(microsecond=0) + timedelta(days=spec[5]),
                    status="unpaid", issued_at=now))
    await session.commit()


app = FastAPI(
    title="UrPay API",
    description="UrPay (أور پاي) — Iraqi agentic payments platform backend",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public.router)
app.include_router(auth.router)
app.include_router(wallet.router)
app.include_router(notifications.router)
app.include_router(analytics.router)
app.include_router(budgets.router)
app.include_router(scheduled.router)
app.include_router(favorites.router)
app.include_router(agent.router)


@app.get("/")
async def root():
    return {"service": "UrPay API", "docs": "/docs", "health": "/api/health"}
