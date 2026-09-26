"""Bill Pay Agent — tool implementations against the DB."""
import re
import secrets
import string
from datetime import datetime, timedelta
from difflib import SequenceMatcher

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..budget import check_budget_crossing
from ..constants import CATEGORY_AR
from ..models import (Bill, Budget, SavingsGoal, ScheduledPayment, Transaction,
                     User, utcnow)
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


# ---------------------------------------------------------------------------
# Smart people search — forgiving Arabic/Latin name matching.
# Understands: partial names, first+family without the middle name, the
# definite article «ال», the attached لام («لزينب»), common misspellings,
# English transliteration ("zainab mousawi"), and city hints («من النجف»).
# ---------------------------------------------------------------------------
_AR_DIACRITICS = re.compile(r"[\u064B-\u0652\u0670\u0640]")
_LATIN_WORD_RE = re.compile(r"[a-z]+")

# rough Arabic→Latin letter map — enough for transliteration search
_AR_TO_LATIN = {
    "ا": "a", "ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "h", "خ": "kh",
    "د": "d", "ذ": "dh", "ر": "r", "ز": "z", "س": "s", "ش": "sh", "ص": "s",
    "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh", "ف": "f", "ق": "q",
    "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "w", "ي": "y",
    "پ": "p", "چ": "ch", "ژ": "zh", "ک": "k", "ی": "y", "گ": "g", "ڤ": "v",
}

# filler words that carry no identity (علي/على deliberately NOT here —
# علي is one of the most common first names)
_NAME_STOPWORDS = {
    "الى", "اللي", "اللى", "لي", "لها", "له", "منو", "مين", "من", "هو", "هي",
    "هذا", "هذي", "هذيل", "ذيج", "دي", "شخص", "الشخص", "الشخصية", "المستلم",
    "المستلمه", "المتلقي", "المحوله", "حواله", "حوالة", "تحويل", "حول", "حو",
    "حولله", "دفع", "المبلغ", "مبلغ", "دينار", "دع", "الف", "الاف", "تو",
    "سيند", "اسم", "ابحث", "دور", "بحث", "رقم", "بطاقه", "بطاقة", "كارت",
    "عنده", "عندها", "بيها", "به", "في", "و", "بس", "فقط", "المحفظه", "محفظه",
    "شسمه", "شسمها", "وين", "فين", "بصورة", "رمز", "pin",
    "to", "for", "send", "transfer", "user", "name", "card", "number",
    "who", "find", "search", "the", "of", "is",
}


def _norm_name(text: str) -> str:
    """Normalize a name/query for forgiving comparison."""
    t = (text or "").lower().strip()
    t = _AR_DIACRITICS.sub("", t)
    for ch in ("أ", "إ", "آ", "ٱ"):
        t = t.replace(ch, "ا")
    t = t.replace("ى", "ي").replace("ئ", "ي").replace("ؤ", "و").replace("ة", "ه")
    t = re.sub(r"[^\w\s]", " ", t)          # punctuation → space
    return re.sub(r"\s+", " ", t).strip()


def _token_variants(tok: str) -> list[str]:
    """Generous variants of a token to fight Arabic orthography."""
    out = [tok]
    if tok.startswith("ال") and len(tok) > 3:
        out.append(tok[2:])          # «الموسوي» → «موسوي»
    if tok.startswith("ل") and len(tok) > 3:
        out.append(tok[1:])          # attached لام: «لزينب» → «زينب»
    if tok.startswith("بال") and len(tok) > 4:
        out.append(tok[3:])
    return out


def _latin_norm(s: str) -> str:
    """Fold common Latin digraphs so transliterations line up."""
    return (s.replace("ou", "w").replace("oo", "w")
             .replace("ee", "i").replace("y", "i").replace("ai", "e"))


def _strip_vowels(s: str) -> str:
    return re.sub(r"[aeiou]", "", s)


def _latin_forms(tok: str) -> list[tuple[str, str]]:
    """(full, skeleton) Latin renderings of an Arabic token."""
    lat = "".join(_AR_TO_LATIN.get(ch, "") for ch in tok)
    if not lat:
        return []
    full = _latin_norm(lat)
    return [(full, _strip_vowels(full))]


