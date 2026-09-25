"""Wallet endpoints — bills, payments, transfers, transactions, user search."""
import secrets
import string
from datetime import timedelta

from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Bill, Transaction, TransferRequest, User, utcnow
from ..schemas import (
    BillPublic, ConfirmTransferRequest, PayBillRequest, Receipt,
    SimulateBillRequest, TransactionPublic, TransferRequestIn, UserSummary,
)
from ..security import get_current_user, verify_pin

router = APIRouter(prefix="/api", tags=["wallet"])

REF_ALPHABET = string.ascii_uppercase + string.digits


def _ref() -> str:
    return "UR-" + "".join(secrets.choice(REF_ALPHABET) for _ in range(8))


# ---------------------------------------------------------------- bills ----
@router.get("/bills", response_model=list[BillPublic])
async def my_bills(user: User = Depends(get_current_user),
                   session: AsyncSession = Depends(get_session),
                   status_filter: str = Query("all", alias="status")):
    q = select(Bill).where(Bill.user_id == user.id)
    if status_filter in ("unpaid", "paid"):
        q = q.where(Bill.status == status_filter)
    bills = (await session.execute(q.order_by(
        Bill.status == "unpaid",  # unpaid first
        Bill.due_date))).scalars().all()
    return bills


@router.post("/bills/pay", response_model=Receipt)
async def pay_bill(body: PayBillRequest,
                   user: User = Depends(get_current_user),
                   session: AsyncSession = Depends(get_session)):
    if not verify_pin(body.pin, user.pin_salt, user.pin_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "رمز الـ PIN غير صحيح")

    bill = await session.get(Bill, body.bill_id)
    if bill is None or bill.user_id != user.id:
        raise HTTPException(404, "الفاتورة غير موجودة")
    if bill.status == "paid":
        raise HTTPException(409, "هذه الفاتورة مدفوعة مسبقًا")
    if user.balance < bill.amount:
        raise HTTPException(
            status.HTTP_406_NOT_ACCEPTABLE,
            "الرصيد غير كافٍ — عبي محفظتك أولًا")

    now = utcnow()
    ref = _ref()
    user.balance -= bill.amount
    bill.status = "paid"
    bill.paid_at = now
    bill.receipt_ref = ref
    session.add(Transaction(
        reference=ref, user_id=user.id, type="bill_payment", direction="out",
        amount=bill.amount, balance_after=user.balance,
        title=f"فاتورة {bill.biller_name}", subtitle=bill.period or "",
        category=bill.category, bill_id=bill.id, created_at=now,
    ))
    await session.commit()
    return Receipt(
        reference=ref, title=f"فاتورة {bill.biller_name}",
        subtitle=bill.period or "", amount=bill.amount,
        balance_after=user.balance, created_at=now)


@router.post("/bills/simulate", response_model=BillPublic, status_code=201)
async def simulate_bill(body: SimulateBillRequest,
                        user: User = Depends(get_current_user),
                        session: AsyncSession = Depends(get_session)):
    """Generate a fresh bill for the current user (demo convenience)."""
    from ..constants import BILLERS
    biller = next((b for bs in BILLERS.values() for b in bs
                   if b["code"] == body.biller_code), None)
    name = biller["name"] if biller else body.biller_code
    bill = Bill(
        user_id=user.id, category=body.category, biller_code=body.biller_code,
        biller_name=name, subscriber_no=body.subscriber_no, amount=body.amount,
        period="فاتورة تجريبية", due_date=utcnow() + timedelta(days=14),
        status="unpaid", issued_at=utcnow(),
    )
    session.add(bill)
    await session.commit()
    await session.refresh(bill)
    return bill


# ---------------------------------------------------------- transactions ---
@router.get("/transactions", response_model=list[TransactionPublic])
async def my_transactions(user: User = Depends(get_current_user),
                          session: AsyncSession = Depends(get_session),
                          limit: int = Query(50, le=200),
                          type_filter: str | None = Query(None, alias="type")):
    q = select(Transaction).where(Transaction.user_id == user.id)
    if type_filter:
        q = q.where(Transaction.type == type_filter)
    rows = (await session.execute(
        q.order_by(Transaction.created_at.desc()).limit(limit))).scalars().all()
    return rows


# ------------------------------------------------------------- transfers ---

async def expire_stale_requests(session: AsyncSession, user: User) -> int:
    """Cancel pending transfer requests older than 24h (TTL)."""
    cutoff = utcnow() - timedelta(hours=24)
    stale = (await session.execute(
        select(TransferRequest).where(
            TransferRequest.sender_id == user.id,
            TransferRequest.status == "pending",
            TransferRequest.created_at < cutoff,
        ))).scalars().all()
    for r in stale:
        r.status = "expired"
    if stale:
        await session.commit()
    return len(stale)


@router.post("/transfer/request", status_code=202)
async def make_transfer(body: TransferRequestIn,
                        user: User = Depends(get_current_user),
                        session: AsyncSession = Depends(get_session)):
    await expire_stale_requests(session, user)  # TTL housekeeping
    receiver = None
    if body.receiver_card:
        receiver = (await session.execute(
            select(User).where(User.card_number == body.receiver_card)
        )).scalar_one_or_none()
    elif body.receiver_id:
        receiver = await session.get(User, body.receiver_id)
    if receiver is None:
        raise HTTPException(404, "المستلم غير موجود — تحقق من رقم البطاقة")
    if receiver.id == user.id:
        raise HTTPException(405, "ما تصير تحوّل لنفسك 😅")
    if user.balance < body.amount:
        raise HTTPException(406, "الرصيد غير كافٍ لهذا التحويل")

    req = TransferRequest(sender_id=user.id, receiver_id=receiver.id,
                          amount=body.amount, status="pending")
    session.add(req)
    await session.commit()
    await session.refresh(req)
    return {
        "message": "تم إنشاء طلب التحويل — أكّده برمز الـ PIN",
        "request": {
            "id": req.id, "receiver": receiver.full_name,
            "receiver_card_masked": f"•••• {receiver.card_number[-4:]}",
            "amount": req.amount, "status": req.status,
        },
    }


