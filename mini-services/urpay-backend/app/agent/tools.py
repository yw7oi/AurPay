"""Bill Pay Agent — tool implementations against the DB."""
import re
import secrets
import string

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Bill, Transaction, User, utcnow

REF_ALPHABET = string.ascii_uppercase + string.digits


def new_reference() -> str:
    return "UR-" + "".join(secrets.choice(REF_ALPHABET) for _ in range(8))


def fmt_iqd(amount: int) -> str:
    return f"{amount:,}".replace(",", " ") + " د.ع"


def bill_to_dict(b: Bill) -> dict:
    return {
        "id": b.id, "category": b.category, "biller": b.biller_name,
        "subscriber_no": b.subscriber_no, "amount": b.amount,
        "period": b.period, "due_date": b.due_date.isoformat() if b.due_date else None,
        "status": b.status, "overdue": b.overdue,
    }


async def get_balance(session: AsyncSession, user: User) -> dict:
    return {"balance": user.balance, "formatted": fmt_iqd(user.balance)}


async def list_bills(session: AsyncSession, user: User, status: str = "unpaid") -> dict:
    q = select(Bill).where(Bill.user_id == user.id)
    if status in ("unpaid", "paid"):
        q = q.where(Bill.status == status)
    bills = (await session.execute(q.order_by(Bill.due_date))).scalars().all()
    unpaid_total = sum(b.amount for b in bills if b.status == "unpaid")
    return {
        "count": len(bills),
        "unpaid_total": unpaid_total,
        "unpaid_total_formatted": fmt_iqd(unpaid_total),
        "bills": [bill_to_dict(b) for b in bills[:15]],
    }


async def pay_bill(session: AsyncSession, user: User, bill_id: int, pin: str,
                   hint: str = "") -> dict:
    from ..security import verify_pin

    if not verify_pin(pin or "", user.pin_salt, user.pin_hash):
        return {"ok": False, "error": "pin"}

    bill = await session.get(Bill, bill_id)
    if bill is None or bill.user_id != user.id:
        return {"ok": False, "error": "not_found"}

    # guard against the agent paying the WRONG bill: if the caller passed a
    # category/biller hint, it must match the target bill.
    if hint:
        h = hint.strip().lower()
        target = f"{bill.category} {bill.biller_name} {bill.biller_code}".lower()
        aliases = {
            "كهرب": "electricity", "power": "electricity", "electricity": "electricity",
            "ماء": "water", "مياه": "water", "water": "water",
            "نت": "internet", "internet": "internet", "انترنت": "internet",
            "شحن": "mobile", "mobile": "mobile", "زين": "mobile", "باقة": "mobile",
            "جامع": "education", "education": "education", "رسوم": "education", "مدرس": "education",
            "مرور": "traffic", "مخالف": "traffic", "traffic": "traffic", "غرام": "traffic",
        }
        wanted = next((cat for k, cat in aliases.items() if k in h), None)
        if wanted and wanted != bill.category:
            return {
                "ok": False, "error": "wrong_bill",
                "detail": f"رقم {bill_id} هو فاتورة {bill.biller_name} وليس المطابقة لطلب المستخدم — أعد التحقق من رقم الفاتورة الصحيح من list_bills",
            }
        if wanted is None and h not in target:
            return {
                "ok": False, "error": "wrong_bill",
                "detail": f"اسم الجهة غير مطابق — فاتورة رقم {bill_id} هي {bill.biller_name}",
            }

    if bill.status == "paid":
        return {"ok": False, "error": "already_paid",
                "receipt_ref": bill.receipt_ref}

    if user.balance < bill.amount:
        return {"ok": False, "error": "insufficient",
                "balance": user.balance, "amount": bill.amount}

    ref = new_reference()
    now = utcnow()
    user.balance -= bill.amount
    bill.status = "paid"
    bill.paid_at = now
    bill.receipt_ref = ref

    txn = Transaction(
        reference=ref, user_id=user.id, type="bill_payment", direction="out",
        amount=bill.amount, balance_after=user.balance,
        title=f"فاتورة {bill.biller_name}", subtitle=bill.period or "",
        category=bill.category, bill_id=bill.id, created_at=now,
    )
    session.add(txn)
    await session.commit()

    return {
        "ok": True, "receipt": {
            "reference": ref, "title": f"فاتورة {bill.biller_name}",
            "subtitle": bill.period or "", "amount": bill.amount,
            "balance_after": user.balance, "created_at": now.isoformat(),
        }, "balance_formatted": fmt_iqd(user.balance),
    }


