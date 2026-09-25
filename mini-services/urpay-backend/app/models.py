"""SQLAlchemy models for UrPay."""
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(64))
    father_name: Mapped[str] = mapped_column(String(64))
    family_name: Mapped[str] = mapped_column(String(64))
    full_name: Mapped[str] = mapped_column(String(192), index=True)
    gender: Mapped[str] = mapped_column(String(16), default="male")
    age: Mapped[int] = mapped_column(Integer)
    city: Mapped[str] = mapped_column(String(64), index=True)
    district: Mapped[str] = mapped_column(String(64), default="")
    phone: Mapped[str] = mapped_column(String(32), unique=True)
    email: Mapped[str] = mapped_column(String(128), default="")
    card_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    pin_salt: Mapped[str] = mapped_column(String(64))
    pin_hash: Mapped[str] = mapped_column(String(128))
    balance: Mapped[int] = mapped_column(Integer, default=0)
    avatar_hue: Mapped[int] = mapped_column(Integer, default=152)
    is_demo: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    @property
    def card_masked(self) -> str:
        return f"•••• •••• •••• {self.card_number[-4:]}"


class Bill(Base):
    __tablename__ = "bills"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    category: Mapped[str] = mapped_column(String(32), index=True)
    biller_code: Mapped[str] = mapped_column(String(32))
    biller_name: Mapped[str] = mapped_column(String(128))
    subscriber_no: Mapped[str] = mapped_column(String(32))
    amount: Mapped[int] = mapped_column(Integer)
    period: Mapped[str] = mapped_column(String(64), default="")
    due_date: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(16), default="unpaid", index=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    receipt_ref: Mapped[str | None] = mapped_column(String(32), nullable=True)

    @property
    def overdue(self) -> bool:
        return self.status == "unpaid" and self.due_date < utcnow()


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    # shared between the two sides of a transfer (out/in) — indexed, not unique
    reference: Mapped[str] = mapped_column(String(32), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[str] = mapped_column(String(32))  # bill_payment | transfer_out | transfer_in | topup
    direction: Mapped[str] = mapped_column(String(8))  # out | in
    amount: Mapped[int] = mapped_column(Integer)
    balance_after: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(128))
    subtitle: Mapped[str] = mapped_column(String(192), default="")
    category: Mapped[str] = mapped_column(String(32), default="wallet")
    counterparty_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    bill_id: Mapped[int | None] = mapped_column(ForeignKey("bills.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class TransferRequest(Base):
    __tablename__ = "transfer_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    receiver_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    amount: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|confirmed|cancelled
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AgentMessage(Base):
    __tablename__ = "agent_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(String(16))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(String(16), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # payment | topup | transfer_in | transfer_out | transfer_request |
    # transfer_declined | bill_due | welcome
    kind: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(String(280), default="")
    amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reference: Mapped[str] = mapped_column(String(32), default="", index=True)
    is_read: Mapped[bool] = mapped_column(default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
