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
