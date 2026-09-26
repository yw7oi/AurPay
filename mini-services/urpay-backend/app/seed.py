"""Seed the database with ~100 realistic Iraqi users, bills and transactions.

Deterministic (fixed RNG seed) so demo data is stable across restarts.
All seeded users share PIN 123456 (demo). The first two users are highlighted
demo accounts surfaced via /api/stats.
"""
import asyncio
import random
import secrets
import string
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .constants import (
    AR_MONTHS, BILLERS, CITY_DISTRICTS, EMAIL_DOMAINS, FAMILY_NAMES,
    FEMALE_FIRST, MALE_FIRST, MIDDLE_NAMES, MOBILE_PREFIXES, TRANSLIT,
)
from .models import Bill, Transaction, User, utcnow
from .security import make_pin_secret

rng = random.Random(20260928)  # hackathon submission date — stable seed


def luhn_complete(base15: str) -> str:
    """Append the Luhn check digit to a 15-digit base."""
    digits = [int(d) for d in base15]
    total, alt = 0, True
    for d in reversed(digits):
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return base15 + str((10 - total % 10) % 10)


def gen_reference() -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "UR-" + "".join(rng.choices(alphabet, k=8))


def gen_card(prefix: str) -> str:
    body = "".join(rng.choices(string.digits, k=11))
    return luhn_complete(prefix + body)


def gen_phone() -> str:
    prefix, _ = rng.choice(MOBILE_PREFIXES)
    return prefix + "".join(rng.choices(string.digits, k=7))


def transliterate(name: str) -> str:
    return TRANSLIT.get(name, "urpay").replace(" ", "")


def make_person(index: int, is_demo: bool = False, demo: dict | None = None) -> dict:
    if demo:
        p = dict(demo)
        p["card_number"] = luhn_complete(p["card_base"])
        salt, pin_hash = make_pin_secret("123456")
        p.update(pin_salt=salt, pin_hash=pin_hash)
        return p

    gender = "female" if rng.random() < 0.42 else "male"
    first = rng.choice(FEMALE_FIRST if gender == "female" else MALE_FIRST)
    middle = rng.choice(MIDDLE_NAMES)
    use_family = rng.random() < 0.38
    # third part = grandfather (male name) or tribal family name
    family = rng.choice(FAMILY_NAMES) if use_family else rng.choice(MIDDLE_NAMES)
    # avoid identical triple parts
    if family == middle:
        family = rng.choice(FAMILY_NAMES)

    city = rng.choices(
        population=["بغداد", "البصرة", "الموصل", "أربيل", "النجف", "كربلاء",
                    "السليمانية", "كركوك", "بابل", "ذي قار", "الأنبار", "ديالى",
                    "واسط", "ميسان", "المثنى", "صلاح الدين", "دهوك", "حلبجة"],
        weights=[28, 10, 9, 7, 7, 6, 6, 6, 5, 4, 4, 3, 3, 2, 2, 3, 2, 1],
        k=1,
    )[0]
    districts = CITY_DISTRICTS.get(city)
    district = rng.choice(districts) if districts else ""

    age = rng.randint(19, 64)
    phone = gen_phone()
    first_email = transliterate(first)
    last_email = transliterate(family if use_family else middle)
    email = f"{first_email}.{last_email}{rng.randint(1, 99)}@{rng.choice(EMAIL_DOMAINS)}"
    card = gen_card(rng.choice(["4539", "4539", "4539", "5512", "5210"]))
    salt, pin_hash = make_pin_secret("123456")

    return {
        "first_name": first,
        "father_name": middle,
        "family_name": family,
        "full_name": f"{first} {middle} {family}",
        "gender": gender,
        "age": age,
        "city": city,
        "district": district,
        "phone": phone,
        "email": email,
        "card_number": card,
        "pin_salt": salt,
        "pin_hash": pin_hash,
        "balance": 0,
        "avatar_hue": rng.choice([14, 26, 40, 88, 120, 142, 152, 168, 200, 262, 292, 330]),
        "is_demo": False,
        "initial_balance": rng.randrange(400_000, 4_000_000, 25_000),
    }


