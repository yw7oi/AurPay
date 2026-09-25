"""Bill Pay Agent engine — agentic loop with tools + deterministic fallback."""
import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..constants import CATEGORY_AR
from ..models import AgentMessage, Budget, User
from . import providers, tools as T
from .providers import extract_json

log = logging.getLogger("urpay.agent")

# multi-turn pending actions for the deterministic engine
_pending: dict[int, dict] = {}

# UI labels for live agent tool steps (streamed to the client)
TOOL_STEP_LABELS = {
    "get_balance": "يفحص رصيدك…",
    "list_bills": "يراجع فواتيرك…",
    "pay_bill": "ينفّذ الدفع…",
    "search_users": "يدوّر على المستلم…",
    "transfer_money": "ينفّذ الحوالة…",
    "recent_transactions": "يراجع معاملاتك…",
    "topup_wallet": "يعبّي المحفظة…",
    "get_profile": "يجيب بياناتك…",
    "set_budget": "يضبط ميزانيتك…",
    "get_spending": "يحلل صرفك…",
}

SYSTEM_PROMPT = """أنت "أور" — المساعد الذكي (AI Agent) داخل محفظة أور پاي (UrPay)، منصة الدفع العراقية.
دورك: مساعدة المستخدم على استعلام رصيده، عرض فواتيره، دفع الفواتير، التحويل بين المستخدمين، ومراجعة معاملاته — كل ذلك من خلال المحادثة.

قواعد صارمة:
1. ردّ دائمًا بلغة المستخدم (العربية العراقية الفصيحة المبسطة افتراضيًا، والإنجليزية إن كتب بالإنجليزية).
2. أي عملية دفع أو تحويل تتطلب رمز PIN — اطلبه من المستخدم إذا لم يذكره. لا تخترع PIN أبدًا.
3. قبل تنفيذ الدفع أكّد للمستخدم الفاتورة والمبلغ، وبعد التنفيذ اذكر الرقم المرجعي (reference) والرصيد الجديد.
4. المبالغ بالدينار العراقي (د.ع). استخدم تنسيق أرقام واضحًا.
5. لا تخترع بيانات — استخدم نتائج الأدوات فقط. إن لم تجد شيئًا قل ذلك بصراحة.
6. كن ودودًا ومختصرًا (٢-٥ جمل غالبًا). يمكنك اقتراح خطوة تالية مفيدة.
7. لا تكشف رقم البطاقة كاملًا أو الـ PIN لأي أحد، ويمكنك إظهار آخر 4 أرقام فقط.
8. عند الدفع: تحقق أن رقم الفاتورة (bill_id) يطابق بالضبط الفاتورة التي طلبها المستخدم (الصنف والجهة). مرر دائمًا `hint` بكلمات المستخدم إلى pay_bill — النظام يرفض الدفع إذا لم تتطابق. إذا رفض النظام العملية (wrong_bill) فأعد فحص list_bills واختر الرقم الصحيح.
9. الميزانيات: المستخدم ممكن يطلب تحديد حد شهري لتصنيف (مثال: «ميزانية الكهرباء 150 ألف») — استخدم set_budget. إذًا صرفَه تجاوز الحد، أبلغه بذلك ولطفًا اقترح رفعه أو تقليص الصرف. لا تحتاج PIN لتعيين ميزانية (ما هي عملية مالية مباشرة).
10. صرف المستخدم: عندما يسأل عن صرفه («شكد صرفي على الكهرباء؟» / «فين تروح فلوسي؟») استخدم get_spending وأجبه بالأرقام. إذا كان صرفه قريب من حد الميزانية (80%+) أو تجاوزها، نبّهه بلطف واستخدم نفس بيانات الصرف المعطاة في السياق أعلاه دون أدوات إضافية إن كانت كافية.

 persona: اسمك "أور" — مستوحى من مدينة أور السومرية حيث سُجّلت أولى عمليات التبادل في التاريخ.
"""