def _token_score(a: str, b: str) -> float:
    """Similarity of two normalized tokens in [0, 1]."""
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if len(a) >= 3 and len(b) >= 3:
        if b.startswith(a) or a.startswith(b):
            return 0.9
        if a in b or b in a:
            return 0.82
    ratio = SequenceMatcher(None, a, b).ratio()
    # fuzzy (edit-distance) matches are discounted ×0.85: a real typo still
    # scores high, but genuinely different names (موسى vs الموسوي) rank
    # clearly below an exact family-name hit
    return ratio * 0.85 if ratio >= 0.72 else 0.0


def _pair_score(qt: str, nt: str) -> float:
    """Best score between a query token and a name token (Arabic or Latin)."""
    best = _token_score(qt, nt)
    if best >= 0.9:
        return best
    if _LATIN_WORD_RE.fullmatch(qt):          # Latin query ↔ Arabic name
        qn = _latin_norm(qt)
        qs = _strip_vowels(qn)
        for full, skel in _latin_forms(nt):
            best = max(best, _token_score(qn, full))
            if qs == skel:                    # exact consonant skeleton
                best = max(best, 1.0)
            elif (len(qs) >= 3 and len(skel) >= 3
                  and (skel.startswith(qs) or qs.startswith(skel))):
                best = max(best, 0.75)        # skeleton prefix — weak signal
    return best


def _score_user(q_tokens: list[str], u: "User") -> tuple[float, list[str], bool]:
    """Score one candidate: (score, matched name tokens, has_strong_match)."""
    name_tokens: list[str] = []
    for part in (u.full_name, u.first_name, u.father_name, u.family_name):
        for t in _norm_name(part or "").split():
            if t and t not in name_tokens:
                name_tokens.append(t)
    city_tokens = [c for c in _norm_name(u.city or "").split() if len(c) >= 3]

    total, matched, strong, city_hit = 0.0, [], False, False
    for qt in q_tokens:
        qv = _token_variants(qt)
        best, hit_tok = 0.0, None
        for nt in name_tokens:
            for a in qv:
                for b in _token_variants(nt):
                    s = _pair_score(a, b)
                    if s > best:
                        best, hit_tok = s, nt
        if best >= 0.72:
            total += best
            strong = strong or best >= 0.9
            if hit_tok not in matched:
                matched.append(hit_tok)
        elif any(_token_score(a, c) >= 0.8
                 for a in qv for c in city_tokens):
            city_hit = True
            total += 0.5                      # city hint — disambiguates only
    if not q_tokens:
        return 0.0, [], False
    score = total / len(q_tokens)
    if city_hit:
        score = min(1.0, score + 0.06)
    return score, matched, strong


