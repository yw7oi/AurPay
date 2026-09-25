"""LLM providers for the Bill Pay Agent.

Priority:
1. Groq — native function calling with `openai/gpt-oss-120b` (set GROQ_API_KEY).
2. z-ai bridge — Node route on the Next.js server using z-ai-web-dev-sdk
   (works out of the box in the sandbox / no key needed).
3. Local deterministic Arabic intent engine (always available, offline).
"""
import json
import logging
import re

import httpx

from ..config import AGENT_MODEL, GROQ_API_KEY, GROQ_BASE_URL, LLM_BRIDGE_SECRET, LLM_BRIDGE_URL

log = logging.getLogger("urpay.agent")


def groq_available() -> bool:
    return bool(GROQ_API_KEY)


async def groq_chat(messages: list[dict], tools: list[dict]) -> dict:
    """Call Groq chat completions (OpenAI-compatible). Returns
    {"content": str} or {"tool_calls": [{"name","args"}]}."""
    payload: dict = {
        "model": AGENT_MODEL,
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 1200,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"

    headers = {"Authorization": f"Bearer {GROQ_API_KEY}",
               "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=45) as client:
        resp = await client.post(f"{GROQ_BASE_URL}/chat/completions",
                                 json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    choice = data["choices"][0]["message"]
    if choice.get("tool_calls"):
        calls = []
        for tc in choice["tool_calls"]:
            fn = tc.get("function", {})
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            calls.append({"name": fn.get("name", ""), "args": args})
        return {"tool_calls": calls}
    return {"content": choice.get("content") or ""}


async def bridge_available() -> bool:
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            resp = await client.get(
                LLM_BRIDGE_URL.replace("/llm", "/health"),
                headers={"X-Bridge-Secret": LLM_BRIDGE_SECRET},
            )
            return resp.status_code == 200
    except Exception:
        return False


async def zai_bridge_chat(messages: list[dict], tool_schema_text: str) -> dict:
    """Call the Node z-ai bridge. The model is instructed to answer in strict
    JSON: {"tool": "...", "args": {...}} or {"reply": "..."}."""
    headers = {"X-Bridge-Secret": LLM_BRIDGE_SECRET,
               "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            LLM_BRIDGE_URL,
            json={"messages": messages, "tool_schema_text": tool_schema_text},
            headers=headers,
        )
        resp.raise_for_status()
        content = resp.json().get("content", "")

    parsed = extract_json(content)
    if parsed is None:
        return {"content": content}
    if "tool" in parsed:
        return {"tool_calls": [{"name": parsed["tool"],
                                "args": parsed.get("args", {})}]}
    return {"content": parsed.get("reply", content)}


def extract_json(text: str) -> dict | None:
    """Best-effort extraction of the first JSON object in a reply."""
    if not text:
        return None
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        obj = json.loads(match.group(0))
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None
