"""Auth endpoints — register / login / me."""
import secrets
import string
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from pydantic import BaseModel

from ..config import WELCOME_BALANCE
from ..db import get_session
from ..models import Bill, Transaction, User, utcnow
from ..schemas import AuthResponse, LoginRequest, RegisterRequest, UserPublic
from ..security import create_token, get_current_user, make_pin_secret, verify_pin
from ..constants import BILLERS

router = APIRouter(prefix="/api/auth", tags=["auth"])

REF_ALPHABET = string.ascii_uppercase + string.digits

# wrong-PIN lockout policy
MAX_PIN_ATTEMPTS = 5          # "باقي 4 محاولات" after the first miss → 5 total
BASE_BAN_MINUTES = 3         # first lockout length
MAX_BAN_MINUTES = 60         # cap for the escalating lockout


def _ref() -> str:
    return "UR-" + "".join(secrets.choice(REF_ALPHABET) for _ in range(8))


async def _starter_bills(session: AsyncSession, user: User) -> None:
    """Give every new account a few real bills to try the agent."""
    now = utcnow()
    specs = [
        ("electricity", "MOE-BGD-R", "وزارة الكهرباء — بغداد الرصافة", 45_000,
         "الشهر الحالي", 6),
        ("internet", "NET-TARIN", "تارين للاتصالات Tarin", 30_000,
         "باقة 100 غيغا", 12),
        ("water", "MOW-BGD", "ماء بغداد — عامة الماء", 8_500,
         "الربع الأول", 3),
    ]
    for cat, code, name, amount, period, due_days in specs:
        session.add(Bill(
            user_id=user.id, category=cat, biller_code=code, biller_name=name,
            subscriber_no=str(secrets.randbelow(89_999_999) + 10_000_000),
            amount=amount, period=period,
            due_date=now + __import__("datetime").timedelta(days=due_days),
            status="unpaid", issued_at=now,
        ))


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(body: RegisterRequest,
                   session: AsyncSession = Depends(get_session)):
    dup = await session.execute(
        select(User).where(User.card_number == body.card_number))
    if dup.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "هذا الرقم مسجّل مسبقًا — جرّب تسجيل الدخول")

    if body.phone:
        dup_phone = await session.execute(
            select(User).where(User.phone == body.phone))
        if dup_phone.scalar_one_or_none():
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "رقم الهاتف مستخدم من حساب آخر")

    salt, pin_hash = make_pin_secret(body.pin)
    user = User(
        first_name=body.first_name.strip(),
        father_name=body.father_name.strip(),
        family_name=body.family_name.strip(),
        full_name=f"{body.first_name.strip()} {body.father_name.strip()} {body.family_name.strip()}",
        gender="male", age=body.age, city=body.city, district="",
        phone=body.phone or f"0770{secrets.randbelow(8_999_999) + 1_000_000:07d}",
        email="", card_number=body.card_number,
        pin_salt=salt, pin_hash=pin_hash, balance=WELCOME_BALANCE,
        avatar_hue=152, created_at=utcnow(),
    )
    session.add(user)
    await session.flush()

    welcome = Transaction(
        reference=_ref(), user_id=user.id, type="topup", direction="in",
        amount=WELCOME_BALANCE, balance_after=WELCOME_BALANCE,
        title="رصيد ترحيبي من أور پاي 🎉", subtitle="هدية التسجيل — تجربة المنصة",
        category="wallet", created_at=utcnow(),
    )
    session.add(welcome)
    await _starter_bills(session, user)
    await session.commit()
    await session.refresh(user)

    token, exp = create_token(user.id)
    return AuthResponse(access_token=token, expires_at=exp, user=UserPublic.model_validate(user))


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest,
                session: AsyncSession = Depends(get_session)):
    user = (await session.execute(
        select(User).where(User.card_number == body.card_number)
    )).scalar_one_or_none()

    if user is not None and user.locked_until and user.locked_until > utcnow():
        remaining = user.locked_until - utcnow()
        minutes = max(1, int(remaining.total_seconds() // 60))
        raise HTTPException(
            status.HTTP_423_LOCKED,
            f"الحساب موقوف مؤقتًا بعد محاولات خاطئة — جرب بعد {minutes} دقيقة")

    if user is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "رقم البطاقة أو رمز الـ PIN غير صحيح")

    if not verify_pin(body.pin, user.pin_salt, user.pin_hash):
        user.failed_attempts = (user.failed_attempts or 0) + 1
        if user.failed_attempts >= MAX_PIN_ATTEMPTS:
            # lock the account — ban length doubles with each consecutive
            # lockout (3, 6, 12 … minutes) and caps at MAX_BAN_MINUTES
            ban_minutes = min(
                BASE_BAN_MINUTES * (2 ** (user.ban_count or 0)),
                MAX_BAN_MINUTES)
            user.locked_until = utcnow() + timedelta(minutes=ban_minutes)
            user.ban_count = (user.ban_count or 0) + 1
            user.failed_attempts = 0
            await session.commit()
            raise HTTPException(
                status.HTTP_423_LOCKED,
                f"انتهت المحاولات — الحساب موقوف لمدة {ban_minutes} دقيقة")
        await session.commit()
        left = MAX_PIN_ATTEMPTS - user.failed_attempts
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            f"رقم البطاقة أو رمز الـ PIN غير صحيح — باقي {left} "
            f"{'محاولة' if left == 1 else 'محاولات'}")

    # success — clear the lockout state
    if user.failed_attempts or user.locked_until or user.ban_count:
        user.failed_attempts = 0
        user.locked_until = None
        user.ban_count = 0
        await session.commit()

    token, exp = create_token(user.id)
    return AuthResponse(access_token=token, expires_at=exp, user=UserPublic.model_validate(user))


@router.get("/me", response_model=UserPublic)
async def me(user: User = Depends(get_current_user)):
    return user


class ChangePinRequest(BaseModel):
    current_pin: str
    new_pin: str


@router.post("/change-pin")
async def change_pin(body: ChangePinRequest,
                     user: User = Depends(get_current_user),
                     session: AsyncSession = Depends(get_session)):
    """Update the wallet PIN — requires the current PIN."""
    import re as _re

    if not verify_pin(body.current_pin, user.pin_salt, user.pin_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "رمز الـ PIN الحالي غير صحيح")
    if not _re.fullmatch(r"\d{6}", body.new_pin):
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "الرمز الجديد لازم يكون 6 أرقام")
    if body.new_pin == body.current_pin:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "الرمز الجديد نفس القديم — اختر رمزًا مختلفًا")

    user.pin_salt, user.pin_hash = make_pin_secret(body.new_pin)
    await session.commit()
    return {"message": "تم تحديث رمز الـ PIN بنجاح"}
