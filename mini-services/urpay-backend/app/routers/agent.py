"""Agent endpoints — chat, history, clear."""
import re

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agent.engine import run_agent
from ..db import get_session
from ..models import AgentMessage, User
from ..schemas import AgentAction, AgentChatRequest, AgentChatResponse
from ..security import get_current_user

router = APIRouter(prefix="/api/agent", tags=["agent"])

PIN_MASK_RE = re.compile(r"\b(pin|بصورة|رمز)?\s*[:=]?\s*(\d{4,6})\b", re.IGNORECASE)


def _mask_pins(text: str) -> str:
    def repl(m: re.Match) -> str:
        return (m.group(1) or "") + " ••••"
    return PIN_MASK_RE.sub(repl, text)


@router.post("/chat", response_model=AgentChatResponse)
async def agent_chat(body: AgentChatRequest,
                     user: User = Depends(get_current_user),
                     session: AsyncSession = Depends(get_session)):
    stored_user_msg = _mask_pins(body.message.strip())
    session.add(AgentMessage(user_id=user.id, role="user",
                             content=stored_user_msg))
    await session.commit()

    reply, actions, provider = await run_agent(session, user, body.message)

    session.add(AgentMessage(user_id=user.id, role="assistant",
                             content=reply, provider=provider))
    await session.commit()
    await session.refresh(user)

    return AgentChatResponse(
        reply=reply,
        actions=[AgentAction(**a) for a in actions],
        provider=provider,
    )


@router.get("/history")
async def agent_history(user: User = Depends(get_current_user),
                        session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(AgentMessage).where(AgentMessage.user_id == user.id)
        .order_by(AgentMessage.created_at).limit(100))).scalars().all()
    return [{
        "role": m.role, "content": m.content,
        "provider": m.provider, "created_at": m.created_at.isoformat(),
    } for m in rows]


@router.delete("/history")
async def clear_history(user: User = Depends(get_current_user),
                        session: AsyncSession = Depends(get_session)):
    await session.execute(
        delete(AgentMessage).where(AgentMessage.user_id == user.id))
    await session.commit()
    return {"message": "تم مسح المحادثة"}
