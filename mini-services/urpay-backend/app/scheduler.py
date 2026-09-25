"""Scheduled payment executor.

A background asyncio task scans for due pending mandates every 20 seconds and
executes them (bill payment or transfer) without a PIN — the mandate was
already PIN-authorized at creation time. Also exposes run_due_scheduled()
for lazy housekeeping on API list calls (covers downtime gaps).
"""
import asyncio
import logging
import secrets
import string
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .budget import check_budget_crossing
from .models import Bill, ScheduledPayment, Transaction, User, utcnow
from .notify import notify

log = logging.getLogger("urpay.scheduler")

REF_ALPHABET = string.ascii_uppercase + string.digits
INTERVAL_SECONDS = 20
MIN_AHEAD = timedelta(seconds=30)   # minimum lead time when creating
MAX_AHEAD = timedelta(days=365)     # max scheduling horizon


def new_ref() -> str:
    return "UR-" + "".join(secrets.choice(REF_ALPHABET) for _ in range(8))


def _next_month(dt):
    """Same day next month (clamped to month length), 09:00 for bill runs."""
    y, m = dt.year, dt.month + 1
    if m > 12:
        y, m = y + 1, 1
    day = min(dt.day, [31, 29 if y % 4 == 0 and (y % 100 != 0 or y % 400 == 0) else 28,
                       31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
    return dt.replace(year=y, month=m, day=day)


async def execute_one(session: AsyncSession, sp: ScheduledPayment,
                      user: User) -> None:
    """Execute a due scheduled payment. Caller owns the transaction/commit."""
    now = utcnow()
    ref = new_ref()

    if sp.kind == "bill":
        if user.balance < sp.amount:
            sp.status = "failed"
            sp.last_run_at = now
            notify(session, user.id, kind="scheduled_failed",
                   title="تعذّر تنفيذ دفعة مجدولة",
                   body=(f"رصيدك ما يكفي لـ{sp.label} بمبلغ "
                         f"{sp.amount:,} د.ع — عبّي محفظتك وأعد جدولتها.".replace(",", "،")),
                   amount=sp.amount, reference=f"sch-{sp.id}")
            return

        user.balance -= sp.amount
        bill = Bill(
            user_id=user.id, category=sp.category, biller_code=sp.biller_code,
            biller_name=sp.biller_name, subscriber_no=sp.subscriber_no,
            amount=sp.amount, period="دفعة مجدولة تلقائيًا",
            due_date=now, status="paid", issued_at=now, paid_at=now,
            receipt_ref=ref,
        )
        session.add(bill)
        await session.flush()
        session.add(Transaction(
            reference=ref, user_id=user.id, type="bill_payment", direction="out",
            amount=sp.amount, balance_after=user.balance,
            title=sp.label, subtitle="دفع مجدول تلقائيًا",
            category=sp.category, bill_id=bill.id, created_at=now,
        ))
        notify(session, user.id, kind="scheduled_executed",
               title=f"نُفّذت دفعتك المجدولة — {sp.biller_name}",
               body=(f"دفعنا عنك {sp.amount:,} د.ع · المرجع {ref} · "
                     f"رصيدك الآن {user.balance:,} د.ع").replace(",", "،"),
               amount=sp.amount, reference=ref)
        await check_budget_crossing(session, user, sp.category, sp.amount)

    elif sp.kind == "transfer":
        receiver = (await session.execute(
            select(User).where(User.card_number == sp.receiver_card)
        )).scalar_one_or_none()
        if receiver is None or receiver.id == user.id or user.balance < sp.amount:
            sp.status = "failed"
            sp.last_run_at = now
            reason = "المستلم غير متوفر حاليًا" if receiver is None else "رصيدك ما يكفي"
            notify(session, user.id, kind="scheduled_failed",
                   title="تعذّر تنفيذ حوالة مجدولة",
                   body=(f"{sp.label} بمبلغ {sp.amount:,} د.ع — {reason}. "
                         "أعد الجدولة بعد التحقق.").replace(",", "،"),
                   amount=sp.amount, reference=f"sch-{sp.id}")
            return

        user.balance -= sp.amount
        receiver.balance += sp.amount
        session.add(Transaction(
            reference=ref, user_id=user.id, type="transfer_out", direction="out",
            amount=sp.amount, balance_after=user.balance,
            title=f"حوالة مجدولة إلى {receiver.full_name}",
            subtitle=f"بطاقة •••• {receiver.card_number[-4:]} · تلقائيًا",
            category="transfer", counterparty_id=receiver.id, created_at=now))
        session.add(Transaction(
            reference=ref, user_id=receiver.id, type="transfer_in", direction="in",
            amount=sp.amount, balance_after=receiver.balance,
            title=f"حوالة مجدولة من {user.full_name}",
            subtitle=f"بطاقة •••• {user.card_number[-4:]} · تلقائيًا",
            category="transfer", counterparty_id=user.id, created_at=now))
        notify(session, receiver.id, kind="transfer_in",
               title=f"وصلتك حوالة مجدولة من {user.full_name}",
               body=f"المبلغ انضاف لرصيدك · المرجع {ref}",
               amount=sp.amount, reference=ref)
        notify(session, user.id, kind="scheduled_executed",
               title=f"نُفّذت حوالتك المجدولة إلى {receiver.full_name}",
               body=(f"حوّلنا عنك {sp.amount:,} د.ع · المرجع {ref} · "
                     f"رصيدك الآن {user.balance:,} د.ع").replace(",", "،"),
               amount=sp.amount, reference=ref)
        await check_budget_crossing(session, user, "transfer", sp.amount)

    # success → schedule the next run or finish
    sp.last_run_at = now
    if sp.frequency == "monthly":
        sp.next_run_at = _next_month(now)
    else:
        sp.status = "executed"


async def run_due_scheduled(session: AsyncSession) -> int:
    """Find + execute all due pending mandates. Returns count executed."""
    now = utcnow()
    due = (await session.execute(
        select(ScheduledPayment).where(
            ScheduledPayment.status == "pending",
            ScheduledPayment.next_run_at <= now,
        ).order_by(ScheduledPayment.next_run_at).limit(25)
    )).scalars().all()
    if not due:
        return 0

    count = 0
    for sp in due:
        user = await session.get(User, sp.user_id)
        if user is None:
            sp.status = "failed"
            continue
        try:
            await execute_one(session, sp, user)
            count += 1
        except Exception as e:  # one bad mandate must never block the rest
            log.warning("scheduled %s failed: %s", sp.id, e)
            sp.status = "failed"
    await session.commit()
    if count:
        log.info("scheduler executed %d scheduled payment(s)", count)
    return count


async def scheduler_loop(session_factory) -> None:
    """Background task — started from the FastAPI lifespan."""
    while True:
        await asyncio.sleep(INTERVAL_SECONDS)
        try:
            async with session_factory() as session:
                await run_due_scheduled(session)
        except Exception as e:  # keep the loop alive no matter what
            log.warning("scheduler loop error: %s", e)