def make_bills_for(user: dict) -> list[dict]:
    """Generate unpaid + paid bills for a seeded user."""
    bills: list[dict] = []
    now = utcnow()

    categories = list(BILLERS.keys())
    unpaid_count = rng.randint(2, 5)
    chosen = rng.sample(categories, k=min(unpaid_count, len(categories)))
    for cat in chosen:
        biller = rng.choice(BILLERS[cat])
        if cat == "mobile":
            amount = rng.randrange(10_000, 60_000, 5_000)
        elif cat == "internet":
            amount = rng.randrange(25_000, 90_000, 5_000)
        elif cat == "traffic":
            amount = rng.randrange(15_000, 75_000, 5_000)
        elif cat == "education":
            amount = rng.randrange(50_000, 350_000, 25_000)
        elif cat == "water":
            amount = rng.randrange(5_000, 25_000, 1_000)
        elif cat == "health":
            amount = rng.randrange(20_000, 250_000, 5_000)
        elif cat == "gas":
            amount = rng.randrange(6_000, 30_000, 2_000)
        else:
            amount = rng.randrange(10_000, 120_000, 5_000)

        m = rng.randint(0, 11)
        period = f"{AR_MONTHS[(now.month - 1 - m) % 12]} {now.year - (1 if m >= now.month else 0)}"
        # overdue 45% of the time
        due = now + timedelta(days=rng.randint(2, 20)) if rng.random() > 0.45 \
            else now - timedelta(days=rng.randint(1, 12))
        bills.append({
            "category": cat, "biller_code": biller["code"], "biller_name": biller["name"],
            "subscriber_no": str(rng.randint(10_000_000, 99_999_999)),
            "amount": amount, "period": period, "due_date": due, "status": "unpaid",
            "issued_at": now - timedelta(days=rng.randint(5, 30)),
        })

    paid_count = rng.randint(2, 4)
    for _ in range(paid_count):
        cat = rng.choice(categories)
        biller = rng.choice(BILLERS[cat])
        paid_at = now - timedelta(days=rng.randint(3, 55))
        m = rng.randint(1, 3)
        period = f"{AR_MONTHS[(paid_at.month - 1 - m) % 12]} {paid_at.year - (1 if m >= paid_at.month else 0)}"
        amount = rng.randrange(10_000, 90_000, 5_000)
        bills.append({
            "category": cat, "biller_code": biller["code"], "biller_name": biller["name"],
            "subscriber_no": str(rng.randint(10_000_000, 99_999_999)),
            "amount": amount, "period": period,
            "due_date": paid_at + timedelta(days=rng.randint(5, 25)),
            "status": "paid", "issued_at": paid_at - timedelta(days=rng.randint(5, 20)),
            "paid_at": paid_at,
        })
    return bills


def make_extra_events(user: dict) -> list[dict]:
    """Top-ups + agent-bill payments events (non-bill ledger entries)."""
    events: list[dict] = []
    now = utcnow()
    for _ in range(rng.randint(1, 3)):
        carrier = "زين العراق Zain Iraq"
        events.append({
            "kind": "topup",
            "at": now - timedelta(days=rng.randint(2, 55)),
            "amount": rng.randrange(10_000, 50_000, 5_000),
            "title": f"شحن رصيد {carrier}",
            "subtitle": f"عبر أور پاي — رقم {user['phone'][-4:]}",
            "category": "mobile",
            "direction": "out",
        })
    return events


