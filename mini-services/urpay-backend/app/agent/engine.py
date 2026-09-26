"""Bill Pay Agent engine — agentic loop with tools + deterministic fallback."""
import logging
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..constants import BUDGETABLE_CATEGORIES, CATEGORY_AR
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
    "schedule_payment": "يجدول الدفع…",
    "list_scheduled": "يراجع جدولاتك…",
    "cancel_scheduled": "يلغي الجدولة…",
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
11. الدفع المجدول: المستخدم ممكن يطلب جدولة دفعة مستقبلية («جدّل دفع فاتورة الكهرباء أول الشهر الجاي»، «حوّل 100 الف لأمي كل شهر») — استخدم schedule_payment (يتطلب PIN مرة واحدة لتخويل الجدولة؛ التنفيذ بعدين تلقائي بدون PIN). «جدولاتي» تعرض القائمة (list_scheduled)، و«ألغِ جدولة رقم X» تلغيها (cancel_scheduled). مرر `when` بنفس صياغة المستخدم — النظام يفهم العربية («غدًا»، «بعد يومين»، «أول الشهر الجاي») والتواريخ ISO. إذا لم يذكر PIN اطلبه أولًا.
12. البحث عن مستلم والتحويل: أداة search_users مطابقة ذكية — مرر ما قاله المستخدم حرفيًا (اسم جزئي، بدون الاسم الأوسط، بخطأ إملائي، بالإنجليزية، أو مع المدينة مثل «زينب من النجف»)؛ النظام يتجاهل «ال» التعريف والأخطاء الإملائية ويرتّب النتائج بنسبة تطابق (score). ما تحتاج الاسم الكامل أبدًا — أي معلومة معقولة عن الشخص كافية. إذا كانت النتيجة الأولى واضحة (نتيجة وحيدة، أو حقل note يقول إنها المقصودة، أو نسبتها 95%+ والباقي أقل بفارق ملموس): اعتبرها المقصودة مباشرة — عرّفها للمستخدم بالاسم الكامل والمحافظة وآخر 4 أرقام بطاقتها واطلب PIN. عند طلب PIN للتحويل اذكر المبلغ والمستلم بالضبط في ردّك (مثال: «أرسل PIN لتحويل 15,000 د.ع إلى زينب مرتضى الموسوي»). عند التنفيذ استخدم المبلغ المذكور في طلب المستخدم الأصلي حرفيًا — لا تخترع أو تغيّر المبلغ أبدًا، ونفّذ transfer_money ببطاقتها (card_number) من نتيجة البحث نفسها. فقط إذا كانت النتائج متقاربة فعلًا (نسب متقاربة وبلا note): اعرض أفضل 2-3 واطلب التحديد قبل التحويل.

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
        "description": ("Smart recipient search: pass whatever the user said about "
                        "the person — partial name, first+family without the middle "
                        "name, a nickname, a misspelling, an English transliteration "
                        "('zainab mousawi'), or name + city ('زينب من النجف'). "
                        "Matching ignores the definite article ال, middle names and "
                        "typos; results are ranked by similarity score with city "
                        "and full card numbers. Use the returned card_number "
                        "directly in transfer_money."),
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
        "description": ("Set (or remove) a monthly spending limit for a category. "
                        "Categories: " + ", ".join(BUDGETABLE_CATEGORIES) +
                        ". Arabic names: " +
                        ", ".join(f"{CATEGORY_AR.get(c, c)}={c}" for c in BUDGETABLE_CATEGORIES) +
                        ". A limit of 0 removes the budget. No PIN required (not a money movement). "
                        "Also returns month-to-date spend for the category."),
        "parameters": {"type": "object", "required": ["category", "monthly_limit"], "properties": {
            "category": {"type": "string", "enum": list(BUDGETABLE_CATEGORIES)},
            "monthly_limit": {"type": "integer", "minimum": 0}}}}},
    {"type": "function", "function": {
        "name": "get_spending",
        "description": "Get the user's month-to-date spending breakdown by category, with monthly budget limits and status (ok / near 80%+ / over). Use it when the user asks how much they spent (e.g. 'شكد صرفي على الكهرباء هذا الشهر') or where their money goes.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "schedule_payment",
        "description": "Schedule a future/recurring payment (a PIN-authorized mandate executed automatically at its time — no PIN needed later). kind='bill' for a biller (target = biller code like 'MOE-BGD-R') or kind='transfer' for a user card (target = 16-digit card). `when` accepts Arabic phrases (غدًا، بعد يومين، أول الشهر الجاي، كل شهر) or ISO dates (2026-10-01). If the user did not provide their PIN, ask for it first.",
        "parameters": {"type": "object", "required": ["kind", "target", "amount", "when", "pin"], "properties": {
            "kind": {"type": "string", "enum": ["bill", "transfer"]},
            "target": {"type": "string"},
            "amount": {"type": "integer"},
            "when": {"type": "string"},
            "pin": {"type": "string"},
            "frequency": {"type": "string", "enum": ["once", "monthly"]}}}}},
    {"type": "function", "function": {
        "name": "list_scheduled",
        "description": "List the user's pending scheduled payments (upcoming bills/transfers mandates) with ids, amounts and next run times.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "cancel_scheduled",
        "description": "Cancel a pending scheduled payment by its id (from list_scheduled). No PIN needed.",
        "parameters": {"type": "object", "required": ["scheduled_id"], "properties": {
            "scheduled_id": {"type": "integer"}}}}},
    {"type": "function", "function": {
        "name": "list_goals",
        "description": "List the user's savings goals (أهداف التوفير) with ids, names, targets, saved amounts and progress percentages.",
        "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {
        "name": "create_goal",
        "description": "Create a new savings goal (هدف توفير). The user sets a target amount and saves towards it over time. No PIN required (no money moves at creation). Use it when the user says e.g. 'سوّي لي هدف حج بمليون' or 'ابدأ هدف توفير للسيارة'.",
        "parameters": {"type": "object", "required": ["name", "target_amount"], "properties": {
            "name": {"type": "string"},
            "target_amount": {"type": "integer", "minimum": 10000}}}}},
    {"type": "function", "function": {
        "name": "deposit_goal",
        "description": "Move IQD from the wallet balance into a savings goal (توفير مبلغ لهدف). Requires the goal id (from list_goals) and the user's PIN. If the PIN was not provided, ask the user for it first.",
        "parameters": {"type": "object", "required": ["goal_id", "amount", "pin"], "properties": {
            "goal_id": {"type": "integer"},
            "amount": {"type": "integer", "minimum": 1000},
            "pin": {"type": "string"}}}}},
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
    if name == "schedule_payment":
        return await T.schedule_payment(
            session, user, str(args.get("kind", "")), str(args.get("target", "")),
            args.get("amount", 0), str(args.get("when", "")),
            str(args.get("pin", "")), str(args.get("frequency", "")))
    if name == "list_scheduled":
        return await T.list_scheduled(session, user)
    if name == "cancel_scheduled":
        return await T.cancel_scheduled(session, user, int(args.get("scheduled_id", 0)))
    if name == "list_goals":
        return await T.list_goals(session, user)
    if name == "create_goal":
        return await T.create_goal(session, user, str(args.get("name", "")),
                                   int(args.get("target_amount", 0)))
    if name == "deposit_goal":
        return await T.deposit_goal(session, user, int(args.get("goal_id", 0)),
                                    int(args.get("amount", 0)), str(args.get("pin", "")))
    return {"error": f"unknown tool {name}"}