BRIDGE_JSON_INSTRUCTION = """
أنت تملك أدوات (tools) يمكنك استدعاؤها. مخطط الأدوات:
{tool_schema_text}

متى تريد تنفيذ أداة، ردّ بـ JSON صرف فقط بدون أي نص آخر بالشكل:
{{"tool": "اسم_الأداة", "args": {{...}}}}
وإذا أردت الردّ النهائي على المستخدم ردّ بـ JSON صرف:
{{"reply": "نص الرد"}}
لا تكتب أي شيء خارج JSON. لا تستخدم markdown.
"""


def _detect_lang(text: str) -> str:
    """Rough script detection: Arabic vs Latin (default Arabic)."""
    arabic = len(re.findall(r"[\u0600-\u06FF]", text))
    latin = len(re.findall(r"[A-Za-z]", text))
    if arabic == 0 and latin >= 3:
        return "en"
    return "ar"


LANG_DIRECTIVE = {
    "en": ("\n\nتوجيه لغة: المستخدم يكتب بالإنجليزية — ردّ عليه بالإنجليزية فقط "
           "(يمكنك إبقاء أسماء الجهات العراقية والمبالغ كما هي)."),
    "ar": "",
}

TOOL_SCHEMAS = [
    {"type": "function", "function": {
        "name": "get_balance",
        "description": "Get the current wallet balance in IQD.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "list_bills",
        "description": "List the user's bills (unpaid by default) with id, category, biller, amount, due date.",
        "parameters": {"type": "object", "properties": {
            "status": {"type": "string", "enum": ["unpaid", "paid", "all"]}}}}},
    {"type": "function", "function": {
        "name": "pay_bill",
        "description": "Pay an unpaid bill. Requires the bill id AND the user's PIN. Pass `hint` with the biller/category words the user mentioned (e.g. 'كهرباء', 'ماء', 'internet') — it is validated to prevent paying the wrong bill. If the PIN was not provided, ask the user for it instead of calling this tool.",
        "parameters": {"type": "object", "required": ["bill_id", "pin"], "properties": {
            "bill_id": {"type": "integer"},
            "pin": {"type": "string"},
            "hint": {"type": "string"}}}}},
    {"type": "function", "function": {
        "name": "search_users",
        "description": "Search registered UrPay users by (partial) name or card digits — used before transfers.",
        "parameters": {"type": "object", "required": ["query"], "properties": {
            "query": {"type": "string"}}}}},
    {"type": "function", "function": {
        "name": "transfer_money",
        "description": "Transfer IQD to another user by their 16-digit card number. Requires amount and the user's PIN. If the PIN was not provided, ask the user first.",
        "parameters": {"type": "object", "required": ["receiver_card", "amount", "pin"], "properties": {
            "receiver_card": {"type": "string"},
            "amount": {"type": "integer"},
            "pin": {"type": "string"}}}}},
    {"type": "function", "function": {
        "name": "recent_transactions",
        "description": "Show the user's recent wallet transactions.",
        "parameters": {"type": "object", "properties": {
            "limit": {"type": "integer"}}}}},
    {"type": "function", "function": {
        "name": "topup_wallet",
        "description": "Credit the user's wallet with IQD (simulated cash-in at an UrPay kiosk). Requires amount and the user's PIN. If the PIN was not provided, ask the user first.",
        "parameters": {"type": "object", "required": ["amount", "pin"], "properties": {
            "amount": {"type": "integer"},
            "pin": {"type": "string"}}}}},
    {"type": "function", "function": {
        "name": "get_profile",
        "description": "Get the current user's profile (name, city, masked card).",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "set_budget",
        "description": "Set (or remove) a monthly spending limit for a category. Categories: electricity, water, internet, mobile, education, traffic, transfer. A limit of 0 removes the budget. No PIN required (not a money movement). Also returns month-to-date spend for the category.",
        "parameters": {"type": "object", "required": ["category", "monthly_limit"], "properties": {
            "category": {"type": "string", "enum": ["electricity", "water", "internet", "mobile", "education", "traffic", "transfer"]},
            "monthly_limit": {"type": "integer", "minimum": 0}}}}},
    {"type": "function", "function": {
        "name": "get_spending",
        "description": "Get the user's month-to-date spending breakdown by category, with monthly budget limits and status (ok / near 80%+ / over). Use it when the user asks how much they spent (e.g. 'شكد صرفي على الكهرباء هذا الشهر') or where their money goes.",
        "parameters": {"type": "object", "properties": {}}}},
]


