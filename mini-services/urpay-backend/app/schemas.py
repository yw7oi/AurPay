"""Pydantic schemas."""
import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .constants import CITIES

ARABIC_NAME_RE = re.compile(r"^[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\s'’-]+$")
CARD_RE = re.compile(r"^\d{16}$")
PIN_RE = re.compile(r"^\d{6}$")


class RegisterRequest(BaseModel):
    first_name: str = Field(min_length=2, max_length=64)
    father_name: str = Field(min_length=2, max_length=64)
    family_name: str = Field(min_length=2, max_length=64)
    age: int = Field(ge=18, le=100)
    city: str
    phone: str | None = Field(default=None, min_length=11, max_length=14)
    card_number: str
    pin: str

    @field_validator("first_name", "father_name", "family_name")
    @classmethod
    def valid_name(cls, v: str) -> str:
        v = v.strip()
        if not ARABIC_NAME_RE.match(v) or len(v.replace(" ", "")) < 2:
            raise ValueError("الاسم يجب أن يحتوي حروفًا عربية فقط")
        return v

    @field_validator("city")
    @classmethod
    def valid_city(cls, v: str) -> str:
        if v not in CITIES:
            raise ValueError("اختر محافظة عراقية صحيحة")
        return v

    @field_validator("card_number")
    @classmethod
    def valid_card(cls, v: str) -> str:
        v = re.sub(r"\D", "", v)
        if not CARD_RE.match(v):
            raise ValueError("رقم البطاقة يجب أن يكون 16 رقمًا")
        return v

    @field_validator("pin")
    @classmethod
    def valid_pin(cls, v: str) -> str:
        if not PIN_RE.match(v):
            raise ValueError("الرمز السري PIN يجب أن يكون 6 أرقام")
        return v


class LoginRequest(BaseModel):
    card_number: str
    pin: str

    @field_validator("card_number")
    @classmethod
    def clean_card(cls, v: str) -> str:
        v = re.sub(r"\D", "", v)
        if not CARD_RE.match(v):
            raise ValueError("رقم البطاقة يجب أن يكون 16 رقمًا")
        return v


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    first_name: str
    father_name: str
    family_name: str
    age: int
    city: str
    district: str
    phone: str
    email: str
    card_number: str
    card_masked: str
    balance: int
    avatar_hue: int
    is_demo: bool
    created_at: datetime


class UserSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    city: str
    card_number: str
    avatar_hue: int


class AuthResponse(BaseModel):
    access_token: str
    expires_at: datetime
    user: UserPublic


class BillPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category: str
    biller_code: str
    biller_name: str
    subscriber_no: str
    amount: int
    period: str
    due_date: datetime
    status: str
    overdue: bool
    issued_at: datetime
    paid_at: datetime | None
    receipt_ref: str | None


class PayBillRequest(BaseModel):
    bill_id: int
    pin: str


class SimulateBillRequest(BaseModel):
    category: str
    biller_code: str
    subscriber_no: str = Field(min_length=3, max_length=24)
    amount: int = Field(gt=1000, le=10_000_000)


class TransferRequestIn(BaseModel):
    receiver_card: str | None = None
    receiver_id: int | None = None
    amount: int = Field(gt=0, le=100_000_000)

    @field_validator("receiver_card")
    @classmethod
    def clean_card(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = re.sub(r"\D", "", v)
        if len(v) != 16:
            raise ValueError("رقم بطاقة المستلم يجب أن يكون 16 رقمًا")
        return v


class ConfirmTransferRequest(BaseModel):
    pin: str


class TransactionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    reference: str
    type: str
    direction: str
    amount: int
    balance_after: int
    title: str
    subtitle: str
    category: str
    created_at: datetime


class Receipt(BaseModel):
    reference: str
    title: str
    subtitle: str
    amount: int
    balance_after: int
    created_at: datetime


class AgentChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class AgentAction(BaseModel):
    tool: str
    ok: bool
    data: dict | None = None
    error: str | None = None


class AgentChatResponse(BaseModel):
    reply: str
    actions: list[AgentAction] = []
    provider: str
