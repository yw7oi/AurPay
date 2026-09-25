"""Shared notification pusher — used by wallet routers and agent tools.

Adds to the session WITHOUT committing — callers own the transaction.
"""
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Notification, utcnow


def notify(session: AsyncSession, user_id: int, *, kind: str, title: str,
           body: str = "", amount: int | None = None,
           reference: str = "") -> None:
    session.add(Notification(
        user_id=user_id, kind=kind, title=title[:160], body=body[:280],
        amount=amount, reference=reference[:32], is_read=False,
        created_at=utcnow(),
    ))
