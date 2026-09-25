"""Agent endpoints — chat, history, clear, SSE streaming, voice (ASR)."""
import asyncio
import base64
import json
import re

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..agent.engine import TOOL_STEP_LABELS, run_agent
from ..config import LLM_BRIDGE_SECRET, LLM_BRIDGE_URL
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


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _chunk_words(text: str, size: int = 3):
    """Split the final reply into small chunks for the typewriter effect."""
    words = text.split(" ")
    for i in range(0, len(words), size):
        yield " ".join(words[i:i + size]) + (" " if i + size < len(words) else "")


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


@router.post("/chat/stream")
async def agent_chat_stream(body: AgentChatRequest,
                            user: User = Depends(get_current_user),
                            session: AsyncSession = Depends(get_session)):
    """SSE stream: `step` events while the agent works (tool calls), then the
    final reply word-by-word as `token` events, then one `done` event with
    actions + provider. Falls back gracefully — the client keeps the legacy
    non-streaming endpoint available."""
    stored_user_msg = _mask_pins(body.message.strip())
    session.add(AgentMessage(user_id=user.id, role="user",
                             content=stored_user_msg))
    await session.commit()

    queue: asyncio.Queue = asyncio.Queue()

    async def emit(ev: dict) -> None:
        label = TOOL_STEP_LABELS.get(ev.get("tool", ""), "يشتغل…")
        await queue.put({"tool": ev.get("tool", ""), "label": label})

    async def runner():
        try:
            reply, actions, provider = await run_agent(session, user,
                                                       body.message, emit=emit)
            await queue.put({"__final__": {
                "reply": reply, "actions": actions, "provider": provider}})
        except Exception as e:  # pragma: no cover — defensive
            await queue.put({"__error__": str(e)})

    task = asyncio.create_task(runner())

    async def gen():
        try:
            while True:
                ev = await queue.get()
                if "__final__" in ev:
                    final = ev["__final__"]
                    # persist the assistant turn (task already finished using
                    # the session — no concurrent access)
                    await task
                    session.add(AgentMessage(
                        user_id=user.id, role="assistant",
                        content=final["reply"], provider=final["provider"]))
                    await session.commit()
                    for chunk in _chunk_words(final["reply"]):
                        yield _sse("token", {"t": chunk})
                        await asyncio.sleep(0.045)
                    yield _sse("done", {
                        "actions": final["actions"],
                        "provider": final["provider"],
                    })
                    break
                if "__error__" in ev:
                    await task
                    yield _sse("error", {"detail": ev["__error__"]})
                    break
                yield _sse("step", ev)
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
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


# ------------------------------------------------------------------ voice ---
@router.post("/voice")
async def agent_voice(file: UploadFile = File(...),
                      user: User = Depends(get_current_user)):
    """Transcribe a short voice note (multipart upload) to text.

    Forwards base64 audio to the Next.js z-ai ASR bridge — same secret
    handshake as the LLM bridge. Returns {"text": "..."} in Arabic.
    """
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "الملف فاضي")
    if len(raw) > 20 * 1024 * 1024:
        raise HTTPException(413, "التسجيل طويل جدًا")

    bridge_url = LLM_BRIDGE_URL.replace("/llm", "/asr")
    headers = {"X-Bridge-Secret": LLM_BRIDGE_SECRET,
               "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                bridge_url,
                json={"audio_base64": base64.b64encode(raw).decode("ascii")},
                headers=headers,
            )
    except httpx.HTTPError:
        raise HTTPException(502, "تعذر الوصول لخدمة التعرف على الصوت")

    if resp.status_code != 200:
        detail = "تعذر تحويل الصوت لنص"
        try:
            j = resp.json()
            if isinstance(j.get("detail"), str):
                detail = j["detail"]
        except Exception:  # noqa: BLE001
            pass
        raise HTTPException(502, detail)

    text = (resp.json().get("text") or "").strip()
    if not text:
        raise HTTPException(422, "ما سمعنا صوت واضح — جرب مرة ثانية")
    return {"text": text}
