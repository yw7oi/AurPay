"""SQLAlchemy models for UrPay."""
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
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
    # login lockout: wrong-PIN attempt tracking + escalating temporary bans
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    ban_count: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

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


class Budget(Base):
    """Per-category monthly spending limit (goal) set by the user."""
    __tablename__ = "budgets"
    __table_args__ = (UniqueConstraint("user_id", "category", name="uq_budget_user_cat"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    category: Mapped[str] = mapped_column(String(32), index=True)
    monthly_limit: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # payment | topup | transfer_in | transfer_out | transfer_request |
    # transfer_declined | bill_due | welcome | budget_exceeded |
    # scheduled_executed | scheduled_failed
    kind: Mapped[str] = mapped_column(String(32))
    title: Mapped[str] = mapped_column(String(160))
    body: Mapped[str] = mapped_column(String(280), default="")
    amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reference: Mapped[str] = mapped_column(String(32), default="", index=True)
    is_read: Mapped[bool] = mapped_column(default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class ScheduledPayment(Base):
    """User-authorized mandate for a future/recurring payment.

    Created with a one-time PIN authorization; executed automatically by the
    scheduler loop when next_run_at is due (no PIN at execution time — the
    mandate itself was PIN-authorized).
    """
    __tablename__ = "scheduled_payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # bill | transfer
    # bill mandate fields
    category: Mapped[str] = mapped_column(String(32), default="")
    biller_code: Mapped[str] = mapped_column(String(32), default="")
    biller_name: Mapped[str] = mapped_column(String(128), default="")
    subscriber_no: Mapped[str] = mapped_column(String(32), default="")
    # transfer mandate fields
    receiver_card: Mapped[str] = mapped_column(String(32), default="")
    receiver_name: Mapped[str] = mapped_column(String(128), default="")
    amount: Mapped[int] = mapped_column(Integer)
    frequency: Mapped[str] = mapped_column(String(16), default="once")  # once | monthly
    next_run_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    # pending | executed | cancelled | failed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    @property
    def label(self) -> str:
        if self.kind == "bill":
            return f"فاتورة {self.biller_name}"
        return f"حوالة إلى {self.receiver_name or self.receiver_card[-4:]}"


class SavingsGoal(Base):
    """User savings goal — earmarked money moved out of the spendable balance.

    Deposits move IQD from the wallet balance into the goal (an "out"
    transaction with category='savings'); withdrawals move it back ("in").
    Savings transactions are excluded from spending analytics/budgets —
    the money isn't spent, it's earmarked.
    """
    __tablename__ = "savings_goals"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    emoji: Mapped[str] = mapped_column(String(8), default="🎯")
    target_amount: Mapped[int] = mapped_column(Integer)
    saved_amount: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)  # active | completed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Favorite(Base):
    """Quick-transfer favorite contact (target user)."""
    __tablename__ = "favorites"
    __table_args__ = (UniqueConstraint("user_id", "target_user_id", name="uq_fav_pair"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    target_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