async def _execute_tool(session: AsyncSession, user: User,
                        name: str, args: dict) -> dict:
    if name == "get_balance":
        return await T.get_balance(session, user)
    if name == "list_bills":
        return await T.list_bills(session, user, args.get("status", "unpaid"))
    if name == "pay_bill":
        return await T.pay_bill(session, user, int(args.get("bill_id", 0)),
                                str(args.get("pin", "")),
                                str(args.get("hint", "")))
    if name == "search_users":
        return await T.search_users(session, user, str(args.get("query", "")))
    if name == "transfer_money":
        return await T.transfer_money(session, user, str(args.get("receiver_card", "")),
                                      int(args.get("amount", 0)), str(args.get("pin", "")))
    if name == "recent_transactions":
        return await T.recent_transactions(session, user, args.get("limit", 5))
    if name == "topup_wallet":
        return await T.topup_wallet(session, user, args.get("amount", 0),
                                    str(args.get("pin", "")))
    if name == "get_profile":
        return await T.get_profile(session, user)
    if name == "set_budget":
        return await T.set_budget(session, user, str(args.get("category", "")),
                                  args.get("monthly_limit", 0))
    if name == "get_spending":
        return await T.get_spending(session, user)
    return {"error": f"unknown tool {name}"}


def _tool_summary_for_actions(name: str, result: dict) -> dict | None:
    """Extract a UI-friendly action record when a tool produced a receipt."""
    if name == "pay_bill" and result.get("ok"):
        return {"tool": "pay_bill", "ok": True, "data": result["receipt"]}
    if name == "transfer_money" and result.get("ok"):
        return {"tool": "transfer_money", "ok": True, "data": result["receipt"]}
    if name == "topup_wallet" and result.get("ok"):
        return {"tool": "topup_wallet", "ok": True, "data": result["receipt"]}
    return None


async def _context_block(session: AsyncSession, user: User, unpaid: dict) -> str:
    bills_txt = ""
    for b in unpaid.get("bills", [])[:10]:
        flag = " (متأخرة!)" if b["overdue"] else ""
        bills_txt += (
            f"\n- فاتورة رقم {b['id']} [{b['category']}] {b['biller']} — "
            f"{b['amount']:,} د.ع — تستحق {b['due_date'][:10]}{flag}"
        )

    # budgets + month-to-date spend so the agent can warn proactively
    budget_txt = ""
    try:
        spend = await T.get_spending(session, user)
        budgeted = [c for c in spend["categories"] if "monthly_limit" in c]
        unbudgeted = [c for c in spend["categories"] if "monthly_limit" not in c
                      and c["spent"] > 0]
        if budgeted:
            budget_txt = "\nميزانياته وحدود الصرف لهذا الشهر:"
            for c in budgeted:
                status = {"ok": "ضمن الحد", "near": "⚠️ قرب الحد",
                          "over": "🚨 تجاوز الحد"}.get(c["status"], "")
                budget_txt += (f"\n- {c['name_ar']}: صرف {c['spent']:,} من حد "
                               f"{c['monthly_limit']:,} د.ع ({c['pct']}%) — {status}")
        else:
            budget_txt = "\nما عنده ميزانيات معينة بعد."
        if unbudgeted:
            rest = "، ".join(f"{c['name_ar']} {c['spent']:,}" for c in unbudgeted[:5])
            budget_txt += f"\nصرفه هذا الشهر على باقي التصنيفات: {rest} د.ع."
        budget_txt += (f"\nمجموع صرفه هذا الشهر: {spend['total_spent_this_month']:,} د.ع.")
    except Exception as e:  # context enhancement must never break the agent
        log.warning("spending context failed: %s", e)

    return (
        f"بيانات المستخدم الحالي: الاسم {user.full_name}، المحافظة {user.city}، "
        f"بطاقة ••••{user.card_number[-4:]}، الرصيد الحالي {user.balance:,} د.ع."
        f"\nفواتيره غير المدفوعة حاليًا:{bills_txt or ' (لا توجد)'}"
        f"{budget_txt}"
    )