async def search_users(session: AsyncSession, user: User, query: str) -> dict:
    """Smart recipient search — ranked fuzzy matches (name + city + card)."""
    q = (query or "").strip()
    if len(q) < 2:
        return {"count": 0, "results": []}

    hits: dict[int, dict] = {}

    # 1) card digits — a pure-digit query (any length ≥ 4) or long runs in text
    compact = re.sub(r"[\s\-]", "", q)
    runs = [compact] if re.fullmatch(r"\d{4,19}", compact) \
        else re.findall(r"\d{8,}", q)
    for run in runs:
        rows = (await session.execute(
            select(User).where(User.card_number.like(f"%{run}%"),
                                User.id != user.id).limit(4)
        )).scalars().all()
        for u in rows:
            hits[u.id] = {"u": u, "score": 1.0, "matched": ["بطاقة"],
                          "strong": True}

    # 2) smart name matching over the candidate pool
    q_tokens = [t for t in _norm_name(q).split()
                if len(t) >= 2 and not t.isdigit() and t not in _NAME_STOPWORDS]
    if q_tokens:
        rows = (await session.execute(
            select(User).where(User.id != user.id).limit(2000)
        )).scalars().all()
        for u in rows:
            score, matched, strong = _score_user(q_tokens, u)
            if score >= 0.55 and strong and u.id not in hits:
                hits[u.id] = {"u": u, "score": score, "matched": matched,
                              "strong": strong}

    ranked = sorted(hits.values(),
                    key=lambda h: (-h["score"], -len(h["matched"]), h["u"].id))
    top = ranked[:8]
    note = ""
    if top:
        best_sc = top[0]["score"]
        runner = top[1]["score"] if len(top) > 1 else 0.0
        if best_sc >= 0.9 and best_sc - runner >= 0.1:
            note = ("النتيجة الأولى هي المقصودة بوضوح (أعلى تطابق بفارق ملموس) — "
                    "اعتمدها مباشرة وأكمل طلب المستخدم دون سؤال.")
        elif len(top) == 1:
            note = "نتيجة وحيدة — اعتمدها مباشرة."
    return {
        "count": len(top),
        "note": note,
        "results": [{
            "id": h["u"].id, "full_name": h["u"].full_name, "city": h["u"].city,
            "card_masked": f"•••• {h['u'].card_number[-4:]}",
            "card_number": h["u"].card_number,
            "score": round(h["score"], 2), "matched_on": h["matched"][:4],
        } for h in top],
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
               Transaction.category != "savings",
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


# ------------------------------------------------------- scheduled payments --

SCHED_ALIASES = {
    "كهرب": "electricity", "electricity": "electricity", "power": "electricity",
    "ماء": "water", "مياه": "water", "water": "water",
    "نت": "internet", "internet": "internet", "انترنت": "internet", "إنترنت": "internet",
    "شحن": "mobile", "mobile": "mobile", "زين": "mobile", "باقة": "mobile",
    "جامع": "education", "education": "education", "رسوم": "education", "مدرس": "education",
    "مرور": "traffic", "مخالف": "traffic", "traffic": "traffic", "غرام": "traffic",
    "صح": "health", "مستشف": "health", "علاج": "health", "فحص": "health",
    "طب": "health", "أسنان": "health", "اسنان": "health", "health": "health",
    "hospital": "health", "medical": "health", "تطعيم": "health",
    "غاز": "gas", "اسطوان": "gas", "gas": "gas",
}


def resolve_biller(target: str, user_city: str = ""):
    """Resolve a biller from a code, a (partial) name, or an Arabic category
    word — preferring billers that serve the user's governorate."""
    from ..constants import BILLERS

    t = (target or "").strip()
    if not t:
        return None
    # 1. exact biller code
    for cat, bs in BILLERS.items():
        for b in bs:
            if b["code"] == t:
                return b, cat
    # 2. name containment
    for cat, bs in BILLERS.items():
        for b in bs:
            if t in b["name"] or b["name"] in t:
                return b, cat
    # 3. Arabic/English category keyword
    low = t.lower()
    cat = next((c for k, c in SCHED_ALIASES.items() if k in low), None)
    if cat:
        bs = BILLERS[cat]
        city = (user_city or "").strip()
        if city:
            for b in bs:
                if city in b["name"]:
                    return b, cat
        return bs[0], cat
    return None


def _parse_when(text: str):
    """Parse a scheduling time from Arabic phrases or ISO datetime.

    Returns (datetime|None, frequency_hint) — frequency_hint is "monthly" when
    the user asked for a recurring mandate.
    """
    from ..scheduler import MIN_AHEAD

    t = (text or "").strip()
    low = re.sub(r"\s+", " ", t.lower())
    now = utcnow()

    if re.search(r"كل شهر|شهري|شهر[يي]ا|monthly|every month", low):
        # first of next month at 09:00
        y, m = (now.year, now.month + 1) if now.month < 12 else (now.year + 1, 1)
        return now.replace(year=y, month=m, day=1, hour=9, minute=0,
                           second=0, microsecond=0), "monthly"

    # relative minutes: «بعد دقيقة» / «بعد دقيقتين» / «بعد 5 دقائق»
    m = re.search(r"بعد\s+(?:بو?ص?\s*)?(\d+)\s*دقيق", low) or \
        re.search(r"after\s+(\d+)\s*min", low)
    if m:
        return now + timedelta(minutes=int(m.group(1))), ""
    if re.search(r"بعد\s+دقيق[تي]?ين|بعد دقيقة", low):
        return now + timedelta(minutes=2), ""

    # relative hours
    m = re.search(r"بعد\s+(\d+)\s*ساع", low) or re.search(r"after\s+(\d+)\s*hour", low)
    if m:
        return now + timedelta(hours=int(m.group(1))), ""
    if re.search(r"بعد\s+ساع[تي]?ين", low):
        return now + timedelta(hours=2), ""

    # tomorrow
    if re.search(r"غدا|غدًا|بكر[هة]|بكرة|tomorrow", low):
        return (now + timedelta(days=1)).replace(hour=9, minute=0, second=0,
                                                 microsecond=0), ""

    # relative days: «بعد يومين» / «بعد 3 أيام» / «بعد أسبوع»
    if re.search(r"بعد\s+يومين|بعد\s+يومان", low):
        return now + timedelta(days=2), ""
    if re.search(r"بعد\s+أسبوع|بعد\s+اسبوع|in a week|next week", low):
        return now + timedelta(days=7), ""
    m = re.search(r"بعد\s+(\d+)\s*(?:يوم|أيام|ايام|day|days)", low)
    if m:
        return now + timedelta(days=int(m.group(1))), ""

    # first of next month
    if re.search(r"أول الشهر|اول الشهر|بداية الشهر|first of (the )?month|start of month", low):
        y, mth = (now.year, now.month + 1) if now.month < 12 else (now.year + 1, 1)
        return now.replace(year=y, month=mth, day=1, hour=9, minute=0,
                           second=0, microsecond=0), ""

    # explicit ISO: 2026-10-01 or 2026-10-01T09:00 / 2026-10-01 09:00
    m = re.search(r"(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}))?", t)
    if m:
        try:
            when = datetime.fromisoformat(
                m.group(1) + ("T" + (m.group(2) or "09:00") if m.group(2) else "T09:00"))
            return when, ""
        except ValueError:
            pass

    # day/month Arabic style: «1-10» or «1/10»
    m = re.search(r"\b(\d{1,2})[-/](\d{1,2})\b", t)
    if m:
        day, month = int(m.group(1)), int(m.group(2))
        year = now.year if month >= now.month else now.year + 1
        try:
            when = datetime(year, month, day, 9, 0)
            return when, ""
        except ValueError:
            pass

    if re.search(r"الان|الآن|الحين|حالا|باسرع|now|asap", low):
        return now + MIN_AHEAD, ""

    return None, ""


async def schedule_payment(session: AsyncSession, user: User, kind: str,
                           target: str, amount: int, when: str,
                           pin: str, frequency: str = "") -> dict:
    """Create a PIN-authorized scheduled payment mandate.

    kind: "bill" (target = biller code) or "transfer" (target = 16-digit card).
    when: Arabic phrase («غدًا», «بعد يومين», «أول الشهر الجاي») or ISO date.
    """
    from ..constants import BILLERS
    from ..scheduler import MAX_AHEAD, MIN_AHEAD, _next_month
    from ..security import verify_pin

    kind = (kind or "").strip().lower()
    if kind not in ("bill", "transfer"):
        return {"ok": False, "error": "bad_kind"}

    if not verify_pin(pin or "", user.pin_salt, user.pin_hash):
        return {"ok": False, "error": "pin"}

    try:
        amount = int(amount)
    except (TypeError, ValueError):
        return {"ok": False, "error": "bad_amount"}
    if not (1000 <= amount <= 5_000_000):
        return {"ok": False, "error": "bad_amount",
                "detail": "المبلغ لازم يكون بين 1,000 و 5,000,000 د.ع"}

    when_dt, freq_hint = _parse_when(when)
    if when_dt is None:
        return {"ok": False, "error": "bad_when",
                "detail": ("ما فهمت التوقيت — استخدم مثلًا «غدًا»، «بعد يومين»، "
                           "«أول الشهر الجاي»، أو تاريخ ISO مثل 2026-10-01")}
    frequency = (frequency or freq_hint or "once").strip().lower()
    if frequency not in ("once", "monthly"):
        frequency = "once"

    now = utcnow()
    if when_dt < now + MIN_AHEAD:
        when_dt = now + MIN_AHEAD
    if when_dt > now + MAX_AHEAD:
        return {"ok": False, "error": "bad_when",
                "detail": "ما تصير جدولة أبعد من سنة"}

    if kind == "bill":
        resolved = resolve_biller(target, user.city)
        if resolved is None:
            return {"ok": False, "error": "bad_target",
                    "detail": "ما لقيت الجهة — اذكر نوع الفاتورة (كهرباء، ماء، إنترنت…) أو كود الجهة"}
        biller, category = resolved
        sp = ScheduledPayment(
            user_id=user.id, kind="bill", category=category,
            biller_code=biller["code"], biller_name=biller["name"],
            amount=amount, frequency=frequency, next_run_at=when_dt,
            status="pending", created_at=now)
        label = f"فاتورة {biller['name']}"
    else:
        card = re.sub(r"\D", "", target or "")
        if len(card) != 16:
            return {"ok": False, "error": "bad_target",
                    "detail": "رقم بطاقة المستلم لازم 16 رقم"}
        receiver = (await session.execute(
            select(User).where(User.card_number == card)
        )).scalar_one_or_none()
        if receiver is None:
            return {"ok": False, "error": "not_found"}
        if receiver.id == user.id:
            return {"ok": False, "error": "self"}
        sp = ScheduledPayment(
            user_id=user.id, kind="transfer", receiver_card=card,
            receiver_name=receiver.full_name, amount=amount,
            frequency=frequency, next_run_at=when_dt,
            status="pending", created_at=now)
        label = f"حوالة إلى {receiver.full_name}"

    session.add(sp)
    await session.commit()
    await session.refresh(sp)

    freq_txt = "وتتكرر شهريًا" if frequency == "monthly" else "لمرة واحدة"
    return {
        "ok": True, "scheduled": {
            "id": sp.id, "kind": sp.kind, "label": label,
            "amount": sp.amount, "frequency": sp.frequency,
            "next_run_at": sp.next_run_at.isoformat(),
        },
        "message": (f"تمت الجدولة ✅ {label} بمبلغ {amount:,} د.ع "
                    f"بتاريخ {sp.next_run_at:%Y-%m-%d} {freq_txt}.").replace(",", "،"),
    }


async def list_scheduled(session: AsyncSession, user: User) -> dict:
    from ..scheduler import run_due_scheduled
    await run_due_scheduled(session)
    rows = (await session.execute(
        select(ScheduledPayment).where(
            ScheduledPayment.user_id == user.id,
            ScheduledPayment.status == "pending",
        ).order_by(ScheduledPayment.next_run_at))).scalars().all()
    return {
        "count": len(rows),
        "monthly_total": sum(sp.amount for sp in rows if sp.frequency == "monthly"),
        "items": [{
            "id": sp.id, "kind": sp.kind, "label": sp.label,
            "amount": sp.amount, "frequency": sp.frequency,
            "next_run_at": sp.next_run_at.isoformat() if sp.next_run_at else None,
        } for sp in rows],
    }


async def cancel_scheduled(session: AsyncSession, user: User,
                           scheduled_id: int) -> dict:
    sp = await session.get(ScheduledPayment, int(scheduled_id))
    if sp is None or sp.user_id != user.id or sp.status != "pending":
        return {"ok": False, "error": "not_found"}
    sp.status = "cancelled"
    await session.commit()
    return {"ok": True, "message": f"انحذفت جدولة {sp.label}"}


# ----------------------------------------------------------------------
# Savings goals (أهداف التوفير)

MAX_GOALS = 8


def _goal_row(g: SavingsGoal) -> dict:
    pct = round(g.saved_amount / g.target_amount * 100) if g.target_amount else 0
    return {
        "id": g.id, "name": g.name, "emoji": g.emoji,
        "target": g.target_amount, "saved": g.saved_amount,
        "remaining": max(0, g.target_amount - g.saved_amount),
        "pct": min(pct, 100), "status": g.status,
    }


async def list_goals(session: AsyncSession, user: User) -> dict:
    """The user's savings goals with progress (active + completed)."""
    rows = (await session.execute(
        select(SavingsGoal).where(SavingsGoal.user_id == user.id)
        .order_by(SavingsGoal.status.desc(), SavingsGoal.created_at))).scalars().all()
    return {
        "count": len(rows),
        "total_saved": sum(g.saved_amount for g in rows),
        "items": [_goal_row(g) for g in rows],
    }


async def create_goal(session: AsyncSession, user: User, name: str,
                      target_amount: int) -> dict:
    """Create a savings goal (no PIN — no money moves at creation)."""
    name = (name or "").strip()
    if len(name) < 2:
        return {"ok": False, "error": "اكتب اسم هدف واضح (حرفين على الأقل)"}
    if not (10_000 <= target_amount <= 100_000_000):
        return {"ok": False, "error": "الهدف يجب أن يكون بين ١٠,٠٠٠ و ١٠٠,٠٠٠,٠٠٠ د.ع"}
    count = len((await session.execute(
        select(SavingsGoal.id).where(SavingsGoal.user_id == user.id))).scalars().all())
    if count >= MAX_GOALS:
        return {"ok": False, "error": f"عندك الحد الأقصى {MAX_GOALS} أهداف"}
    g = SavingsGoal(user_id=user.id, name=name, emoji="🎯",
                    target_amount=target_amount, saved_amount=0,
                    status="active", created_at=utcnow())
    session.add(g)
    await session.commit()
    await session.refresh(g)
    return {
        "ok": True, "goal": _goal_row(g),
        "message": f"سوّينا هدف «{name}» بمبلغ {fmt_iqd(target_amount)} — ابدأ توفّر له",
    }


async def deposit_goal(session: AsyncSession, user: User, goal_id: int,
                       amount: int, pin: str) -> dict:
    """Move IQD from the wallet balance into a goal (PIN-verified)."""
    from ..security import verify_pin
    if not verify_pin(pin, user.pin_salt, user.pin_hash):
        return {"ok": False, "error": "pin_invalid"}
    g = await session.get(SavingsGoal, int(goal_id))
    if g is None or g.user_id != user.id:
        return {"ok": False, "error": "goal_not_found"}
    if not (1_000 <= amount <= 5_000_000):
        return {"ok": False, "error": "التوفير يجب أن يكون بين ١,٠٠٠ و ٥,٠٠٠,٠٠٠ د.ع"}
    if user.balance < amount:
        return {"ok": False, "error": "رصيدك ما يكفي — عبّي المحفظة أولًا"}

    now = utcnow()
    ref = new_reference()
    user.balance -= amount
    g.saved_amount += amount
    g.updated_at = now
    just_reached = g.status == "active" and g.saved_amount >= g.target_amount
    if just_reached:
        g.status = "completed"
    session.add(Transaction(
        reference=ref, user_id=user.id, type="goal_deposit", direction="out",
        amount=amount, balance_after=user.balance,
        title=f"توفير — {g.name}", subtitle="إيداع بالهدف" + (" 🎉 اكتمل!" if just_reached else ""),
        category="savings", created_at=now,
    ))
    if just_reached:
        notify(session, user.id, kind="goal_reached",
               title=f"وصلت لهدفك «{g.name}» 🎉",
               body=(f"وفّرت {fmt_iqd(g.saved_amount)} من {fmt_iqd(g.target_amount)} — "
                     "مبروك! تقدر تسحب التوفير لمحفظتك وقتما تحب."),
               amount=g.saved_amount, reference=f"goal-{g.id}")
    await session.commit()
    return {
        "ok": True, "goal": _goal_row(g),
        "receipt": {"reference": ref, "title": f"توفير — {g.name}",
                    "amount": amount, "balance_after": user.balance,
                    "created_at": now.isoformat()},
        "message": (f"وفّرت {fmt_iqd(amount)} لهدف «{g.name}» — "
                    + (f"اكتمل الهدف 🎉 ({g.saved_amount:,} د.ع)" if just_reached
                       else f"وصل {min(round(g.saved_amount / g.target_amount * 100), 100)}%")),
    }