@router.get("/transfer/requests")
async def my_transfer_requests(user: User = Depends(get_current_user),
                               session: AsyncSession = Depends(get_session)):
    await expire_stale_requests(session, user)  # TTL housekeeping
    rows = (await session.execute(
        select(TransferRequest).where(
            or_(TransferRequest.sender_id == user.id,
                TransferRequest.receiver_id == user.id),
            TransferRequest.status == "pending",
        ).order_by(TransferRequest.created_at.desc()))).scalars().all()
    out = []
    for r in rows:
        other_id = r.receiver_id if r.sender_id == user.id else r.sender_id
        other = await session.get(User, other_id)
        out.append({
            "id": r.id, "amount": r.amount, "status": r.status,
            "role": "sender" if r.sender_id == user.id else "receiver",
            "counterparty": other.full_name if other else "",
            "counterparty_card": f"•••• {other.card_number[-4:]}" if other else "",
            "created_at": r.created_at.isoformat(),
        })
    return out


@router.post("/transfer/confirm/{request_id}")
async def confirm_transfer(request_id: int, body: ConfirmTransferRequest,
                           user: User = Depends(get_current_user),
                           session: AsyncSession = Depends(get_session)):
    if not verify_pin(body.pin, user.pin_salt, user.pin_hash):
        raise HTTPException(403, "رمز الـ PIN غير صحيح")

    req = await session.get(TransferRequest, request_id)
    if req is None or req.sender_id != user.id or req.status != "pending":
        raise HTTPException(404, "طلب التحويل غير موجود أو منتهي")

    receiver = await session.get(User, req.receiver_id)
    if receiver is None:
        raise HTTPException(404, "المستلم غير موجود")
    if user.balance < req.amount:
        raise HTTPException(406, "الرصيد غير كافٍ")

    now = utcnow()
    ref = _ref()
    user.balance -= req.amount
    receiver.balance += req.amount
    req.status = "confirmed"
    req.confirmed_at = now

    session.add(Transaction(
        reference=ref, user_id=user.id, type="transfer_out", direction="out",
        amount=req.amount, balance_after=user.balance,
        title=f"حوالة إلى {receiver.full_name}",
        subtitle=f"بطاقة •••• {receiver.card_number[-4:]}",
        category="transfer", counterparty_id=receiver.id, created_at=now))
    session.add(Transaction(
        reference=ref, user_id=receiver.id, type="transfer_in", direction="in",
        amount=req.amount, balance_after=receiver.balance,
        title=f"حوالة من {user.full_name}",
        subtitle=f"بطاقة •••• {user.card_number[-4:]}",
        category="transfer", counterparty_id=user.id, created_at=now))
    await session.commit()

    return {
        "message": "تم التحويل بنجاح ✅",
        "receipt": {
            "reference": ref, "title": f"حوالة إلى {receiver.full_name}",
            "subtitle": f"بطاقة •••• {receiver.card_number[-4:]}",
            "amount": req.amount, "balance_after": user.balance,
            "created_at": now.isoformat(),
        },
    }


@router.post("/transfer/cancel/{request_id}")
async def cancel_transfer(request_id: int,
                          user: User = Depends(get_current_user),
                          session: AsyncSession = Depends(get_session)):
    req = await session.get(TransferRequest, request_id)
    if req is None or req.sender_id != user.id or req.status != "pending":
        raise HTTPException(404, "الطلب غير موجود")
    req.status = "cancelled"
    await session.commit()
    return {"message": "تم إلغاء طلب التحويل"}


# ---------------------------------------------------------------- top-up ---
class TopUpRequest(BaseModel):
    amount: int = Field(gt=1000, le=5_000_000)
    pin: str


@router.post("/topup", response_model=Receipt)
async def topup_wallet(body: TopUpRequest,
                       user: User = Depends(get_current_user),
                       session: AsyncSession = Depends(get_session)):
    """Simulated cash-in at an UrPay agent kiosk — PIN-protected."""
    from ..schemas import Receipt as ReceiptModel

    if not verify_pin(body.pin, user.pin_salt, user.pin_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "رمز الـ PIN غير صحيح")

    now = utcnow()
    ref = _ref()
    user.balance += body.amount
    session.add(Transaction(
        reference=ref, user_id=user.id, type="topup", direction="in",
        amount=body.amount, balance_after=user.balance,
        title="تعبئة محفظة — وكيل أور پاي", subtitle="كاش إن · إيداع نقدي",
        category="wallet", created_at=now,
    ))
    await session.commit()
    return ReceiptModel(
        reference=ref, title="تعبئة محفظة — وكيل أور پاي",
        subtitle="كاش إن · إيداع نقدي", amount=body.amount,
        balance_after=user.balance, created_at=now)


# ----------------------------------------------------------- user search ---
@router.get("/users/search", response_model=list[UserSummary])
async def search_users(q: str = Query(..., min_length=2),
                       user: User = Depends(get_current_user),
                       session: AsyncSession = Depends(get_session)):
    digits = "".join(ch for ch in q if ch.isdigit())
    cond = User.full_name.like(f"%{q}%")
    if len(digits) >= 4:
        cond = or_(cond, User.card_number.like(f"%{digits}%"))
    rows = (await session.execute(
        select(User).where(cond, User.id != user.id)
        .order_by(User.full_name).limit(8))).scalars().all()
    return rows