def _mask_pin(text: str, pin: str) -> str:
    if pin and pin in text:
        return text.replace(pin, "•" * len(pin))
    return text


async def run_agent(session: AsyncSession, user: User, message: str,
                    emit=None) -> tuple[str, list[dict], str]:
    """Returns (reply, actions, provider). `emit` (optional) is awaited with
    {"tool": name} after each executed tool call — used for SSE streaming."""
    actions: list[dict] = []

    # --- provider chain ----------------------------------------------------
    if providers.groq_available():
        provider = "groq"
        try:
            reply = await _llm_loop(session, user, message, actions,
                                     mode="groq", emit=emit)
            return reply, actions, provider
        except Exception as e:
            log.warning("Groq provider failed: %s", e)

    if await providers.bridge_available():
        provider = "zai"
        try:
            reply = await _llm_loop(session, user, message, actions,
                                     mode="zai", emit=emit)
            return reply, actions, provider
        except Exception as e:
            log.warning("z-ai bridge failed: %s", e)

    provider = "local"
    reply = await local_engine(session, user, message, actions, emit=emit)
    return reply, actions, provider


async def _llm_loop(session: AsyncSession, user: User, message: str,
                    actions: list[dict], mode: str, emit=None) -> str:
    history = (await session.execute(
        _history_query(user.id)
    )).scalars().all()

    unpaid = await T.list_bills(session, user, "unpaid")

    llm_messages: list[dict] = [{
        "role": "system",
        "content": (SYSTEM_PROMPT + "\n" + await _context_block(session, user, unpaid)
                     + LANG_DIRECTIVE[_detect_lang(message)]),
    }]
    for m in history[-12:]:
        llm_messages.append({"role": m.role, "content": m.content})
    llm_messages.append({"role": "user", "content": message})

    tool_schema_text = "\n".join(
        f"- {t['function']['name']}: {t['function']['description']} "
        f"args={json_dumps_compact(t['function']['parameters'])}"
        for t in TOOL_SCHEMAS
    )

    for _round in range(6):
        if mode == "groq":
            out = await providers.groq_chat(llm_messages, TOOL_SCHEMAS)
        else:
            sys = llm_messages[0]["content"] + "\n" + BRIDGE_JSON_INSTRUCTION.format(
                tool_schema_text=tool_schema_text)
            bridge_messages = [{"role": "system", "content": sys}] + llm_messages[1:]
            out = await providers.zai_bridge_chat(bridge_messages, tool_schema_text)

        if out.get("tool_calls"):
            calls = out["tool_calls"]
            # record assistant tool-call turn for the conversation
            calls_desc = json_dumps_compact(
                [{"tool": c["name"], "args": c["args"]} for c in calls])
            llm_messages.append({
                "role": "assistant", "content": f"[تنفيذ أدوات] {calls_desc}"
            })
            for call in calls:
                result = await _execute_tool(session, user, call["name"], call["args"])
                action = _tool_summary_for_actions(call["name"], result)
                if action:
                    actions.append(action)
                if emit is not None:
                    try:
                        await emit({"tool": call["name"]})
                    except Exception:  # never let streaming break the loop
                        pass
                llm_messages.append({
                    "role": "user",
                    "content": f"[نتيجة الأداة {call['name']}] "
                               f"{json_dumps_compact(result)[:1500]}",
                })
            continue

        content = out.get("content", "").strip()
        if content:
            return content
        return "حصل خلل بسيط، جرّب مرة ثانية لو سمحت."

    return "وصلت لحد الأدوات الأقصى لهذه الجلسة — جرّب تطلب خطوة خطوة."


def json_dumps_compact(obj) -> str:
    import json
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _history_query(user_id: int):
    from sqlalchemy import select
    return (select(AgentMessage).where(AgentMessage.user_id == user_id)
            .order_by(AgentMessage.created_at.desc()).limit(12))


