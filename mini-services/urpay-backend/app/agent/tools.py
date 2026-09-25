"""Bill Pay Agent — tool implementations against the DB."""
import re
import secrets
import string

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..budget import check_budget_crossing
from ..constants import CATEGORY_AR
from ..models import Bill, Budget, Transaction, User, utcnow
from ..notify import notify

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
    notify(session, user.id, kind="payment",
           title=f"تم دفع فاتورة {bill.biller_name}",
           body=f"المرجع {ref} · رصيدك بعد الدفع {user.balance:,} د.ع".replace(",", "،"),
           amount=bill.amount, reference=ref)
    await check_budget_crossing(session, user, bill.category, bill.amount)
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
    notify(session, receiver.id, kind="transfer_in",
           title=f"وصلتك حوالة من {user.full_name}",
           body=f"المبلغ انضاف لرصيدك · المرجع {ref}",
           amount=amount, reference=ref)
    notify(session, user.id, kind="transfer_out",
           title=f"تم تحويل {amount:,} د.ع إلى {receiver.full_name}".replace(",", "،"),
           body=f"المرجع {ref} · رصيدك بعد التحويل {user.balance:,} د.ع".replace(",", "،"),
           amount=amount, reference=ref)
    await check_budget_crossing(session, user, "transfer", amount)
    await session.commit()

    return {
        "ok": True, "receipt": {
            "reference": ref, "title": f"حوالة إلى {receiver.full_name}",
            "subtitle": f"بطاقة •••• {receiver.card_number[-4:]}",
            "amount": amount, "balance_after": user.balance,
            "created_at": now.isoformat(),
        }, "balance_formatted": fmt_iqd(user.balance),
    }


async def topup_wallet(session: AsyncSession, user: User,
                       amount: int, pin: str) -> dict:
    """Simulated cash-in at an UrPay kiosk — PIN-protected."""
    from ..security import verify_pin

    if not verify_pin(pin or "", user.pin_salt, user.pin_hash):
        return {"ok": False, "error": "pin"}
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        return {"ok": False, "error": "bad_amount"}
    if amount <= 1000 or amount > 5_000_000:
        return {"ok": False, "error": "bad_amount",
                "detail": "المبلغ لازم يكون بين 1,000 و 5,000,000 د.ع"}

    now = utcnow()
    ref = new_reference()
    user.balance += amount
    session.add(Transaction(
        reference=ref, user_id=user.id, type="topup", direction="in",
        amount=amount, balance_after=user.balance,
        title="تعبئة محفظة — وكيل أور پاي", subtitle="كاش إن · إيداع نقدي",
        category="wallet", created_at=now,
    ))
    notify(session, user.id, kind="topup",
           title="تمت تعبئة المحفظة",
           body=f"انضاف {amount:,} د.ع لرصيدك · المرجع {ref}".replace(",", "،"),
           amount=amount, reference=ref)
    await session.commit()
    return {
        "ok": True, "receipt": {
            "reference": ref, "title": "تعبئة محفظة — وكيل أور پاي",
            "subtitle": "كاش إن · إيداع نقدي", "amount": amount,
            "balance_after": user.balance, "created_at": now.isoformat(),
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


async def get_spending(session: AsyncSession, user: User) -> dict:
    """Month-to-date spend by category + budget status — powers spending questions."""
    month_start = utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    rows = (await session.execute(
        select(Transaction.category, func.sum(Transaction.amount))
        .where(Transaction.user_id == user.id,
               Transaction.direction == "out",
               Transaction.created_at >= month_start)
        .group_by(Transaction.category)
    )).all()
    spent = {cat: int(total or 0) for cat, total in rows}
    budgets = {b.category: b.monthly_limit for b in (await session.execute(
        select(Budget).where(Budget.user_id == user.id))).scalars()}

    categories = []
    total_out = 0
    for cat, s in sorted(spent.items(), key=lambda kv: -kv[1]):
        total_out += s
        entry = {"category": cat, "name_ar": CATEGORY_AR.get(cat, cat), "spent": s}
        if cat in budgets and budgets[cat]:
            limit = budgets[cat]
            entry["monthly_limit"] = limit
            entry["pct"] = round(s / limit * 100, 1)
            entry["status"] = "over" if s > limit else ("near" if s >= 0.8 * limit else "ok")
        categories.append(entry)
    # budgeted categories with zero spend so far
    for cat, limit in budgets.items():
        if cat not in spent:
            categories.append({
                "category": cat, "name_ar": CATEGORY_AR.get(cat, cat), "spent": 0,
                "monthly_limit": limit, "pct": 0.0, "status": "ok",
            })
    return {
        "month_start": month_start.isoformat(),
        "total_spent_this_month": total_out,
        "categories": categories,
    }


async def set_budget(session: AsyncSession, user: User, category: str,
                     monthly_limit: int) -> dict:
    """Set (or remove, when limit=0) a monthly spending limit per category."""
    from ..constants import BUDGETABLE_CATEGORIES

    category = (category or "").strip().lower()
    if category not in BUDGETABLE_CATEGORIES:
        return {"ok": False, "error": "bad_category",
                "categories": BUDGETABLE_CATEGORIES}
    try:
        monthly_limit = int(monthly_limit)
    except (TypeError, ValueError):
        return {"ok": False, "error": "bad_amount"}
    if monthly_limit < 0 or monthly_limit > 20_000_000:
        return {"ok": False, "error": "bad_amount",
                "detail": "الحد لازم يكون بين 0 (حذف) و 20,000,000 د.ع"}

    existing = (await session.execute(
        select(Budget).where(Budget.user_id == user.id,
                             Budget.category == category)
    )).scalar_one_or_none()

    ar = CATEGORY_AR.get(category, category)
    if monthly_limit == 0:
        if existing:
            await session.delete(existing)
            await session.commit()
            return {"ok": True, "removed": True, "message": f"انحذفت ميزانية {ar}"}
        return {"ok": True, "removed": True, "message": f"ما كانت معينة أصلًا"}

    if existing:
        existing.monthly_limit = monthly_limit
        existing.updated_at = utcnow()
    else:
        session.add(Budget(user_id=user.id, category=category,
                           monthly_limit=monthly_limit))
    await session.commit()

    # include month-to-date spend for context
    month_start = utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    spent = (await session.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            Transaction.user_id == user.id,
            Transaction.direction == "out",
            Transaction.category == category,
            Transaction.created_at >= month_start,
        ))) or 0

    return {
        "ok": True, "category": category, "monthly_limit": monthly_limit,
        "spent_this_month": spent,
        "message": (f"تم تعيين ميزانية {ar} بمبلغ {monthly_limit:,} د.ع شهريًا — "
                    f"صرفك هذا الشهر {spent:,} د.ع".replace(",", "،")),
    }


async def get_profile(session: AsyncSession, user: User) -> dict:
    return {
        "full_name": user.full_name, "city": user.city, "district": user.district,
        "phone": user.phone, "card_masked": f"•••• {user.card_number[-4:]}",
        "balance": user.balance, "age": user.age,
    }