def _tool_summary_for_actions(name: str, result: dict) -> dict | None:
    """Extract a UI-friendly action record when a tool produced a receipt."""
    if name == "pay_bill" and result.get("ok"):
        return {"tool": "pay_bill", "ok": True, "data": result["receipt"]}
    if name == "transfer_money" and result.get("ok"):
        return {"tool": "transfer_money", "ok": True, "data": result["receipt"]}
    if name == "topup_wallet" and result.get("ok"):
        return {"tool": "topup_wallet", "ok": True, "data": result["receipt"]}
    if name == "deposit_goal" and result.get("ok"):
        return {"tool": "deposit_goal", "ok": True, "data": result["receipt"]}
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

    # savings goals context so the agent can encourage/make deposits
    goals_txt = ""
    try:
        goals = await T.list_goals(session, user)
        if goals["count"]:
            lines = []
            for g in goals["items"][:4]:
                flag = " (اكتمل 🎉)" if g["status"] == "completed" else ""
                lines.append(f"\n- هدف رقم {g['id']} {g['emoji']} «{g['name']}»: "
                             f"وفّر {g['saved']:,} من {g['target']:,} د.ع "
                             f"({g['pct']}%){flag}")
            goals_txt = "\nأهداف التوفير:" + "".join(lines)
        else:
            goals_txt = "\nما عنده أهداف توفير بعد (تقدر تسويها بأداة create_goal)."
    except Exception as e:
        log.warning("goals context failed: %s", e)

    return (
        f"بيانات المستخدم الحالي: الاسم {user.full_name}، المحافظة {user.city}، "
        f"بطاقة ••••{user.card_number[-4:]}، الرصيد الحالي {user.balance:,} د.ع."
        f"\nفواتيره غير المدفوعة حاليًا:{bills_txt or ' (لا توجد)'}"
        f"{budget_txt}"
        f"{goals_txt}"
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

    # anti-hallucination guard: surface the latest explicitly requested
    # transfer amount from the recent conversation, so the model never has
    # to "remember" it from memory on the PIN turn (e.g. «حوّل 15000 …» then
    # «PIN 123456» two turns later)
    amt_hint = ""
    user_msgs = [x for x in llm_messages if x["role"] == "user"]
    for m in reversed(user_msgs[-6:]):
        low = m["content"].lower()
        if re.search(r"حو[لّ]?|تحويل|حوالة|transfer|send", low):
            amt = _parse_amount(low)
            if amt and amt >= 1000:
                amt_hint = (f"\nتنبيه المبلغ: آخر مبلغ تحويل طلبه المستخدم هو "
                            f"{amt:,} د.ع — إذا نفّذت transfer_money الآن "
                            "فاستخدم هذا المبلغ بالضبط، ولا تخترع أو تغيّره، "
                            "ما لم يحدد المستخدم مبلغًا آخر صراحة في رسالته الأخيرة.")
                break
    if amt_hint:
        llm_messages[0]["content"] += amt_hint

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
PIN_RE = re.compile(r"(?:pin|بصورة|الرمز|رمز)?\s*[:=]?\s*(\d{6})\b", re.IGNORECASE)
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
        if pin_match and re.fullmatch(r"\d{6}", msg.replace("pin", "").strip()):
            pin = pin_match.group(1)
        elif re.fullmatch(r"[\s]*\d{6}[\s]*", msg):
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
                return "رمز الـ PIN غلط — حاول مرة ثانية (تذكر: الرمز 6 أرقام)."
            if err == "insufficient":
                return (f"الرصيد ما يكفي — رصيدك {user.balance:,} د.ع "
                        f"والمبلغ {result.get('amount', 0):,} د.ع. شحن رصيدك أولًا.")
            if err == "already_paid":
                return "هذي الفاتورة مدفوعة أصلًا ✅"
            return "ما لقيت الفاتورة — تأكد من رقمها من قائمة الفواتير."

    # --- continue pending transfer (recipient resolved, awaiting PIN) -----
    if pending and pending.get("transfer"):
        tr = pending["transfer"]
        if re.search(r"الغاء|إلغاء|cancel|stop|لا لا|ما اريد|لا اريد|خلاص", low):
            _pending.pop(user.id, None)
            return "تم إلغاء الحوالة. أبرد أي شي ثاني؟"
        pin = None
        if re.fullmatch(r"\s*\d{6}\s*", msg):
            pin = msg.strip()
        else:
            pm = PIN_RE.search(low)
            if pm and re.search(r"pin|بصورة|رمز", low):
                pin = pm.group(1)
        if pin:
            await _emit("transfer_money")
            result = await T.transfer_money(session, user, tr["card"],
                                            tr["amount"], pin)
            if result.get("ok"):
                _pending.pop(user.id, None)
                r = result["receipt"]
                actions.append({"tool": "transfer_money", "ok": True, "data": r})
                return (f"✅ تم التحويل! {r['title']} — {r['amount']:,} د.ع\n"
                        f"المرجع: {r['reference']}\nرصيدك: {r['balance_after']:,} د.ع")
            if result.get("error") == "pin":
                return "رمز الـ PIN غلط — حاول مرة ثانية (6 أرقام)."
            if result.get("error") == "insufficient":
                _pending.pop(user.id, None)
                return (f"الرصيد ما يكفي — رصيدك {user.balance:,} د.ع "
                        f"والمبلغ {tr['amount']:,} د.ع. عبّي المحفظة أولًا.")
            return "ما أكمل التحويل — جرب مرة ثانية."
        # message looks like a brand-new request → drop pending & re-run
        if not re.search(r"رصيد|فواتير|فاتورة|ادفع|دفع|اشحن|تعب[يّ]|ميزاني|جدول|سجل|"
                         r"اهداف|هدف|توفير|صرفي|معاملات|تحويل|حوالة|حو", low):
            return (f"الحوالة جاهزة: {tr['amount']:,} د.ع إلى {tr['name']} "
                    f"(بطاقة …{tr['card'][-4:]}).\n"
                    "أرسل رمز الـ PIN (6 أرقام) لإتمامها، أو اكتب «إلغاء».")
        _pending.pop(user.id, None)
        pending = None

    # --- pending amount answer (single recipient found, awaiting amount) --
    if pending and pending.get("asked_amount"):
        amt = _parse_amount(low)
        if amt and len(msg.split()) <= 3:
            memo = pending.pop("asked_amount")
            _pending[user.id] = {"transfer": {"card": memo["card"],
                                              "name": memo["name"],
                                              "amount": amt}}
            return (f"تمام — ححوّل {amt:,} د.ع إلى {memo['name']} "
                    f"(بطاقة …{memo['card'][-4:]}).\n"
                    "أرسل رمز الـ PIN (6 أرقام) لإتمامها، أو اكتب «إلغاء».")
        _pending.pop(user.id, None)
        pending = None

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

    # --- savings goals (أهداف التوفير) --------------------------------------
    if re.search(r"اهداف|أهداف|هدف|توفير|goals?|savings", low):
        goals = await T.list_goals(session, user)

        # create: «سوّي لي هدف حج بمليون» / «ابدأ هدف سيارة ب 3 مليون»
        if re.search(r"سوي|سوّي|انشئ|أنشئ|ابدأ|ابدا|اضف|أضف|افتح|create|new", low):
            amt = _parse_amount(msg)
            if not amt:
                return "جميل! شنو الهدف وبكم؟ مثال: «سوّي لي هدف حج بمليون ونص»."
            name = re.sub(r"\d|سوي|سوّي|انشئ|أنشئ|ابدأ|ابدا|اضف|أضف|افتح|هدف|بمبلغ|بم|create|new|لي", " ", msg)
            name = re.sub(r"[\s]+", " ", name).replace("ل", "", 1).strip(" ،,") or "هدفي"
            await _emit("create_goal")
            result = await T.create_goal(session, user, name[:48], amt)
            if result.get("ok"):
                return (f"✅ {result['message']}\n"
                        "تقدر توفّر له من المحفظة: «وفّر 50 الف لهدفي وبعدها PIN».")
            return f"ما صار إنشاء الهدف — {result.get('error', 'جرّب مرة ثانية')}"

        # deposit: «وفّر 50 الف لهدف الحج وبعدها PIN 123456»
        if re.search(r"وفر|وفّر|خلي|اضف|أضف|deposit|save", low):
            pin_m = PIN_RE.search(msg)
            if not pin_m:
                return "التوفير يحتاج رمز الـ PIN — أكتب: «وفّر 50 الف لهدف الحج وبعدها PIN 123456»."
            if goals["count"] == 0:
                return "ما عندك أهداف بعد — سوّي واحد أولًا: «سوّي لي هدف حج بمليون»."
            amt = _parse_amount(msg) or 0
            goal = None
            for g in goals["items"]:
                if g["name"] in msg or any(w in msg for w in g["name"].split()):
                    goal = g
                    break
            if goal is None:
                goal = max(goals["items"], key=lambda g: g["saved"])
            await _emit("deposit_goal")
            result = await T.deposit_goal(session, user, goal["id"], amt, pin_m.group(1))
            if result.get("ok"):
                actions.append({"tool": "deposit_goal", "ok": True,
                                "data": result["receipt"]})
                return f"✅ {result['message']}"
            err = result.get("error")
            if err == "pin_invalid":
                return "رمز الـ PIN غلط — حاول مرة ثانية."
            return f"ما تم التوفير — {err}"

        # list (default)
        await _emit("list_goals")
        if goals["count"] == 0:
            return ("ما عندك أهداف توفير بعد 🎯 — سوّي واحد: "
                    "«سوّي لي هدف حج بمليون» أو «هدف سيارة ب 5 مليون».")
        lines = [f"عندك {goals['count']} أهداف — وفّرت لها مجموع "
                 f"{goals['total_saved']:,} د.ع:"]
        for g in goals["items"]:
            flag = " 🎉 اكتمل!" if g["status"] == "completed" else ""
            lines.append(f"• {g['emoji']} «{g['name']}»: {g['saved']:,} من "
                         f"{g['target']:,} د.ع ({g['pct']}%){flag}")
        return "\n".join(lines)


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
        if pin_match and not re.fullmatch(r"\d{6}", msg.strip() or "x"):
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
    if re.search(r"اشحن|\bعب[يّ]?ي\b|\bعب[يّ]?يها\b|\bعب[يّ]?يه\b|ايداع|إيداع|تعبئة|املا|املأ|topup|top.?up|recharge", low):
        amount = _parse_amount(low)
        if amount and amount >= 1000:
            pin_match = PIN_RE.search(low)
            # guard: a bare digit run equal to the amount is NOT a PIN
            pin = (pin_match.group(1)
                   if pin_match and pin_match.group(1) != str(amount) else None)
            if pin:
                await _emit("topup_wallet")
                result = await T.topup_wallet(session, user, amount, pin)
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
            # guard: never treat the amount itself as the PIN
            pin = (pin_match.group(1)
                   if pin_match and pin_match.group(1) != str(amount) else None)
            if pin:
                await _emit("transfer_money")
                result = await T.transfer_money(session, user, card.group(1),
                                                amount, pin)
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
        # smart recipient resolution — the matcher ignores amounts/filler
        # and scores name + city tokens (partial names, typos, English…)
        await _emit("search_users")
        search = await T.search_users(session, user, msg)
        if search["count"] == 0:
            return ("أعطني اسم المستلم أو رقم بطاقته (16 رقم) والمبلغ، مثل:\n"
                    "• «حوّل 50000 لزينب الموسوي»\n"
                    "• «حوّل 50000 على 4539555544441236»")
        best = search["results"][0]
        runner_up = (search["results"][1].get("score", 0.0)
                     if search["count"] > 1 else 0.0)
        clear = search["count"] == 1 or best.get("score", 0) - runner_up >= 0.12
        if clear:
            if not amount:
                _pending[user.id] = {"asked_amount": {
                    "card": best["card_number"], "name": best["full_name"],
                    "city": best["city"], "card_masked": best["card_masked"]}}
                return (f"لقيت {best['full_name']} ({best['city']}) — بطاقة "
                        f"{best['card_masked']}.\n"
                        "كم المبلغ اللي تحب تحوّله؟ (مثال: 25000)")
            pin_m = PIN_RE.search(low)
            inline_pin = (pin_m.group(1)
                          if pin_m and pin_m.group(1) != str(amount) else None)
            if inline_pin:
                await _emit("transfer_money")
                result = await T.transfer_money(session, user,
                                                best["card_number"], amount,
                                                inline_pin)
                if result.get("ok"):
                    r = result["receipt"]
                    actions.append({"tool": "transfer_money", "ok": True,
                                    "data": r})
                    return (f"✅ تم التحويل! {r['title']} — {r['amount']:,} د.ع\n"
                            f"المرجع: {r['reference']}\n"
                            f"رصيدك: {r['balance_after']:,} د.ع")
                if result.get("error") == "pin":
                    return "رمز الـ PIN غلط — حاول مرة ثانية."
                if result.get("error") == "insufficient":
                    return f"الرصيد ما يكفي ({user.balance:,} د.ع)."
                return "ما أكمل التحويل — تأكد من المبلغ والرصيد."
            _pending[user.id] = {"transfer": {
                "card": best["card_number"], "name": best["full_name"],
                "amount": amount}}
            return (f"لقيت المستلم ✅ {best['full_name']} ({best['city']}) — "
                    f"بطاقة {best['card_masked']}.\n"
                    f"ححوّل {amount:,} د.ع — أرسل رمز الـ PIN (6 أرقام) "
                    "لإتمام الحوالة، أو اكتب «إلغاء».")
        # several close candidates — let the user pick
        lines = ["لقيت أكثر من مستخدم بهالمعلومات — لمن تقصد؟"]
        for u in search["results"][:5]:
            sc = (f" · تطابق {int(round(u.get('score', 0) * 100))}%"
                  if u.get("score") else "")
            lines.append(f"• {u['full_name']} ({u['city']}) — بطاقة "
                         f"{u['card_masked']}{sc}")
        lines.append("حدّد وحدة بالمدينة أو الاسم الكامل، أو أرسل رقم بطاقة كامل (16 رقم).")
        return "\n".join(lines)

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

    # --- scheduled payments -------------------------------------------------
    if re.search(r"جدول|جدّل|جدول|schedule|recurring|autopay", low):
        # list
        if re.search(r"جدولاتي|جدولي|جدولات |my schedule|list scheduled", low):
            await _emit("list_scheduled")
            rows = await T.list_scheduled(session, user)
            if rows["count"] == 0:
                return ("ما عندك جدولات بعد ⏰\n"
                        "مثال: «جدّل دفع فاتورة الكهرباء أول الشهر الجاي»")
            lines = [f"عندك {rows['count']} جدولة قيد الانتظار:"]
            for it in rows["items"]:
                freq = " · شهريًا" if it["frequency"] == "monthly" else ""
                lines.append(f"• رقم {it['id']} — {it['label']}: "
                             f"{it['amount']:,} د.ع · "
                             f"{it['next_run_at'][:16].replace('T', ' ')}{freq}")
            lines.append("«الغ جدولة رقم X» للإلغاء.")
            return "\n".join(lines).replace(",", "،")

        # cancel
        m = re.search(r"(?:الغ|إلغاء|احذف|امسح)\s*(?:جدولة)?\s*(?:رقم)?\s*(\d+)", low)
        if m and re.search(r"الغ|إلغاء|احذف|امسح|cancel", low):
            await _emit("cancel_scheduled")
            res = await T.cancel_scheduled(session, user, int(m.group(1)))
            return "✅ " + res["message"] if res.get("ok") else "ما لقيت الجدولة — تأكد من رقمها."

        # create: needs kind + amount + when (+PIN)
        amount = _parse_amount(low)
        when_txt = msg  # pass the raw text — the parser understands Arabic
        pin_match = PIN_RE.search(low)
        card = CARD_RE.search(msg)

        # detect kind: transfer if a card or «حوالة/حوّل» present, else bill
        is_transfer = bool(card) or re.search(r"حوالة|حوّل|حو ل", low)
        # find the biller by category keyword
        cat = next((c for c, words in CATEGORY_KEYWORDS.items()
                    if any(w in low for w in words)), None)

        if not amount or amount < 1000:
            return ("حاضر أجدوللك ⏰ اكتب المبلغ، مثال:\n"
                    "• «جدّل دفع فاتورة الكهرباء 45 الف أول الشهر الجاي»\n"
                    "• «جدّل حوالة 100 الف على بطاقة ... بعد يومين»")
        if not is_transfer and cat is None:
            return ("أي فاتورة أجدوللك؟ حدد النوع، مثال:\n"
                    "• «جدّل فاتورة الكهرباء 45 الف أول الشهر»\n"
                    "• «جدّل فاتورة الماء 20 الف كل شهر»")

        target = card.group(1) if is_transfer and card else (cat or "")
        kind = "transfer" if is_transfer else "bill"
        if is_transfer and not card:
            return "أعطني رقم بطاقة المستلم (16 رقم) ضمن الرسالة، مثل: «جدّل حوالة 100 الف على 4539555544441234 بعد يومين»."

        if pin_match and pin_match.group(1) != str(amount):
            await _emit("schedule_payment")
            # resolve the biller from the raw message (city-aware)
            if kind == "bill":
                resolved = T.resolve_biller(msg, user.city)
                if resolved is None:
                    return ("ما لقيت الجهة — اذكر نوع الفاتورة، مثل: "
                            "«جدّل فاتورة الكهرباء 45 الف أول الشهر»")
                target = resolved[0]["code"]
            res = await T.schedule_payment(session, user, kind, target,
                                           amount, when_txt, pin_match.group(1))
            if res.get("ok"):
                return "✅ " + res["message"]
            if res.get("error") == "pin":
                return "رمز الـ PIN غلط — جرب مرة ثانية."
            if res.get("error") == "bad_when":
                return res.get("detail", "ما فهمت التوقيت — جرب «غدًا» أو «أول الشهر الجاي».")
            return res.get("detail", "ما أكملت الجدولة — تأكد من البيانات.")
        return ("تمام — أرسل لي رمز الـ PIN مرة واحدة لتخويل الجدولة "
                "(التنفيذ بعدين تلقائي).")

    # --- who-is / person lookup --------------------------------------------
    if (re.search(r"منو|من هو|من هي|مين|ابحث|دور على|شسمه|شسمها|بطاقتها|بطاقته|رقم بطاقة|\bwho\b|\bfind\b|\bsearch\b", low)
            and not any(w in low for w in PAY_WORDS)):
        await _emit("search_users")
        search = await T.search_users(session, user, msg)
        if search["count"] == 0:
            return ("ما لقيت أحد بهالمعلومات بين مستخدمي أور پاي.\n"
                    "أعطني اسم أو معلومة أوضح (مثال: «زينب من النجف»).")
        lines = [f"لقيت {search['count']} " +
                 ("مستخدمين بهالمعلومات:" if search["count"] > 1
                  else "مستخدم بهالمعلومات:")]
        for u in search["results"][:5]:
            sc = (f" · تطابق {int(round(u.get('score', 0) * 100))}%"
                  if u.get("score") else "")
            lines.append(f"• {u['full_name']} ({u['city']}) — بطاقة "
                         f"{u['card_masked']}{sc}")
        if search["count"] == 1:
            u = search["results"][0]
            lines.append(f"تحب تحوّل لها مبلغ؟ اكتب: «حوّل 25000 ل{u['full_name']}».")
        else:
            lines.append("حدّد وحدة منهم بالمدينة أو بالاسم الكامل.")
        return "\n".join(lines)

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
        "• «جدّل فاتورة الكهرباء أول الشهر الجاي» — دفع مجدول\n"
        "شنو تحب نسوي؟"
    )