# ---------------------------------------------------------------------------
# Deterministic local engine (offline fallback — always works)
CATEGORY_KEYWORDS = {
    "electricity": ["كهرباء", "كهربائية", "كهرب", "electricity", "power"],
    "water": ["ماء", "مياه", "water"],
    "internet": ["انترنت", "إنترنت", "نت", "internet", "wifi"],
    "mobile": ["شحن", "رصيد زين", "زين", "آسياسيل", "اسيا", "كورك", "mobile", "topup", "باقة"],
    "education": ["جامعة", "دراسة", "رسوم", "تعليم", "مدرسة", "education", "tuition"],
    "traffic": ["مرور", "مخالفة", "غرامة", "traffic", "fine"],
}
PAY_WORDS = ["ادفع", "دفع", "سدد", "سداد", "اقطع", "pay", "settle"]
PIN_RE = re.compile(r"(?:pin|بصورة|الرمز|رمز)?\s*[:=]?\s*(\d{4,6})\b", re.IGNORECASE)
CARD_RE = re.compile(r"\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b")
AMOUNT_RE = re.compile(r"(\d[\d\s.,]*)\s*(?:الف|ألف|الاف|آلاف|k|دينار|د\.ع|iqd)?", re.IGNORECASE)


def _parse_amount(text: str) -> int | None:
    m = re.search(r"(\d[\d\s.,]*)\s*(الف|ألف|الاف|آلاف|k)\b", text, re.IGNORECASE)
    if m:
        try:
            return int(float(m.group(1).replace(" ", "").replace(",", "")) * 1000)
        except ValueError:
            return None
    m = re.search(r"\b(\d{3,7})\b", text)
    if m:
        return int(m.group(1))
    return None


