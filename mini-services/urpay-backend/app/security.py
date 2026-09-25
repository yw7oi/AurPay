"""Security helpers: PIN hashing + JWT tokens."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import JWT_ALGORITHM, JWT_EXPIRE_DAYS, JWT_SECRET
from .db import get_session
from .models import User

bearer = HTTPBearer(auto_error=False)


def hash_pin(pin: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", pin.encode(), salt.encode(), 60_000
    ).hex()


def make_pin_secret(pin: str) -> tuple[str, str]:
    salt = secrets.token_hex(16)
    return salt, hash_pin(pin, salt)


def verify_pin(pin: str, salt: str, expected: str) -> bool:
    return secrets.compare_digest(hash_pin(pin, salt), expected)


def create_token(user_id: int) -> tuple[str, datetime]:
    exp = datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS)
    token = jwt.encode({"sub": str(user_id), "exp": exp}, JWT_SECRET, algorithm=JWT_ALGORITHM)
    return token, exp


def decode_token(token: str) -> int | None:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return int(payload["sub"])
    except Exception:
        return None


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="رمز الدخول مفقود — يرجى تسجيل الدخول",
        )
    user_id = decode_token(creds.credentials)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="انتهت صلاحية الجلسة — سجّل الدخول من جديد",
        )
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="الحساب غير موجود")
    return user