async def seed_if_empty(session: AsyncSession) -> dict:
    count = await session.scalar(select(func.count(User.id)))
    if count and count > 0:
        demo = (await session.execute(
            select(User).where(User.is_demo == True)  # noqa: E712
            .order_by(User.id).limit(1)
        )).scalar_one_or_none()
        return {"seeded": False, "users": count,
                "demo_card": demo.card_number if demo else None}

    now = utcnow()

    demo_specs = [
        {"card_base": "453912341234123", "first_name": "أحمد", "father_name": "علي",
         "family_name": "حسين", "full_name": "أحمد علي حسين", "gender": "male",
         "age": 27, "city": "بغداد", "district": "الكرادة",
         "phone": "07701234567", "email": "ahmed.ali@urpay.iq",
         "balance": 0, "avatar_hue": 152, "is_demo": True, "initial_balance": 1_850_000},
        {"card_base": "453955554444123", "first_name": "زينب", "father_name": "مرتضى",
         "family_name": "الموسوي", "full_name": "زينب مرتضى الموسوي", "gender": "female",
         "age": 24, "city": "النجف", "district": "الغريّات",
         "phone": "07719876543", "email": "zainab.m@urpay.iq",
         "balance": 0, "avatar_hue": 330, "is_demo": True, "initial_balance": 950_000},
    ]

    total = 100
    people = []
    for i, spec in enumerate(demo_specs):
        people.append(make_person(i, is_demo=True, demo=spec))
    while len(people) < total:
        people.append(make_person(len(people)))

    # --- insert users -----------------------------------------------------
    user_rows: list[User] = []
    for p in people:
        row = User(
            first_name=p["first_name"], father_name=p["father_name"],
            family_name=p["family_name"], full_name=p["full_name"],
            gender=p.get("gender", "male"), age=p["age"], city=p["city"],
            district=p.get("district", ""), phone=p["phone"], email=p.get("email", ""),
            card_number=p["card_number"], pin_salt=p["pin_salt"],
            pin_hash=p["pin_hash"], balance=p.get("initial_balance", 0),
            avatar_hue=p.get("avatar_hue", 152), is_demo=p.get("is_demo", False),
            created_at=now - timedelta(days=rng.randint(10, 300)),
        )
        session.add(row)
        user_rows.append(row)
    await session.flush()

    # --- bills + events ---------------------------------------------------
    # events: dict(kind, at, amount, title, direction, user_idx, bill_row?, pair_ref?)
    all_events: list[dict] = []
    transfer_pairs: list[dict] = []

    for idx, (p, urow) in enumerate(zip(people, user_rows)):
        for b in make_bills_for(p):
            bill = Bill(
                user_id=urow.id, category=b["category"], biller_code=b["biller_code"],
                biller_name=b["biller_name"], subscriber_no=b["subscriber_no"],
                amount=b["amount"], period=b["period"], due_date=b["due_date"],
                status=b["status"], issued_at=b["issued_at"], paid_at=b.get("paid_at"),
            )
            session.add(bill)
            await session.flush()
            if b["status"] == "paid":
                all_events.append({
                    "kind": "bill_payment", "at": b["paid_at"], "amount": b["amount"],
                    "title": f"فاتورة {b['biller_name']}", "subtitle": b["period"],
                    "category": b["category"], "direction": "out",
                    "user_idx": idx, "bill_id": bill.id,
                })
        for ev in make_extra_events(p):
            ev["user_idx"] = idx
            all_events.append(ev)

    # cross-user transfers
    n_transfers = 160
    for _ in range(n_transfers):
        s, r = rng.sample(range(total), 2)
        amount = rng.randrange(10_000, 150_000, 5_000)
        at = now - timedelta(days=rng.randint(1, 55), hours=rng.randint(0, 23))
        pair_ref = secrets.token_hex(6)
        transfer_pairs.append({
            "sender_idx": s, "receiver_idx": r, "amount": amount, "at": at,
            "ref": pair_ref,
        })
        all_events.append({
            "kind": "transfer_out", "at": at, "amount": amount,
            "title": f"حوالة إلى {people[r]['full_name']}",
            "subtitle": f"بطاقة …{people[r]['card_number'][-4:]}",
            "category": "transfer", "direction": "out", "user_idx": s,
            "pair_ref": pair_ref,
        })
        all_events.append({
            "kind": "transfer_in", "at": at + timedelta(seconds=1), "amount": amount,
            "title": f"حوالة من {people[s]['full_name']}",
            "subtitle": f"بطاقة …{people[s]['card_number'][-4:]}",
            "category": "transfer", "direction": "in", "user_idx": r,
            "pair_ref": pair_ref,
        })

    # --- run ledgers, drop overdrafting transfer pairs --------------------
    ledgers: dict[int, list[dict]] = {}
    for ev in all_events:
        ledgers.setdefault(ev["user_idx"], []).append(ev)

    final_balances = {}
    dropped_pairs: set[str] = set()
    for idx, events in ledgers.items():
        events.sort(key=lambda e: e["at"])
        bal = people[idx].get("initial_balance", 0)
        for ev in events:
            if ev["direction"] == "out":
                if bal - ev["amount"] < 0:
                    if ev.get("pair_ref"):
                        dropped_pairs.add(ev["pair_ref"])
                    continue
                bal -= ev["amount"]
            else:
                bal += ev["amount"]
            ev["balance_after"] = bal
        final_balances[idx] = bal

    # if a pair's incoming side existed but sender dropped it, drop receiver too
    events_out: list[dict] = []
    for idx, events in ledgers.items():
        kept = []
        for ev in events:
            if ev.get("pair_ref") in dropped_pairs:
                continue
            kept.append(ev)
        events_out.extend(kept)

    # recompute running balances cleanly after drops
    ledgers2: dict[int, list[dict]] = {}
    for ev in events_out:
        ledgers2.setdefault(ev["user_idx"], []).append(ev)
    for idx, events in ledgers2.items():
        events.sort(key=lambda e: e["at"])
        bal = people[idx].get("initial_balance", 0)
        for ev in events:
            if ev["direction"] == "out":
                bal -= ev["amount"]
            else:
                bal += ev["amount"]
            ev["balance_after"] = bal
        # guarantee a healthy floor
        if bal < 50_000:
            rescue = {
                "kind": "topup", "at": events[0]["at"] - timedelta(hours=1) if events else now - timedelta(days=56),
                "amount": 500_000, "title": "إيداع رصيد — كاش ديبوزيت",
                "subtitle": "وكالة أور پاي — بغداد", "category": "wallet",
                "direction": "in", "user_idx": idx, "balance_after": bal + 500_000,
            }
            events.insert(0, rescue)
            bal += 500_000
            for ev in events[1:]:
                if ev["direction"] == "out":
                    bal -= ev["amount"]
                else:
                    bal += ev["amount"]
                ev["balance_after"] = bal
        final_balances[idx] = bal
        user_rows[idx].balance = bal

    # --- persist transactions + link paid bills ---------------------------
    bill_receipts: dict[int, str] = {}
    for ev in events_out:
        ref = gen_reference()
        txn = Transaction(
            reference=ref, user_id=user_rows[ev["user_idx"]].id, type=ev["kind"],
            direction=ev["direction"], amount=ev["amount"],
            balance_after=ev["balance_after"], title=ev["title"],
            subtitle=ev.get("subtitle", ""), category=ev["category"],
            bill_id=ev.get("bill_id"), created_at=ev["at"],
        )
        session.add(txn)
        if ev["kind"] == "bill_payment" and ev.get("bill_id"):
            bill_receipts[ev["bill_id"]] = ref

    await session.flush()
    for bill_id, ref in bill_receipts.items():
        bill = await session.get(Bill, bill_id)
        if bill:
            bill.receipt_ref = ref
    await session.commit()

    demo_card = user_rows[0].card_number if user_rows else None
    return {"seeded": True, "users": len(user_rows), "demo_card": demo_card}


if __name__ == "__main__":
    async def _main():
        from .db import init_db, session_factory
        await init_db()
        async with session_factory() as s:
            result = await seed_if_empty(s)
            print("Seed result:", result)

    asyncio.run(_main())