async def local_engine(session: AsyncSession, user: User,
                       message: str, actions: list[dict], emit=None) -> str:
    msg = message.strip()
    low = msg.lower()
    pending = _pending.get(user.id)

    async def _emit(tool: str) -> None:
        if emit is not None:
            try:
                await emit({"tool": tool})
            except Exception:
                pass

    # --- continue pending bill payment ------------------------------------
    if pending and pending.get("bill_id"):
        pin_match = PIN_RE.search(msg)
        if re.search(r"^(نعم|اي نعم|اكيد|أكيد|تم|يو|yes|y)\b", low):
            return (f"تمام! أكتب لي رمز الـ PIN حتى أنفّذ الدفع "
                    f"لفاتورة رقم {pending['bill_id']}.")
        if pin_match and re.fullmatch(r"\d{4,6}", msg.replace("pin", "").strip()):
            pin = pin_match.group(1)
        elif re.fullmatch(r"[\s]*\d{4,6}[\s]*", msg):
            pin = msg.strip()
        else:
            pin = None
        if pin:
            await _emit("pay_bill")
            result = await T.pay_bill(session, user, pending["bill_id"], pin)
            _pending.pop(user.id, None)
            if result.get("ok"):
                r = result["receipt"]
                actions.append({"tool": "pay_bill", "ok": True, "data": r})
                return (f"✅ تم الدفع بنجاح! فاتورة {r['title']} بمبلغ "
                        f"{r['amount']:,} د.ع.\nالرقم المرجعي: {r['reference']}\n"
                        f"رصيدك الآن: {r['balance_after']:,} د.ع")
            err = result.get("error")
            if err == "pin":
                return "رمز الـ PIN غلط — حاول مرة ثانية (تذكر: 4 إلى 6 أرقام)."
            if err == "insufficient":
                return (f"الرصيد ما يكفي — رصيدك {user.balance:,} د.ع "
                        f"والمبلغ {result.get('amount', 0):,} د.ع. شحن رصيدك أولًا.")
            if err == "already_paid":
                return "هذي الفاتورة مدفوعة أصلًا ✅"
            return "ما لقيت الفاتورة — تأكد من رقمها من قائمة الفواتير."

    if re.search(r"الغاء|إلغاء|cancel|stop|لا لا", low):
        _pending.pop(user.id, None)
        return "تم الإلغاء. أبرد أي شي ثاني؟"

    # --- greetings ---------------------------------------------------------
    if re.fullmatch(r"(سلام|هلو|هلا|مرحبا|مرحبين|hi|hello|hey)[\s!!.]*", low):
        return (f"هلا {user.first_name}! 👋 أنا أور، مساعدك بأور پاي.\n"
                f"رصيدك حاليًا {user.balance:,} د.ع.\n"
                "شنو تحب؟ أسرد فواتيرك، أدفعلك فاتورة، أو أحوّل مبلغ؟")

    # --- spending insight (must run BEFORE the balance check: «شكد صرفي…») --
    if re.search(r"شكد صرفي|شنو صرفي|شكد انفق|شكد صرفت|وين تروح فلوسي|فين تروح فلوسي|تروح فلوسي|spending|how much.*(spent|spend)", low):
        cat = next((c for c, words in CATEGORY_KEYWORDS.items()
                    if any(w in low for w in words)), None)
        if re.search(r"تحويل|حوال|transfer", low):
            cat = "transfer"
        await _emit("get_spending")
        spend = await T.get_spending(session, user)
        if cat:
            row = next((c for c in spend["categories"] if c["category"] == cat), None)
            if row is None:
                return (f"ما صرفت شي على {CATEGORY_AR.get(cat, cat)} هذا الشهر. "
                        "تريد تحددلها ميزانية؟")
            txt = (f"صرفك على {row['name_ar']} هذا الشهر: {row['spent']:,} د.ع")
            if "monthly_limit" in row:
                txt += f" من حد {row['monthly_limit']:,} د.ع ({row['pct']}%)"
                if row["status"] == "over":
                    txt += " 🚨 تجاوزت الحد — تحب ترفعه أو تكمل صرف؟"
                elif row["status"] == "near":
                    txt += " ⚠️ قربت توصل الحد."
            return txt + "."
        lines = [f"مجموع صرفك هذا الشهر: {spend['total_spent_this_month']:,} د.ع، توزّع كالتالي:"]
        for c in spend["categories"][:7]:
            if c["spent"] <= 0 and "monthly_limit" not in c:
                continue
            txt = f"• {c['name_ar']}: {c['spent']:,} د.ع"
            if "monthly_limit" in c:
                txt += f" (الحد {c['monthly_limit']:,})"
                if c["status"] == "over":
                    txt += " 🚨"
                elif c["status"] == "near":
                    txt += " ⚠️"
            lines.append(txt)
        return "\n".join(lines)

    # --- balance -----------------------------------------------------------
    if re.search(r"رصيد|balance|شكد عندي|شكد", low):
        await _emit("get_balance")
        return f"رصيدك الحالي: **{user.balance:,} د.ع** 💰"

    # --- bills -------------------------------------------------------------
    if re.search(r"فواتير|فاتورة|bills|bill", low) and not any(w in low for w in PAY_WORDS):
        await _emit("list_bills")
        unpaid = await T.list_bills(session, user, "unpaid")
        if unpaid["count"] == 0:
            return "ما عندك فواتير غير مدفوعة — عاش! 🎉"
        lines = [f"عندك {unpaid['count']} فواتير غير مدفوعة "
                 f"بمجموع {unpaid['unpaid_total']:,} د.ع:"]
        for b in unpaid["bills"]:
            flag = " ⚠️ متأخرة" if b["overdue"] else ""
            lines.append(f"• رقم {b['id']} — {b['biller']}: {b['amount']:,} د.ع{flag}")
        lines.append("اكتب: «ادفع رقم X وبعدها PIN» حتى أدفعلك.")
        return "\n".join(lines)

    # --- pay ---------------------------------------------------------------
    if any(w in low for w in PAY_WORDS):
        await _emit("list_bills")
        unpaid = await T.list_bills(session, user, "unpaid")
        if unpaid["count"] == 0:
            return "ما عندك فواتير غير مدفودة حاليًا 🎉"

        id_match = re.search(r"رقم\s*(\d+)|#(\d+)|id\s*(\d+)", low)
        bill_id = None
        if id_match:
            bill_id = int(id_match.group(1) or id_match.group(2) or id_match.group(3))
        else:
            for cat, words in CATEGORY_KEYWORDS.items():
                if any(w in low for w in words):
                    for b in unpaid["bills"]:
                        if b["category"] == cat:
                            bill_id = b["id"]
                            break
                    break
        if bill_id is None:
            return ("أي فاتورة أدفعلك؟ اكتب رقمها، مثلًا: «ادفع رقم 3».\n"
                    + "\n".join(f"• رقم {b['id']} — {b['biller']}: {b['amount']:,} د.ع"
                                for b in unpaid["bills"][:8]))

        pin_match = PIN_RE.search(low)
        if pin_match and not re.fullmatch(r"\d{4,6}", msg.strip() or "x"):
            pin = pin_match.group(1)
            await _emit("pay_bill")
            result = await T.pay_bill(session, user, bill_id, pin)
            if result.get("ok"):
                r = result["receipt"]
                actions.append({"tool": "pay_bill", "ok": True, "data": r})
                return (f"✅ تم الدفع! {r['title']} — {r['amount']:,} د.ع\n"
                        f"المرجع: {r['reference']}\nرصيدك: {r['balance_after']:,} د.ع")
            if result.get("error") == "pin":
                return "رمز الـ PIN غلط، جرب مرة ثانية."
            if result.get("error") == "insufficient":
                return f"الرصيد ما يكفي ({user.balance:,} د.ع)."
            return "صار خطأ بالدفع — تأكد من رقم الفاتورة."

        _pending[user.id] = {"bill_id": bill_id}
        target = next((b for b in unpaid["bills"] if b["id"] == bill_id), None)
        if target:
            return (f"فاتورة {target['biller']} بمبلغ {target['amount']:,} د.ع "
                    f"({target['period'] or 'بدون فترة'}).\n"
                    "أكتب «نعم» وبعدها سأطلب منك رمز الـ PIN لإتمام الدفع.")

    # --- top-up ------------------------------------------------------------
    if re.search(r"اشحن|عب[يّ]?|ايداع|إيداع|تعبئة|topup|top.?up|recharge", low):
        amount = _parse_amount(low)
        if amount and amount >= 1000:
            pin_match = PIN_RE.search(low)
            if pin_match:
                await _emit("topup_wallet")
                result = await T.topup_wallet(session, user, amount, pin_match.group(1))
                if result.get("ok"):
                    r = result["receipt"]
                    actions.append({"tool": "topup_wallet", "ok": True, "data": r})
                    return (f"✅ تمت التعبئة! أضفنا {amount:,} د.ع لمحفظتك.\n"
                            f"المرجع: {r['reference']}\nرصيدك الآن: {r['balance_after']:,} د.ع")
                if result.get("error") == "pin":
                    return "رمز الـ PIN غلط — جرب مرة ثانية."
                return "المبلغ لازم يكون بين 1,000 و 5,000,000 د.ع."
            return (f"حاضر أعبيك {amount:,} د.ع — أرسل لي رمز الـ PIN لإتمام التعبئة.")
        return ("أكتب المبلغ اللي تريد تعبيه، مثل: «اشحن رصيدي 50000» "
                "(بين 1,000 و 5,000,000 د.ع).")

    # --- transfer ----------------------------------------------------------
    if re.search(r"حو[لّ]?|تحويل|حوالة|transfer|send", low):
        card = CARD_RE.search(msg)
        amount = _parse_amount(low)
        if card and amount:
            pin_match = PIN_RE.search(low)
            if pin_match:
                await _emit("transfer_money")
                result = await T.transfer_money(session, user, card.group(1),
                                                amount, pin_match.group(1))
                if result.get("ok"):
                    r = result["receipt"]
                    actions.append({"tool": "transfer_money", "ok": True, "data": r})
                    return (f"✅ تم التحويل! {r['title']} — {r['amount']:,} د.ع\n"
                            f"المرجع: {r['reference']}\nرصيدك: {r['balance_after']:,} د.ع")
                if result.get("error") == "pin":
                    return "رمز الـ PIN غلط."
                if result.get("error") == "not_found":
                    return "ما لقيت مستلم بهذا الرقم — تأكد من 16 رقم البطاقة."
                return "ما أكمل التحويل — تأكد من المبلغ والرصيد."
            return (f"حاضر أحوّل {amount:,} د.ع إلى البطاقة …{card.group(1)[-4:]}. "
                    "أرسل لي رمز الـ PIN لإتمامها.")
        search = await T.search_users(session, user, re.sub(r"حو[لّ]?\s*لى?|إلى|to", "", msg).strip())
        if search["count"] > 0:
            lines = ["لقيت هؤلاء — لمن تحب التحويل؟"]
            for u in search["results"][:5]:
                lines.append(f"• {u['full_name']} ({u['city']}) — بطاقة …{u['card_number'][-4:]}")
            lines.append("اكتب: «حوّل 25000 على بطاقة XXXX»")
            return "\n".join(lines)
        return "أعطني اسم المستلم أو رقم بطاقته (16 رقم) والمبلغ، مثل: «حوّل 50000 على 4539123412341234»."

    # --- budgets -------------------------------------------------------------
    if re.search(r"ميزاني|بودج|budget|حد شهر|سقف", low):
        # list budgets
        if re.search(r"ميزانياتي|كل الميزانيات|اشلون ميزانياتي|my budgets|list budgets", low):
            rows = (await session.execute(
                select(Budget).where(Budget.user_id == user.id))).scalars().all()
            if not rows:
                return ("ما عندك ميزانيات معينة بعد 📊\n"
                        "مثال: «ميزانية الكهرباء 150 ألف» حتى أحدّدلك حد شهري.")
            lines = ["ميزانياتك الشهرية:"]
            for bd in rows:
                lines.append(f"• {CATEGORY_AR.get(bd.category, bd.category)}: "
                             f"{bd.monthly_limit:,} د.ع")
            return "\n".join(lines)

        cat = next((c for c, words in CATEGORY_KEYWORDS.items()
                    if any(w in low for w in words)), None)
        if re.search(r"تحويل|حوال|transfer", low):
            cat = "transfer"
        amount = _parse_amount(low)
        if cat and amount and amount >= 1000:
            await _emit("set_budget")
            result = await T.set_budget(session, user, cat, amount)
            if result.get("ok"):
                return (f"✅ {result['message']}")
            if result.get("error") == "bad_amount":
                return "الحد لازم يكون بين 1,000 و 20,000,000 د.ع (أو 0 للحذف)."
            return "التصنيف غير مدعوم — الميزانيات تشمل: كهرباء، ماء، إنترنت، اتصالات، تعليم، مرور، تحويلات."
        return ("حاضر أضبطلك ميزانية 📊 اكتب التصنيف والمبلغ، مثل:\n"
                "• «ميزانية الكهرباء 150 ألف»\n"
                "• «ميزانية تحويلات 500 ألف»\n"
                "أو «ميزانياتي» حتى تشوف القائمة الحالية.")

    # --- transactions ------------------------------------------------------
    if re.search(r"سجل|معاملات|حركات|آخر|transactions|history", low):
        await _emit("recent_transactions")
        txns = await T.recent_transactions(session, user, 5)
        lines = ["آخر 5 معاملات:"]
        for t in txns["transactions"]:
            arrow = "↗" if t["direction"] == "out" else "↙"
            lines.append(f"{arrow} {t['title']} — {t['amount']:,} د.ع ({t['created_at'][:10]})")
        return "\n".join(lines) if txns["count"] else "ما عندك معاملات بعد."

    # --- help / default ----------------------------------------------------
    return (
        "أنا أور، مساعد أور پاي الذكي 🤖 أقدر أساعدك بـ:\n"
        "• «شكد رصيدي» — استعلام الرصيد\n"
        "• «فواتيري» — عرض الفواتير غير المدفوعة\n"
        "• «ادفع رقم 3» — دفع فاتورة (بيطلب PIN)\n"
        "• «حوّل 25000 على 4539123412341234» — تحويل\n"
        "• «سجل معاملاتي» — آخر الحركات\n"
        "• «اشحن رصيدي 50000» — تعبئة المحفظة\n"
        "• «ميزانية الكهرباء 150 ألف» — حد صرف شهري\n"
        "• «شكد صرفي هذا الشهر؟» — تحليل الصرف\n"
        "شنو تحب نسوي؟"
    )