async def search_users(session: AsyncSession, user: User, query: str) -> dict:
    q = query.strip()
    if len(q) < 2:
        return {"count": 0, "results": []}
    digits = re.sub(r"\D", "", q)
    cond = User.full_name.like(f"%{q}%")
    if len(digits) >= 4:
        cond = or_(cond, User.card_number.like(f"%{digits}%"))
    rows = (await session.execute(
        select(User).where(cond, User.id != user.id).limit(8)
    )).scalars().all()
    return {
        "count": len(rows),
        "results": [{
            "id": u.id, "full_name": u.full_name, "city": u.city,
            "card_masked": f"•••• {u.card_number[-4:]}", "card_number": u.card_number,
        } for u in rows],
    }


async def transfer_money(session: AsyncSession, user: User,
                         receiver_card: str, amount: int, pin: str) -> dict:
    from ..security import verify_pin

    if not verify_pin(pin or "", user.pin_salt, user.pin_hash):
        return {"ok": False, "error": "pin"}

    card = re.sub(r"\D", "", receiver_card or "")
    if len(card) != 16:
        return {"ok": False, "error": "bad_card"}

    receiver = (await session.execute(
        select(User).where(User.card_number == card)
    )).scalar_one_or_none()
    if receiver is None:
        return {"ok": False, "error": "not_found"}
    if receiver.id == user.id:
        return {"ok": False, "error": "self"}

    amount = int(amount)
    if amount <= 0:
        return {"ok": False, "error": "bad_amount"}
    if user.balance < amount:
        return {"ok": False, "error": "insufficient",
                "balance": user.balance, "amount": amount}

    now = utcnow()
    ref = new_reference()

    user.balance -= amount
    out_txn = Transaction(
        reference=ref, user_id=user.id, type="transfer_out", direction="out",
        amount=amount, balance_after=user.balance,
        title=f"حوالة إلى {receiver.full_name}",
        subtitle=f"بطاقة •••• {receiver.card_number[-4:]}",
        category="transfer", counterparty_id=receiver.id, created_at=now,
    )
    receiver.balance += amount
    in_txn = Transaction(
        reference=ref, user_id=receiver.id, type="transfer_in", direction="in",
        amount=amount, balance_after=receiver.balance,
        title=f"حوالة من {user.full_name}",
        subtitle=f"بطاقة •••• {user.card_number[-4:]}",
        category="transfer", counterparty_id=user.id, created_at=now,
    )
    session.add_all([out_txn, in_txn])
    await session.commit()

    return {
        "ok": True, "receipt": {
            "reference": ref, "title": f"حوالة إلى {receiver.full_name}",
            "subtitle": f"بطاقة •••• {receiver.card_number[-4:]}",
            "amount": amount, "balance_after": user.balance,
            "created_at": now.isoformat(),
        }, "balance_formatted": fmt_iqd(user.balance),
    }


async def recent_transactions(session: AsyncSession, user: User,
                              limit: int = 5) -> dict:
    limit = max(1, min(int(limit or 5), 20))
    rows = (await session.execute(
        select(Transaction).where(Transaction.user_id == user.id)
        .order_by(Transaction.created_at.desc()).limit(limit)
    )).scalars().all()
    return {
        "count": len(rows),
        "transactions": [{
            "reference": t.reference, "type": t.type, "direction": t.direction,
            "title": t.title, "amount": t.amount,
            "created_at": t.created_at.isoformat(),
        } for t in rows],
    }


async def get_profile(session: AsyncSession, user: User) -> dict:
    return {
        "full_name": user.full_name, "city": user.city, "district": user.district,
        "phone": user.phone, "card_masked": f"•••• {user.card_number[-4:]}",
        "balance": user.balance, "age": user.age,
    }
