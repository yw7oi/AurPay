/* Bill Pay Agent engine — agentic LLM loop with tools + deterministic local
 * fallback. 1:1 port of mini-services/urpay-backend/app/agent/engine.py.
 *
 * Provider chain: Groq (function calling) → z-ai bridge (JSON tool-or-reply)
 * → local deterministic Arabic intent engine (offline, always available). */

import type { AgentMessageRow, Db, UserRow } from "../types";
import { BUDGETABLE_CATEGORIES, CATEGORY_AR } from "../constants";
import * as T from "./tools";
import { pyRound, type ListBillsResult, type ListGoalsResult } from "./tools";
import {
  bridgeAvailable,
  groqAvailable,
  groqChat,
  zaiBridgeChat,
  type ChatMessage,
} from "./providers";

/* multi-turn pending actions for the deterministic engine — on globalThis
 * so dev HMR reloads never wipe an in-flight confirmation flow */
type Pending = {
  bill_id?: number;
  transfer?: { card: string; name: string; amount: number };
  asked_amount?: {
    card: string;
    name: string;
    city: string;
    card_masked: string;
  };
};

const globalEngine = globalThis as unknown as {
  __urpayAgentPending?: Map<number, Pending>;
};

function pendingMap(): Map<number, Pending> {
  if (!globalEngine.__urpayAgentPending) {
    globalEngine.__urpayAgentPending = new Map();
  }
  return globalEngine.__urpayAgentPending;
}

export type AgentActionOut = {
  tool: string;
  ok: boolean;
  data: unknown;
  error: string | null;
};

export type EmitFn = (ev: { tool: string }) => void | Promise<void>;

export type AgentResult = {
  reply: string;
  actions: AgentActionOut[];
  provider: string;
};

/* UI labels for live agent tool steps (streamed to the client) */
export const TOOL_STEP_LABELS: Record<string, string> = {
  get_balance: "يفحص رصيدك…",
  list_bills: "يراجع فواتيرك…",
  pay_bill: "ينفّذ الدفع…",
  search_users: "يدوّر على المستلم…",
  transfer_money: "ينفّذ الحوالة…",
  recent_transactions: "يراجع معاملاتك…",
  topup_wallet: "يعبّي المحفظة…",
  get_profile: "يجيب بياناتك…",
  set_budget: "يضبط ميزانيتك…",
  get_spending: "يحلل صرفك…",
  schedule_payment: "يجدول الدفع…",
  list_scheduled: "يراجع جدولاتك…",
  cancel_scheduled: "يلغي الجدولة…",
};

export const SYSTEM_PROMPT = `أنت "أور" — المساعد الذكي (AI Agent) داخل محفظة أور پاي (AurPay)، منصة الدفع العراقية.
دورك: مساعدة المستخدم على استعلام رصيده، عرض فواتيره، دفع الفواتير، التحويل بين المستخدمين، ومراجعة معاملاته — كل ذلك من خلال المحادثة.

قواعد صارمة:
1. ردّ دائمًا بلغة المستخدم (العربية العراقية الفصيحة المبسطة افتراضيًا، والإنجليزية إن كتب بالإنجليزية).
2. أي عملية دفع أو تحويل تتطلب رمز PIN — اطلبه من المستخدم إذا لم يذكره. لا تخترع PIN أبدًا.
3. قبل تنفيذ الدفع أكّد للمستخدم الفاتورة والمبلغ، وبعد التنفيذ اذكر الرقم المرجعي (reference) والرصيد الجديد.
4. المبالغ بالدينار العراقي (د.ع). استخدم تنسيق أرقام واضحًا.
5. لا تخترع بيانات — استخدم نتائج الأدوات فقط. إن لم تجد شيئًا قل ذلك بصراحة.
6. كن ودودًا ومختصرًا (٢-٥ جمل غالبًا). يمكنك اقتراح خطوة تالية مفيدة.
7. لا تكشف رقم البطاقة كاملًا أو الـ PIN لأي أحد، ويمكنك إظهار آخر 4 أرقام فقط.
8. عند الدفع: تحقق أن رقم الفاتورة (bill_id) يطابق بالضبط الفاتورة التي طلبها المستخدم (الصنف والجهة). مرر دائمًا \`hint\` بكلمات المستخدم إلى pay_bill — النظام يرفض الدفع إذا لم تتطابق. إذا رفض النظام العملية (wrong_bill) فأعد فحص list_bills واختر الرقم الصحيح.
9. الميزانيات: المستخدم ممكن يطلب تحديد حد شهري لتصنيف (مثال: «ميزانية الكهرباء 150 ألف») — استخدم set_budget. إذًا صرفَه تجاوز الحد، أبلغه بذلك ولطفًا اقترح رفعه أو تقليص الصرف. لا تحتاج PIN لتعيين ميزانية (ما هي عملية مالية مباشرة).
10. صرف المستخدم: عندما يسأل عن صرفه («شكد صرفي على الكهرباء؟» / «فين تروح فلوسي؟») استخدم get_spending وأجبه بالأرقام. إذا كان صرفه قريب من حد الميزانية (80%+) أو تجاوزها، نبّهه بلطف واستخدم نفس بيانات الصرف المعطاة في السياق أعلاه دون أدوات إضافية إن كانت كافية.
11. الدفع المجدول: المستخدم ممكن يطلب جدولة دفعة مستقبلية («جدّل دفع فاتورة الكهرباء أول الشهر الجاي»، «حوّل 100 الف لأمي كل شهر») — استخدم schedule_payment (يتطلب PIN مرة واحدة لتخويل الجدولة؛ التنفيذ بعدين تلقائي بدون PIN). «جدولاتي» تعرض القائمة (list_scheduled)، و«ألغِ جدولة رقم X» تلغيها (cancel_scheduled). مرر \`when\` بنفس صياغة المستخدم — النظام يفهم العربية («غدًا»، «بعد يومين»، «أول الشهر الجاي») والتواريخ ISO. إذا لم يذكر PIN اطلبه أولًا.
12. البحث عن مستلم والتحويل: أداة search_users مطابقة ذكية — مرر ما قاله المستخدم حرفيًا (اسم جزئي، بدون الاسم الأوسط، بخطأ إملائي، بالإنجليزية، أو مع المدينة مثل «زينب من النجف»)؛ النظام يتجاهل «ال» التعريف والأخطاء الإملائية ويرتّب النتائج بنسبة تطابق (score). ما تحتاج الاسم الكامل أبدًا — أي معلومة معقولة عن الشخص كافية. إذا كانت النتيجة الأولى واضحة (نتيجة وحيدة، أو حقل note يقول إنها المقصودة، أو نسبتها 95%+ والباقي أقل بفارق ملموس): اعتبرها المقصودة مباشرة — عرّفها للمستخدم بالاسم الكامل والمحافظة وآخر 4 أرقام بطاقتها واطلب PIN. عند طلب PIN للتحويل اذكر المبلغ والمستلم بالضبط في ردّك (مثال: «أرسل PIN لتحويل 15,000 د.ع إلى زينب مرتضى الموسوي»). عند التنفيذ استخدم المبلغ المذكور في طلب المستخدم الأصلي حرفيًا — لا تخترع أو تغيّر المبلغ أبدًا، ونفّذ transfer_money ببطاقتها (card_number) من نتيجة البحث نفسها. فقط إذا كانت النتائج متقاربة فعلًا (نسب متقاربة وبلا note): اعرض أفضل 2-3 واطلب التحديد قبل التحويل.

13. الذاكرة: تحتوي رسائل المحادثة على «ذاكرة طويلة المدى» (خلاصة مضغوطة لأقدم الرسائل) قبل آخر الرسائل الكاملة. استعن بها عند متابعة طلبات قديمة أو عندما يسأل المستخدم «وين كنا؟» أو يشير لمعلومة ذكرها سابقًا (اسم، مبلغ، رقم فاتورة). المبالغ والبيانات الحالية خذها دائمًا من الأدوات، والمبلغ المعتمد للتحويل من رسالة المستخدم الصريحة.

 persona: اسمك "أور" — مستوحى من مدينة أور السومرية حيث سُجّلت أولى عمليات التبادل في التاريخ.
`;

const BRIDGE_JSON_INSTRUCTION = (toolSchemaText: string) => `
أنت تملك أدوات (tools) يمكنك استدعاؤها. مخطط الأدوات:
${toolSchemaText}

متى تريد تنفيذ أداة، ردّ بـ JSON صرف فقط بدون أي نص آخر بالشكل:
{"tool": "اسم_الأداة", "args": {...}}
وإذا أردت الردّ النهائي على المستخدم ردّ بـ JSON صرف:
{"reply": "نص الرد"}
لا تكتب أي شيء خارج JSON. لا تستخدم markdown.
`;

/** Rough script detection: Arabic vs Latin (default Arabic). */
function detectLang(text: string): "en" | "ar" {
  const arabic = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (arabic === 0 && latin >= 3) return "en";
  return "ar";
}

const LANG_DIRECTIVE: Record<"en" | "ar", string> = {
  en: "\n\nتوجيه لغة: المستخدم يكتب بالإنجليزية — ردّ عليه بالإنجليزية فقط (يمكنك إبقاء أسماء الجهات العراقية والمبالغ كما هي).",
  ar: "",
};

/* OpenAI function-calling JSON schemas — one entry per tool. */
export const TOOL_SCHEMAS: unknown[] = [
  { type: "function", function: {
    name: "get_balance",
    description: "Get the current wallet balance in IQD.",
    parameters: { type: "object", properties: {} },
  } },
  { type: "function", function: {
    name: "list_bills",
    description:
      "List the user's bills (unpaid by default) with id, category, biller, amount, due date.",
    parameters: {
      type: "object",
      properties: { status: { type: "string", enum: ["unpaid", "paid", "all"] } },
    },
  } },
  { type: "function", function: {
    name: "pay_bill",
    description:
      "Pay an unpaid bill. Requires the bill id AND the user's PIN. Pass `hint` with the biller/category words the user mentioned (e.g. 'كهرباء', 'ماء', 'internet') — it is validated to prevent paying the wrong bill. If the PIN was not provided, ask the user for it instead of calling this tool.",
    parameters: {
      type: "object",
      required: ["bill_id", "pin"],
      properties: {
        bill_id: { type: "integer" },
        pin: { type: "string" },
        hint: { type: "string" },
      },
    },
  } },
  { type: "function", function: {
    name: "search_users",
    description:
      "Smart recipient search: pass whatever the user said about the person — partial name, first+family without the middle name, a nickname, a misspelling, an English transliteration ('zainab mousawi'), or name + city ('زينب من النجف'). Matching ignores the definite article ال, middle names and typos; results are ranked by similarity score with city and full card numbers. Use the returned card_number directly in transfer_money.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" } },
    },
  } },
  { type: "function", function: {
    name: "transfer_money",
    description:
      "Transfer IQD to another user by their 16-digit card number. Requires amount and the user's PIN. If the PIN was not provided, ask the user first.",
    parameters: {
      type: "object",
      required: ["receiver_card", "amount", "pin"],
      properties: {
        receiver_card: { type: "string" },
        amount: { type: "integer" },
        pin: { type: "string" },
      },
    },
  } },
  { type: "function", function: {
    name: "recent_transactions",
    description: "Show the user's recent wallet transactions.",
    parameters: {
      type: "object",
      properties: { limit: { type: "integer" } },
    },
  } },
  { type: "function", function: {
    name: "topup_wallet",
    description:
      "Credit the user's wallet with IQD (simulated cash-in at an AurPay kiosk). Requires amount and the user's PIN. If the PIN was not provided, ask the user first.",
    parameters: {
      type: "object",
      required: ["amount", "pin"],
      properties: { amount: { type: "integer" }, pin: { type: "string" } },
    },
  } },
  { type: "function", function: {
    name: "get_profile",
    description: "Get the current user's profile (name, city, masked card).",
    parameters: { type: "object", properties: {} },
  } },
  { type: "function", function: {
    name: "set_budget",
    description:
      "Set (or remove) a monthly spending limit for a category. Categories: " +
      BUDGETABLE_CATEGORIES.join(", ") +
      ". Arabic names: " +
      BUDGETABLE_CATEGORIES.map((c) => `${CATEGORY_AR[c] ?? c}=${c}`).join(", ") +
      ". A limit of 0 removes the budget. No PIN required (not a money movement). " +
      "Also returns month-to-date spend for the category.",
    parameters: {
      type: "object",
      required: ["category", "monthly_limit"],
      properties: {
        category: { type: "string", enum: [...BUDGETABLE_CATEGORIES] },
        monthly_limit: { type: "integer", minimum: 0 },
      },
    },
  } },
  { type: "function", function: {
    name: "get_spending",
    description:
      "Get the user's month-to-date spending breakdown by category, with monthly budget limits and status (ok / near 80%+ / over). Use it when the user asks how much they spent (e.g. 'شكد صرفي على الكهرباء هذا الشهر') or where their money goes.",
    parameters: { type: "object", properties: {} },
  } },
  { type: "function", function: {
    name: "schedule_payment",
    description:
      "Schedule a future/recurring payment (a PIN-authorized mandate executed automatically at its time — no PIN needed later). kind='bill' for a biller (target = biller code like 'MOE-BGD-R') or kind='transfer' for a user card (target = 16-digit card). `when` accepts Arabic phrases (غدًا، بعد يومين، أول الشهر الجاي، كل شهر) or ISO dates (2026-10-01). If the user did not provide their PIN, ask for it first.",
    parameters: {
      type: "object",
      required: ["kind", "target", "amount", "when", "pin"],
      properties: {
        kind: { type: "string", enum: ["bill", "transfer"] },
        target: { type: "string" },
        amount: { type: "integer" },
        when: { type: "string" },
        pin: { type: "string" },
        frequency: { type: "string", enum: ["once", "monthly"] },
      },
    },
  } },
  { type: "function", function: {
    name: "list_scheduled",
    description:
      "List the user's pending scheduled payments (upcoming bills/transfers mandates) with ids, amounts and next run times.",
    parameters: { type: "object", properties: {} },
  } },
  { type: "function", function: {
    name: "cancel_scheduled",
    description:
      "Cancel a pending scheduled payment by its id (from list_scheduled). No PIN needed.",
    parameters: {
      type: "object",
      required: ["scheduled_id"],
      properties: { scheduled_id: { type: "integer" } },
    },
  } },
  { type: "function", function: {
    name: "list_goals",
    description:
      "List the user's savings goals (أهداف التوفير) with ids, names, targets, saved amounts and progress percentages.",
    parameters: { type: "object", properties: {} },
  } },
  { type: "function", function: {
    name: "create_goal",
    description:
      "Create a new savings goal (هدف توفير). The user sets a target amount and saves towards it over time. No PIN required (no money moves at creation). Use it when the user says e.g. 'سوّي لي هدف حج بمليون' or 'ابدأ هدف توفير للسيارة'.",
    parameters: {
      type: "object",
      required: ["name", "target_amount"],
      properties: {
        name: { type: "string" },
        target_amount: { type: "integer", minimum: 10000 },
      },
    },
  } },
  { type: "function", function: {
    name: "deposit_goal",
    description:
      "Move IQD from the wallet balance into a savings goal (توفير مبلغ لهدف). Requires the goal id (from list_goals) and the user's PIN. If the PIN was not provided, ask the user for it first.",
    parameters: {
      type: "object",
      required: ["goal_id", "amount", "pin"],
      properties: {
        goal_id: { type: "integer" },
        amount: { type: "integer", minimum: 1000 },
        pin: { type: "string" },
      },
    },
  } },
];

/* ------------------------------------------------------------------ utils --- */

/** Python f"{n:,}" — plain English thousands separators. */
function en(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Python json.dumps(obj, ensure_ascii=False, separators=(",", ":")) */
export function jsonDumpsCompact(obj: unknown): string {
  return JSON.stringify(obj);
}

/** Python int(x) with a safe fallback (tools must never throw). */
function toInt(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v.trim());
    if (Number.isFinite(n)) return Math.trunc(n);
    return fallback;
  }
  return fallback;
}

function strArg(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/* --------------------------------------------------------- tool dispatch --- */

function executeTool(
  db: Db,
  user: UserRow,
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  switch (name) {
    case "get_balance":
      return T.getBalance(db, user) as unknown as Record<string, unknown>;
    case "list_bills":
      return T.listBills(db, user, strArg(args.status) || "unpaid") as unknown as Record<string, unknown>;
    case "pay_bill":
      return T.payBill(db, user, toInt(args.bill_id, 0), strArg(args.pin), strArg(args.hint)) as unknown as Record<string, unknown>;
    case "search_users":
      return T.searchUsers(db, user, strArg(args.query)) as unknown as Record<string, unknown>;
    case "transfer_money":
      return T.transferMoney(db, user, strArg(args.receiver_card), toInt(args.amount, 0), strArg(args.pin)) as unknown as Record<string, unknown>;
    case "recent_transactions":
      return T.recentTransactions(db, user, toInt(args.limit, 5)) as unknown as Record<string, unknown>;
    case "topup_wallet":
      return T.topupWallet(db, user, toInt(args.amount, 0), strArg(args.pin)) as unknown as Record<string, unknown>;
    case "get_profile":
      return T.getProfile(db, user) as unknown as Record<string, unknown>;
    case "set_budget":
      return T.setBudget(db, user, strArg(args.category), toInt(args.monthly_limit, 0)) as unknown as Record<string, unknown>;
    case "get_spending":
      return T.getSpending(db, user) as unknown as Record<string, unknown>;
    case "schedule_payment":
      return T.schedulePayment(
        db, user, strArg(args.kind), strArg(args.target),
        toInt(args.amount, 0), strArg(args.when), strArg(args.pin),
        strArg(args.frequency),
      ) as unknown as Record<string, unknown>;
    case "list_scheduled":
      return T.listScheduled(db, user) as unknown as Record<string, unknown>;
    case "cancel_scheduled":
      return T.cancelScheduled(db, user, toInt(args.scheduled_id, 0)) as unknown as Record<string, unknown>;
    case "list_goals":
      return T.listGoals(db, user) as unknown as Record<string, unknown>;
    case "create_goal":
      return T.createGoal(db, user, strArg(args.name), toInt(args.target_amount, 0)) as unknown as Record<string, unknown>;
    case "deposit_goal":
      return T.depositGoal(db, user, toInt(args.goal_id, 0), toInt(args.amount, 0), strArg(args.pin)) as unknown as Record<string, unknown>;
    default:
      return { error: `unknown tool ${name}` };
  }
}

/** Extract a UI-friendly action record when a tool produced a receipt. */
function toolSummaryForActions(
  name: string,
  result: Record<string, unknown>,
): AgentActionOut | null {
  if (name === "pay_bill" && result.ok) {
    return { tool: "pay_bill", ok: true, data: result.receipt, error: null };
  }
  if (name === "transfer_money" && result.ok) {
    return { tool: "transfer_money", ok: true, data: result.receipt, error: null };
  }
  if (name === "topup_wallet" && result.ok) {
    return { tool: "topup_wallet", ok: true, data: result.receipt, error: null };
  }
  if (name === "deposit_goal" && result.ok) {
    return { tool: "deposit_goal", ok: true, data: result.receipt, error: null };
  }
  return null;
}

/* -------------------------------------------------------- context block --- */

function contextBlock(db: Db, user: UserRow, unpaid: ListBillsResult): string {
  let billsTxt = "";
  for (const b of (unpaid.bills ?? []).slice(0, 10)) {
    const flag = b.overdue ? " (متأخرة!)" : "";
    billsTxt +=
      `\n- فاتورة رقم ${b.id} [${b.category}] ${b.biller} — ` +
      `${en(b.amount)} د.ع — تستحق ${b.due_date.slice(0, 10)}${flag}`;
  }

  // budgets + month-to-date spend so the agent can warn proactively
  let budgetTxt = "";
  try {
    const spend = T.getSpending(db, user);
    const budgeted = spend.categories.filter((c) => "monthly_limit" in c);
    const unbudgeted = spend.categories.filter(
      (c) => !("monthly_limit" in c) && c.spent > 0,
    );
    if (budgeted.length > 0) {
      budgetTxt = "\nميزانياته وحدود الصرف لهذا الشهر:";
      for (const c of budgeted) {
        const status =
          c.status === "ok"
            ? "ضمن الحد"
            : c.status === "near"
              ? "⚠️ قرب الحد"
              : c.status === "over"
                ? "🚨 تجاوز الحد"
                : "";
        budgetTxt +=
          `\n- ${c.name_ar}: صرف ${en(c.spent)} من حد ${en(c.monthly_limit ?? 0)} ` +
          `د.ع (${c.pct}%) — ${status}`;
      }
    } else {
      budgetTxt = "\nما عنده ميزانيات معينة بعد.";
    }
    if (unbudgeted.length > 0) {
      const rest = unbudgeted
        .slice(0, 5)
        .map((c) => `${c.name_ar} ${en(c.spent)}`)
        .join("، ");
      budgetTxt += `\nصرفه هذا الشهر على باقي التصنيفات: ${rest} د.ع.`;
    }
    budgetTxt += `\nمجموع صرفه هذا الشهر: ${en(spend.total_spent_this_month)} د.ع.`;
  } catch (e) {
    console.warn("[urpay-agent] spending context failed:", e); // never break the agent
  }

  // savings goals context so the agent can encourage/make deposits
  let goalsTxt = "";
  try {
    const goals = T.listGoals(db, user);
    if (goals.count > 0) {
      const lines: string[] = [];
      for (const g of goals.items.slice(0, 4)) {
        const flag = g.status === "completed" ? " (اكتمل 🎉)" : "";
        lines.push(
          `\n- هدف رقم ${g.id} ${g.emoji} «${g.name}»: وفّر ${en(g.saved)} من ` +
          `${en(g.target)} د.ع (${g.pct}%)${flag}`,
        );
      }
      goalsTxt = "\nأهداف التوفير:" + lines.join("");
    } else {
      goalsTxt = "\nما عنده أهداف توفير بعد (تقدر تسويها بأداة create_goal).";
    }
  } catch (e) {
    console.warn("[urpay-agent] goals context failed:", e);
  }

  return (
    `بيانات المستخدم الحالي: الاسم ${user.full_name}، المحافظة ${user.city}، ` +
    `بطاقة ••••${user.card_number.slice(-4)}، الرصيد الحالي ${en(user.balance)} د.ع.` +
    `\nفواتيره غير المدفوعة حاليًا:${billsTxt || " (لا توجد)"}` +
    budgetTxt +
    goalsTxt
  );
}

/* ------------------------------------------------------------ run agent --- */

export async function runAgent(
  db: Db,
  user: UserRow,
  message: string,
  emit?: EmitFn,
): Promise<AgentResult> {
  const actions: AgentActionOut[] = [];

  // --- provider chain ------------------------------------------------------
  if (groqAvailable()) {
    try {
      const reply = await llmLoop(db, user, message, actions, "groq", emit);
      return { reply, actions, provider: "groq" };
    } catch (e) {
      console.warn("[urpay-agent] Groq provider failed:", e);
    }
  }

  if (await bridgeAvailable()) {
    try {
      const reply = await llmLoop(db, user, message, actions, "zai", emit);
      return { reply, actions, provider: "zai" };
    } catch (e) {
      console.warn("[urpay-agent] z-ai bridge failed:", e);
    }
  }

  const reply = await localEngine(db, user, message, actions, emit);
  return { reply, actions, provider: "local" };
}

async function llmLoop(
  db: Db,
  user: UserRow,
  message: string,
  actions: AgentActionOut[],
  mode: "groq" | "zai",
  emit?: EmitFn,
): Promise<string> {
  // strong-but-cheap memory: newest turns verbatim + everything older
  // compressed into a digest (see longTermDigest below).
  const history = db.agentMessages
    .filter((m) => m.user_id === user.id)
    .sort((a, b) => b.id - a.id)
    .slice(0, MEMORY_SPAN)
    .reverse();
  const deduped = dropEchoedCurrent(history, message);
  const digest = longTermDigest(deduped);

  const unpaid = T.listBills(db, user, "unpaid");

  const llmMessages: ChatMessage[] = [
    {
      role: "system",
      content:
        SYSTEM_PROMPT +
        "\n" +
        contextBlock(db, user, unpaid) +
        (digest ? "\n" + digest : "") +
        LANG_DIRECTIVE[detectLang(message)],
    },
  ];
  for (const m of deduped.slice(-RECENT_VERBATIM)) {
    llmMessages.push({ role: m.role, content: trimHistoryContent(m.role, m.content) });
  }
  llmMessages.push({ role: "user", content: message });
  console.info(
    `[urpay-agent] agent memory: ${Math.min(deduped.length, RECENT_VERBATIM)} verbatim msgs + ` +
      `${digest ? (digest.match(/\n- /g) ?? []).length : 0} digest lines (span ${deduped.length})`,
  );

  // anti-hallucination guard: surface the latest explicitly requested
  // transfer amount from the recent conversation, so the model never has
  // to "remember" it from memory on the PIN turn (e.g. «حوّل 15000 …» then
  // «PIN 123456» two turns later)
  let amtHint = "";
  const userMsgs = llmMessages.filter((x) => x.role === "user");
  for (const m of [...userMsgs.slice(-6)].reverse()) {
    const low = m.content.toLowerCase();
    if (/حو[لّ]?|تحويل|حوالة|transfer|send/.test(low)) {
      const amt = parseAmount(low);
      if (amt && amt >= 1000) {
        amtHint =
          `\nتنبيه المبلغ: آخر مبلغ تحويل طلبه المستخدم هو ${en(amt)} د.ع — ` +
          "إذا نفّذت transfer_money الآن فاستخدم هذا المبلغ بالضبط، " +
          "ولا تخترع أو تغيّره، ما لم يحدد المستخدم مبلغًا آخر صراحة في رسالته الأخيرة.";
        break;
      }
    }
  }
  if (amtHint) llmMessages[0].content += amtHint;

  const toolSchemaText = (TOOL_SCHEMAS as { function: { name: string; description: string; parameters: unknown } }[])
    .map(
      (t) =>
        `- ${t.function.name}: ${t.function.description} args=${jsonDumpsCompact(t.function.parameters)}`,
    )
    .join("\n");

  for (let round = 0; round < 5; round++) {
    let out: { content?: string; tool_calls?: { name: string; args: Record<string, unknown> }[] };
    if (mode === "groq") {
      out = await groqChat(llmMessages, TOOL_SCHEMAS);
    } else {
      const sys =
        llmMessages[0].content + "\n" + BRIDGE_JSON_INSTRUCTION(toolSchemaText);
      const bridgeMessages: ChatMessage[] = [
        { role: "system", content: sys },
        ...llmMessages.slice(1),
      ];
      out = await zaiBridgeChat(bridgeMessages, toolSchemaText);
    }

    if (out.tool_calls && out.tool_calls.length > 0) {
      const calls = out.tool_calls;
      // record assistant tool-call turn for the conversation
      const callsDesc = jsonDumpsCompact(
        calls.map((c) => ({ tool: c.name, args: c.args })),
      );
      llmMessages.push({
        role: "assistant",
        content: `[تنفيذ أدوات] ${callsDesc}`,
      });
      for (const call of calls) {
        const result = executeTool(db, user, call.name, call.args ?? {});
        const action = toolSummaryForActions(call.name, result);
        if (action) actions.push(action);
        if (emit) {
          try {
            await emit({ tool: call.name });
          } catch {
            /* never let streaming break the loop */
          }
        }
        llmMessages.push({
          role: "user",
          content:
            `[نتيجة الأداة ${call.name}] ` +
            jsonDumpsCompact(result).slice(0, 900),
        });
      }
      continue;
    }

    const content = (out.content ?? "").trim();
    if (content) return content;
    return "حصل خلل بسيط، جرّب مرة ثانية لو سمحت.";
  }

  return "وصلت لحد الأدوات الأقصى لهذه الجلسة — جرّب تطلب خطوة خطوة.";
}

/* ---------------------------------------------------------------------------
 * Conversation memory — strong for the model, cheap on tokens
 * --------------------------------------------------------------------------- */
const RECENT_VERBATIM = 12; // newest messages sent word-for-word
const MEMORY_SPAN = 48; // total messages pulled (digest + verbatim window)
const DIGEST_LINES = 18; // max compressed lines for turns older than the window

// Unicode-aware PIN mask (Python \b is Unicode; JS \b is ASCII-only, so the
// lookarounds reproduce the exact Python boundary semantics for Arabic text)
const ECHO_MASK_RE =
  /(?<![\p{L}\p{N}_])(pin|بصورة|رمز)?\s*[:=]?\s*(\d{4,6})(?![\p{L}\p{N}_])/giu;

/** Same PIN masking the route applies before persisting a user turn. */
export function maskForCompare(text: string): string {
  return text.trim().replace(ECHO_MASK_RE, (_m, g1: string | undefined) => {
    return (g1 ?? "") + " ••••";
  });
}

/** The route persists the user's message BEFORE calling runAgent, so the
 * newest history row IS the current turn — drop it (the raw message, PIN
 * included for the tools, is appended separately at the end). */
function dropEchoedCurrent(
  history: AgentMessageRow[],
  message: string,
): AgentMessageRow[] {
  if (history.length > 0 && history[history.length - 1].role === "user") {
    const stored = history[history.length - 1].content;
    if (stored === message.trim() || stored === maskForCompare(message)) {
      return history.slice(0, -1);
    }
  }
  return history;
}

/** Cap per-message size — long bill lists / receipts from earlier turns keep
 * their informative head at a fraction of the token cost. */
function trimHistoryContent(role: string, content: string): string {
  const limit = role === "assistant" ? 700 : 400;
  if (content.length <= limit) return content;
  return content.slice(0, limit).replace(/\s+/g, " ").trim() + " …";
}

function digestLine(role: string, content: string): string {
  let text = content.replace(/\s+/g, " ").trim();
  if (text.length > 110) text = text.slice(0, 110).trimEnd() + "…";
  return (role === "user" ? "المستخدم: " : "أور: ") + text;
}

/** Compress turns older than the verbatim window into a few lines. */
function longTermDigest(history: AgentMessageRow[]): string {
  const older =
    history.length > RECENT_VERBATIM ? history.slice(0, -RECENT_VERBATIM) : [];
  if (older.length === 0) return "";
  const lines = older.slice(-DIGEST_LINES).map((m) => digestLine(m.role, m.content));
  return (
    "ذاكرة طويلة المدى — خلاصة مضغوطة لأقدم من المحادثة " +
    "(للسياق والمتابعة فقط؛ الأرقام الحالية دائمًا من الأدوات):\n" +
    lines.map((ln) => `- ${ln}`).join("\n")
  );
}

/* ---------------------------------------------------------------------------
 * Deterministic local engine (offline fallback — always works)
 * --------------------------------------------------------------------------- */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  electricity: ["كهرباء", "كهربائية", "كهرب", "electricity", "power"],
  water: ["ماء", "مياه", "water"],
  internet: ["انترنت", "إنترنت", "نت", "internet", "wifi"],
  mobile: ["شحن", "رصيد زين", "زين", "آسياسيل", "اسيا", "كورك", "mobile", "topup", "باقة"],
  education: ["جامعة", "دراسة", "رسوم", "تعليم", "مدرسة", "education", "tuition"],
  traffic: ["مرور", "مخالفة", "غرامة", "traffic", "fine"],
};
const PAY_WORDS = ["ادفع", "دفع", "سدد", "سداد", "اقطع", "pay", "settle"];

const PIN_RE =
  /(?:(pin|بصورة|الرمز|رمز))?\s*[:=]?\s*(\d{6})(?![\p{L}\p{N}_])/iu;
const CARD_RE =
  /(?<![\p{L}\p{N}_])(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})(?![\p{L}\p{N}_])/u;

/** Arabic amount parser: «الف/ألف/الاف/آلاف/k» suffixes then bare numbers. */
export function parseAmount(text: string): number | null {
  let m = text.match(/(\d[\d\s.,]*)\s*(الف|ألف|الاف|آلاف|k)(?![\p{L}\p{N}_])/iu);
  if (m) {
    const cleaned = m[1].replace(/[ ,]/g, "");
    // Python float() rejects multiple dots — mirror that (returns None)
    if (/^\d*\.?\d*$/.test(cleaned) && cleaned !== "" && cleaned !== ".") {
      return Math.trunc(parseFloat(cleaned) * 1000);
    }
    return null;
  }
  m = text.match(/(?<![\p{L}\p{N}_])(\d{3,7})(?![\p{L}\p{N}_])/u);
  if (m) return Number(m[1]);
  return null;
}

function firstCategoryKeyword(low: string): string | null {
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some((w) => low.includes(w))) return cat;
  }
  return null;
}

export async function localEngine(
  db: Db,
  user: UserRow,
  message: string,
  actions: AgentActionOut[],
  emit?: EmitFn,
): Promise<string> {
  const msg = message.trim();
  const low = msg.toLowerCase();
  const pending = pendingMap().get(user.id);

  const _emit = async (tool: string): Promise<void> => {
    if (emit) {
      try {
        await emit({ tool });
      } catch {
        /* ignore */
      }
    }
  };

  /* --- continue pending bill payment ------------------------------------ */
  if (pending && pending.bill_id !== undefined) {
    const pinMatch = msg.match(PIN_RE);
    if (/^(نعم|اي نعم|اكيد|أكيد|تم|يو|yes|y)(?![\p{L}\p{N}_])/iu.test(low)) {
      return `تمام! أكتب لي رمز الـ PIN حتى أنفّذ الدفع لفاتورة رقم ${pending.bill_id}.`;
    }
    let pin: string | null = null;
    if (pinMatch && /^\d{6}$/.test(msg.split("pin").join("").trim())) {
      pin = pinMatch[2];
    } else if (/^\s*\d{6}\s*$/.test(msg)) {
      pin = msg.trim();
    }
    if (pin) {
      await _emit("pay_bill");
      const result = T.payBill(db, user, pending.bill_id, pin);
      pendingMap().delete(user.id);
      if (result.ok && result.receipt) {
        const r = result.receipt;
        actions.push({ tool: "pay_bill", ok: true, data: r, error: null });
        return (
          `✅ تم الدفع بنجاح! فاتورة ${r.title} بمبلغ ${en(r.amount)} د.ع.\n` +
          `الرقم المرجعي: ${r.reference}\n` +
          `رصيدك الآن: ${en(r.balance_after)} د.ع`
        );
      }
      const err = result.error;
      if (err === "pin") {
        return "رمز الـ PIN غلط — حاول مرة ثانية (تذكر: الرمز 6 أرقام).";
      }
      if (err === "insufficient") {
        return (
          `الرصيد ما يكفي — رصيدك ${en(user.balance)} د.ع ` +
          `والمبلغ ${en(result.amount ?? 0)} د.ع. شحن رصيدك أولًا.`
        );
      }
      if (err === "already_paid") {
        return "هذي الفاتورة مدفوعة أصلًا ✅";
      }
      return "ما لقيت الفاتورة — تأكد من رقمها من قائمة الفواتير.";
    }
  }

  /* --- continue pending transfer (recipient resolved, awaiting PIN) ----- */
  if (pending && pending.transfer) {
    const tr = pending.transfer;
    if (/الغاء|إلغاء|cancel|stop|لا لا|ما اريد|لا اريد|خلاص/.test(low)) {
      pendingMap().delete(user.id);
      return "تم إلغاء الحوالة. أبرد أي شي ثاني؟";
    }
    let pin: string | null = null;
    if (/^\s*\d{6}\s*$/.test(msg)) {
      pin = msg.trim();
    } else {
      const pm = low.match(PIN_RE);
      if (pm && /pin|بصورة|رمز/.test(low)) {
        pin = pm[2];
      }
    }
    if (pin) {
      await _emit("transfer_money");
      const result = T.transferMoney(db, user, tr.card, tr.amount, pin);
      if (result.ok && result.receipt) {
        pendingMap().delete(user.id);
        const r = result.receipt;
        actions.push({ tool: "transfer_money", ok: true, data: r, error: null });
        return (
          `✅ تم التحويل! ${r.title} — ${en(r.amount)} د.ع\n` +
          `المرجع: ${r.reference}\nرصيدك: ${en(r.balance_after)} د.ع`
        );
      }
      if (result.error === "pin") {
        return "رمز الـ PIN غلط — حاول مرة ثانية (6 أرقام).";
      }
      if (result.error === "insufficient") {
        pendingMap().delete(user.id);
        return (
          `الرصيد ما يكفي — رصيدك ${en(user.balance)} د.ع ` +
          `والمبلغ ${en(tr.amount)} د.ع. عبّي المحفظة أولًا.`
        );
      }
      return "ما أكمل التحويل — جرب مرة ثانية.";
    }
    // message looks like a brand-new request → drop pending & re-run
    if (
      !/رصيد|فواتير|فاتورة|ادفع|دفع|اشحن|تعب[يّ]|ميزاني|جدول|سجل|اهداف|هدف|توفير|صرفي|معاملات|تحويل|حوالة|حو/.test(
        low,
      )
    ) {
      return (
        `الحوالة جاهزة: ${en(tr.amount)} د.ع إلى ${tr.name} ` +
        `(بطاقة …${tr.card.slice(-4)}).\n` +
        "أرسل رمز الـ PIN (6 أرقام) لإتمامها، أو اكتب «إلغاء»."
      );
    }
    pendingMap().delete(user.id);
  }

  /* --- pending amount answer (single recipient found, awaiting amount) -- */
  if (pending && pending.asked_amount) {
    const amt = parseAmount(low);
    if (amt && msg.split(" ").length <= 3) {
      const memo = pending.asked_amount;
      pendingMap().set(user.id, {
        transfer: { card: memo.card, name: memo.name, amount: amt },
      });
      return (
        `تمام — ححوّل ${en(amt)} د.ع إلى ${memo.name} ` +
        `(بطاقة …${memo.card.slice(-4)}).\n` +
        "أرسل رمز الـ PIN (6 أرقام) لإتمامها، أو اكتب «إلغاء»."
      );
    }
    pendingMap().delete(user.id);
  }

  if (/الغاء|إلغاء|cancel|stop|لا لا/.test(low)) {
    pendingMap().delete(user.id);
    return "تم الإلغاء. أبرد أي شي ثاني؟";
  }

  /* --- greetings --------------------------------------------------------- */
  if (/^(سلام|هلو|هلا|مرحبا|مرحبين|hi|hello|hey)[\s!!.]*$/.test(low)) {
    return (
      `هلا ${user.first_name}! 👋 أنا أور، مساعدك بأور پاي.\n` +
      `رصيدك حاليًا ${en(user.balance)} د.ع.\n` +
      "شنو تحب؟ أسرد فواتيرك، أدفعلك فاتورة، أو أحوّل مبلغ؟"
    );
  }

  /* --- spending insight (must run BEFORE the balance check: «شكد صرفي…») -- */
  if (
    /شكد صرفي|شنو صرفي|شكد انفق|شكد صرفت|وين تروح فلوسي|فين تروح فلوسي|تروح فلوسي|spending|how much.*(spent|spend)/.test(
      low,
    )
  ) {
    let cat = firstCategoryKeyword(low);
    if (/تحويل|حوال|transfer/.test(low)) cat = "transfer";
    await _emit("get_spending");
    const spend = T.getSpending(db, user);
    if (cat) {
      const row = spend.categories.find((c) => c.category === cat) ?? null;
      if (row === null) {
        return (
          `ما صرفت شي على ${CATEGORY_AR[cat] ?? cat} هذا الشهر. ` +
          "تريد تحددلها ميزانية؟"
        );
      }
      let txt = `صرفك على ${row.name_ar} هذا الشهر: ${en(row.spent)} د.ع`;
      if (row.monthly_limit !== undefined) {
        txt += ` من حد ${en(row.monthly_limit)} د.ع (${row.pct}%)`;
        if (row.status === "over") {
          txt += " 🚨 تجاوزت الحد — تحب ترفعه أو تكمل صرف؟";
        } else if (row.status === "near") {
          txt += " ⚠️ قربت توصل الحد.";
        }
      }
      return txt + ".";
    }
    const lines = [
      `مجموع صرفك هذا الشهر: ${en(spend.total_spent_this_month)} د.ع، توزّع كالتالي:`,
    ];
    for (const c of spend.categories.slice(0, 7)) {
      if (c.spent <= 0 && c.monthly_limit === undefined) continue;
      let txt = `• ${c.name_ar}: ${en(c.spent)} د.ع`;
      if (c.monthly_limit !== undefined) {
        txt += ` (الحد ${en(c.monthly_limit)})`;
        if (c.status === "over") txt += " 🚨";
        else if (c.status === "near") txt += " ⚠️";
      }
      lines.push(txt);
    }
    return lines.join("\n");
  }

  /* --- balance ----------------------------------------------------------- */
  if (/رصيد|balance|شكد عندي|شكد/.test(low)) {
    await _emit("get_balance");
    return `رصيدك الحالي: **${en(user.balance)} د.ع** 💰`;
  }

  /* --- savings goals (أهداف التوفير) -------------------------------------- */
  if (/اهداف|أهداف|هدف|توفير|goals?|savings/.test(low)) {
    const goals = T.listGoals(db, user);

    // create: «سوّي لي هدف حج بمليون» / «ابدأ هدف سيارة ب 3 مليون»
    if (/سوي|سوّي|انشئ|أنشئ|ابدأ|ابدا|اضف|أضف|افتح|create|new/.test(low)) {
      const amt = parseAmount(msg);
      if (!amt) {
        return "جميل! شنو الهدف وبكم؟ مثال: «سوّي لي هدف حج بمليون ونص».";
      }
      let name = msg.replace(
        /\d|سوي|سوّي|انشئ|أنشئ|ابدأ|ابدا|اضف|أضف|افتح|هدف|بمبلغ|بم|create|new|لي/g,
        " ",
      );
      name =
        name
          .replace(/\s+/g, " ")
          .replace("ل", "")
          .replace(/^[ ،,]+|[ ،,]+$/g, "") || "هدفي";
      await _emit("create_goal");
      const result = T.createGoal(db, user, name.slice(0, 48), amt);
      if (result.ok) {
        return (
          `✅ ${result.message}\n` +
          "تقدر توفّر له من المحفظة: «وفّر 50 الف لهدفي وبعدها PIN»."
        );
      }
      return `ما صار إنشاء الهدف — ${result.error ?? "جرّب مرة ثانية"}`;
    }

    // deposit: «وفّر 50 الف لهدف الحج وبعدها PIN 123456»
    if (/وفر|وفّر|خلي|اضف|أضف|deposit|save/.test(low)) {
      const pinM = msg.match(PIN_RE);
      if (!pinM) {
        return "التوفير يحتاج رمز الـ PIN — أكتب: «وفّر 50 الف لهدف الحج وبعدها PIN 123456».";
      }
      if (goals.count === 0) {
        return "ما عندك أهداف بعد — سوّي واحد أولًا: «سوّي لي هدف حج بمليون».";
      }
      const amt = parseAmount(msg) ?? 0;
      let goal: ListGoalsResult["items"][number] | null = null;
      for (const g of goals.items) {
        if (msg.includes(g.name) || g.name.split(" ").some((w) => msg.includes(w))) {
          goal = g;
          break;
        }
      }
      if (goal === null) {
        goal = goals.items.reduce((a, b) => (b.saved > a.saved ? b : a));
      }
      await _emit("deposit_goal");
      const result = T.depositGoal(db, user, goal.id, amt, pinM[2]);
      if (result.ok) {
        actions.push({
          tool: "deposit_goal",
          ok: true,
          data: result.receipt,
          error: null,
        });
        return `✅ ${result.message}`;
      }
      if (result.error === "pin_invalid") {
        return "رمز الـ PIN غلط — حاول مرة ثانية.";
      }
      return `ما تم التوفير — ${result.error}`;
    }

    // list (default)
    await _emit("list_goals");
    if (goals.count === 0) {
      return (
        "ما عندك أهداف توفير بعد 🎯 — سوّي واحد: " +
        "«سوّي لي هدف حج بمليون» أو «هدف سيارة ب 5 مليون»."
      );
    }
    const lines = [
      `عندك ${goals.count} أهداف — وفّرت لها مجموع ${en(goals.total_saved)} د.ع:`,
    ];
    for (const g of goals.items) {
      const flag = g.status === "completed" ? " 🎉 اكتمل!" : "";
      lines.push(
        `• ${g.emoji} «${g.name}»: ${en(g.saved)} من ${en(g.target)} د.ع (${g.pct}%)${flag}`,
      );
    }
    return lines.join("\n");
  }

  /* --- bills ------------------------------------------------------------- */
  if (/فواتير|فاتورة|bills|bill/.test(low) && !PAY_WORDS.some((w) => low.includes(w))) {
    await _emit("list_bills");
    const unpaid = T.listBills(db, user, "unpaid");
    if (unpaid.count === 0) {
      return "ما عندك فواتير غير مدفوعة — عاش! 🎉";
    }
    const lines = [
      `عندك ${unpaid.count} فواتير غير مدفوعة بمجموع ${en(unpaid.unpaid_total)} د.ع:`,
    ];
    for (const b of unpaid.bills) {
      const flag = b.overdue ? " ⚠️ متأخرة" : "";
      lines.push(`• رقم ${b.id} — ${b.biller}: ${en(b.amount)} د.ع${flag}`);
    }
    lines.push("اكتب: «ادفع رقم X وبعدها PIN» حتى أدفعلك.");
    return lines.join("\n");
  }

  /* --- pay --------------------------------------------------------------- */
  if (PAY_WORDS.some((w) => low.includes(w))) {
    await _emit("list_bills");
    const unpaid = T.listBills(db, user, "unpaid");
    if (unpaid.count === 0) {
      return "ما عندك فواتير غير مدفودة حاليًا 🎉";
    }

    const idMatch = low.match(/رقم\s*(\d+)|#(\d+)|id\s*(\d+)/);
    let billId: number | null = null;
    if (idMatch) {
      billId = Number(idMatch[1] ?? idMatch[2] ?? idMatch[3]);
    } else {
      for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
        if (words.some((w) => low.includes(w))) {
          for (const b of unpaid.bills) {
            if (b.category === cat) {
              billId = b.id;
              break;
            }
          }
          break;
        }
      }
    }
    if (billId === null) {
      return (
        "أي فاتورة أدفعلك؟ اكتب رقمها، مثلًا: «ادفع رقم 3».\n" +
        unpaid.bills
          .slice(0, 8)
          .map((b) => `• رقم ${b.id} — ${b.biller}: ${en(b.amount)} د.ع`)
          .join("\n")
      );
    }

    const pinMatch = low.match(PIN_RE);
    if (pinMatch && !/^\d{6}$/.test(msg.trim() || "x")) {
      const pin = pinMatch[2];
      await _emit("pay_bill");
      const result = T.payBill(db, user, billId, pin);
      if (result.ok && result.receipt) {
        const r = result.receipt;
        actions.push({ tool: "pay_bill", ok: true, data: r, error: null });
        return (
          `✅ تم الدفع! ${r.title} — ${en(r.amount)} د.ع\n` +
          `المرجع: ${r.reference}\nرصيدك: ${en(r.balance_after)} د.ع`
        );
      }
      if (result.error === "pin") {
        return "رمز الـ PIN غلط، جرب مرة ثانية.";
      }
      if (result.error === "insufficient") {
        return `الرصيد ما يكفي (${en(user.balance)} د.ع).`;
      }
      return "صار خطأ بالدفع — تأكد من رقم الفاتورة.";
    }

    pendingMap().set(user.id, { bill_id: billId });
    const target = unpaid.bills.find((b) => b.id === billId) ?? null;
    if (target) {
      return (
        `فاتورة ${target.biller} بمبلغ ${en(target.amount)} د.ع ` +
        `(${target.period || "بدون فترة"}).\n` +
        "أكتب «نعم» وبعدها سأطلب منك رمز الـ PIN لإتمام الدفع."
      );
    }
  }

  /* --- top-up ------------------------------------------------------------ */
  if (
    /اشحن|(?<![\p{L}\p{N}_])عب[يّ]?ي(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])عب[يّ]?يها(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])عب[يّ]?يه(?![\p{L}\p{N}_])|ايداع|إيداع|تعبئة|املا|املأ|topup|top.?up|recharge/u.test(
      low,
    )
  ) {
    const amount = parseAmount(low);
    if (amount && amount >= 1000) {
      const pinMatch = low.match(PIN_RE);
      // guard: a bare digit run equal to the amount is NOT a PIN
      const pin =
        pinMatch && pinMatch[2] !== String(amount) ? pinMatch[2] : null;
      if (pin) {
        await _emit("topup_wallet");
        const result = T.topupWallet(db, user, amount, pin);
        if (result.ok && result.receipt) {
          const r = result.receipt;
          actions.push({ tool: "topup_wallet", ok: true, data: r, error: null });
          return (
            `✅ تمت التعبئة! أضفنا ${en(amount)} د.ع لمحفظتك.\n` +
            `المرجع: ${r.reference}\nرصيدك الآن: ${en(r.balance_after)} د.ع`
          );
        }
        if (result.error === "pin") {
          return "رمز الـ PIN غلط — جرب مرة ثانية.";
        }
        return "المبلغ لازم يكون بين 1,000 و 5,000,000 د.ع.";
      }
      return `حاضر أعبيك ${en(amount)} د.ع — أرسل لي رمز الـ PIN لإتمام التعبئة.`;
    }
    return (
      "أكتب المبلغ اللي تريد تعبيه، مثل: «اشحن رصيدي 50000» " +
      "(بين 1,000 و 5,000,000 د.ع)."
    );
  }

  /* --- transfer ---------------------------------------------------------- */
  if (/حو[لّ]?|تحويل|حوالة|transfer|send/.test(low)) {
    const card = msg.match(CARD_RE);
    const amount = parseAmount(low);
    if (card && amount) {
      const pinMatch = low.match(PIN_RE);
      // guard: never treat the amount itself as the PIN
      const pin =
        pinMatch && pinMatch[2] !== String(amount) ? pinMatch[2] : null;
      if (pin) {
        await _emit("transfer_money");
        const result = T.transferMoney(db, user, card[1], amount, pin);
        if (result.ok && result.receipt) {
          const r = result.receipt;
          actions.push({ tool: "transfer_money", ok: true, data: r, error: null });
          return (
            `✅ تم التحويل! ${r.title} — ${en(r.amount)} د.ع\n` +
            `المرجع: ${r.reference}\nرصيدك: ${en(r.balance_after)} د.ع`
          );
        }
        if (result.error === "pin") {
          return "رمز الـ PIN غلط.";
        }
        if (result.error === "not_found") {
          return "ما لقيت مستلم بهذا الرقم — تأكد من 16 رقم البطاقة.";
        }
        return "ما أكمل التحويل — تأكد من المبلغ والرصيد.";
      }
      return (
        `حاضر أحوّل ${en(amount)} د.ع إلى البطاقة …${card[1].slice(-4)}. ` +
        "أرسل لي رمز الـ PIN لإتمامها."
      );
    }
    // smart recipient resolution — the matcher ignores amounts/filler
    // and scores name + city tokens (partial names, typos, English…)
    await _emit("search_users");
    const search = T.searchUsers(db, user, msg);
    if (search.count === 0) {
      return (
        "أعطني اسم المستلم أو رقم بطاقته (16 رقم) والمبلغ، مثل:\n" +
        "• «حوّل 50000 لزينب الموسوي»\n" +
        "• «حوّل 50000 على 4539555544441236»"
      );
    }
    const best = search.results[0];
    const runnerUp = search.count > 1 ? search.results[1].score : 0.0;
    const clear = search.count === 1 || best.score - runnerUp >= 0.12;
    if (clear) {
      if (!amount) {
        pendingMap().set(user.id, {
          asked_amount: {
            card: best.card_number,
            name: best.full_name,
            city: best.city,
            card_masked: best.card_masked,
          },
        });
        return (
          `لقيت ${best.full_name} (${best.city}) — بطاقة ${best.card_masked}.\n` +
          "كم المبلغ اللي تحب تحوّله؟ (مثال: 25000)"
        );
      }
      const pinM = low.match(PIN_RE);
      const inlinePin = pinM && pinM[2] !== String(amount) ? pinM[2] : null;
      if (inlinePin) {
        await _emit("transfer_money");
        const result = T.transferMoney(db, user, best.card_number, amount, inlinePin);
        if (result.ok && result.receipt) {
          const r = result.receipt;
          actions.push({ tool: "transfer_money", ok: true, data: r, error: null });
          return (
            `✅ تم التحويل! ${r.title} — ${en(r.amount)} د.ع\n` +
            `المرجع: ${r.reference}\nرصيدك: ${en(r.balance_after)} د.ع`
          );
        }
        if (result.error === "pin") {
          return "رمز الـ PIN غلط — حاول مرة ثانية.";
        }
        if (result.error === "insufficient") {
          return `الرصيد ما يكفي (${en(user.balance)} د.ع).`;
        }
        return "ما أكمل التحويل — تأكد من المبلغ والرصيد.";
      }
      pendingMap().set(user.id, {
        transfer: { card: best.card_number, name: best.full_name, amount },
      });
      return (
        `لقيت المستلم ✅ ${best.full_name} (${best.city}) — بطاقة ${best.card_masked}.\n` +
        `ححوّل ${en(amount)} د.ع — أرسل رمز الـ PIN (6 أرقام) ` +
        "لإتمام الحوالة، أو اكتب «إلغاء»."
      );
    }
    // several close candidates — let the user pick
    const lines = ["لقيت أكثر من مستخدم بهالمعلومات — لمن تقصد؟"];
    for (const u of search.results.slice(0, 5)) {
      const sc = u.score ? ` · تطابق ${pyRound(u.score * 100)}%` : "";
      lines.push(`• ${u.full_name} (${u.city}) — بطاقة ${u.card_masked}${sc}`);
    }
    lines.push("حدّد وحدة بالمدينة أو الاسم الكامل، أو أرسل رقم بطاقة كامل (16 رقم).");
    return lines.join("\n");
  }

  /* --- budgets ------------------------------------------------------------- */
  if (/ميزاني|بودج|budget|حد شهر|سقف/.test(low)) {
    // list budgets
    if (/ميزانياتي|كل الميزانيات|اشلون ميزانياتي|my budgets|list budgets/.test(low)) {
      const rows = db.budgets.filter((b) => b.user_id === user.id);
      if (rows.length === 0) {
        return (
          "ما عندك ميزانيات معينة بعد 📊\n" +
          "مثال: «ميزانية الكهرباء 150 ألف» حتى أحدّدلك حد شهري."
        );
      }
      const lines = ["ميزانياتك الشهرية:"];
      for (const bd of rows) {
        lines.push(
          `• ${CATEGORY_AR[bd.category] ?? bd.category}: ${en(bd.monthly_limit)} د.ع`,
        );
      }
      return lines.join("\n");
    }

    let cat = firstCategoryKeyword(low);
    if (/تحويل|حوال|transfer/.test(low)) cat = "transfer";
    const amount = parseAmount(low);
    if (cat && amount && amount >= 1000) {
      await _emit("set_budget");
      const result = T.setBudget(db, user, cat, amount);
      if (result.ok) {
        return `✅ ${result.message}`;
      }
      if (result.error === "bad_amount") {
        return "الحد لازم يكون بين 1,000 و 20,000,000 د.ع (أو 0 للحذف).";
      }
      return "التصنيف غير مدعوم — الميزانيات تشمل: كهرباء، ماء، إنترنت، اتصالات، تعليم، مرور، تحويلات.";
    }
    return (
      "حاضر أضبطلك ميزانية 📊 اكتب التصنيف والمبلغ، مثل:\n" +
      "• «ميزانية الكهرباء 150 ألف»\n" +
      "• «ميزانية تحويلات 500 ألف»\n" +
      "أو «ميزانياتي» حتى تشوف القائمة الحالية."
    );
  }

  /* --- scheduled payments ------------------------------------------------- */
  if (/جدول|جدّل|schedule|recurring|autopay/.test(low)) {
    // list
    if (/جدولاتي|جدولي|جدولات |my schedule|list scheduled/.test(low)) {
      await _emit("list_scheduled");
      const rows = T.listScheduled(db, user);
      if (rows.count === 0) {
        return "ما عندك جدولات بعد ⏰\nمثال: «جدّل دفع فاتورة الكهرباء أول الشهر الجاي»";
      }
      const lines = [`عندك ${rows.count} جدولة قيد الانتظار:`];
      for (const it of rows.items) {
        const freq = it.frequency === "monthly" ? " · شهريًا" : "";
        lines.push(
          `• رقم ${it.id} — ${it.label}: ${en(it.amount)} د.ع · ` +
          `${(it.next_run_at ?? "").slice(0, 16).replace("T", " ")}${freq}`,
        );
      }
      lines.push("«الغ جدولة رقم X» للإلغاء.");
      return lines.join("\n").replace(/,/g, "،");
    }

    // cancel
    const m = low.match(/(?:الغ|إلغاء|احذف|امسح)\s*(?:جدولة)?\s*(?:رقم)?\s*(\d+)/);
    if (m && /الغ|إلغاء|احذف|امسح|cancel/.test(low)) {
      await _emit("cancel_scheduled");
      const res = T.cancelScheduled(db, user, Number(m[1]));
      return res.ok ? "✅ " + (res.message ?? "") : "ما لقيت الجدولة — تأكد من رقمها.";
    }

    // create: needs kind + amount + when (+PIN)
    const amount = parseAmount(low);
    const whenTxt = msg; // pass the raw text — the parser understands Arabic
    const pinMatch = low.match(PIN_RE);
    const card = msg.match(CARD_RE);

    // detect kind: transfer if a card or «حوالة/حوّل» present, else bill
    const isTransfer = Boolean(card) || /حوالة|حوّل|حو ل/.test(low);
    // find the biller by category keyword
    const cat = firstCategoryKeyword(low);

    if (!amount || amount < 1000) {
      return (
        "حاضر أجدوللك ⏰ اكتب المبلغ، مثال:\n" +
        "• «جدّل دفع فاتورة الكهرباء 45 الف أول الشهر الجاي»\n" +
        "• «جدّل حوالة 100 الف على بطاقة ... بعد يومين»"
      );
    }
    if (!isTransfer && cat === null) {
      return (
        "أي فاتورة أجدوللك؟ حدد النوع، مثال:\n" +
        "• «جدّل فاتورة الكهرباء 45 الف أول الشهر»\n" +
        "• «جدّل فاتورة الماء 20 الف كل شهر»"
      );
    }

    let target = isTransfer && card ? card[1] : cat ?? "";
    const kind = isTransfer ? "transfer" : "bill";
    if (isTransfer && !card) {
      return "أعطني رقم بطاقة المستلم (16 رقم) ضمن الرسالة، مثل: «جدّل حوالة 100 الف على 4539555544441234 بعد يومين».";
    }

    if (pinMatch && pinMatch[2] !== String(amount)) {
      await _emit("schedule_payment");
      // resolve the biller from the raw message (city-aware)
      if (kind === "bill") {
        const resolved = T.resolveBiller(msg, user.city);
        if (resolved === null) {
          return "ما لقيت الجهة — اذكر نوع الفاتورة، مثل: «جدّل فاتورة الكهرباء 45 الف أول الشهر»";
        }
        target = resolved[0].code;
      }
      const res = T.schedulePayment(
        db, user, kind, target, amount, whenTxt, pinMatch[2],
      );
      if (res.ok) {
        return "✅ " + (res.message ?? "");
      }
      if (res.error === "pin") {
        return "رمز الـ PIN غلط — جرب مرة ثانية.";
      }
      if (res.error === "bad_when") {
        return res.detail ?? "ما فهمت التوقيت — جرب «غدًا» أو «أول الشهر الجاي».";
      }
      return res.detail ?? "ما أكملت الجدولة — تأكد من البيانات.";
    }
    return "تمام — أرسل لي رمز الـ PIN مرة واحدة لتخويل الجدولة (التنفيذ بعدين تلقائي).";
  }

  /* --- who-is / person lookup -------------------------------------------- */
  if (
    /منو|من هو|من هي|مين|ابحث|دور على|شسمه|شسمها|بطاقتها|بطاقته|رقم بطاقة|\bwho\b|\bfind\b|\bsearch\b/.test(
      low,
    ) &&
    !PAY_WORDS.some((w) => low.includes(w))
  ) {
    await _emit("search_users");
    const search = T.searchUsers(db, user, msg);
    if (search.count === 0) {
      return (
        "ما لقيت أحد بهالمعلومات بين مستخدمي أور پاي.\n" +
        "أعطني اسم أو معلومة أوضح (مثال: «زينب من النجف»)."
      );
    }
    const lines = [
      `لقيت ${search.count} ` +
        (search.count > 1 ? "مستخدمين بهالمعلومات:" : "مستخدم بهالمعلومات:"),
    ];
    for (const u of search.results.slice(0, 5)) {
      const sc = u.score ? ` · تطابق ${pyRound(u.score * 100)}%` : "";
      lines.push(`• ${u.full_name} (${u.city}) — بطاقة ${u.card_masked}${sc}`);
    }
    if (search.count === 1) {
      const u = search.results[0];
      lines.push(`تحب تحوّل لها مبلغ؟ اكتب: «حوّل 25000 ل${u.full_name}».`);
    } else {
      lines.push("حدّد وحدة منهم بالمدينة أو بالاسم الكامل.");
    }
    return lines.join("\n");
  }

  /* --- transactions ------------------------------------------------------ */
  if (/سجل|معاملات|حركات|آخر|transactions|history/.test(low)) {
    await _emit("recent_transactions");
    const txns = T.recentTransactions(db, user, 5);
    const lines = ["آخر 5 معاملات:"];
    for (const t of txns.transactions) {
      const arrow = t.direction === "out" ? "↗" : "↙";
      lines.push(
        `${arrow} ${t.title} — ${en(t.amount)} د.ع (${t.created_at.slice(0, 10)})`,
      );
    }
    return txns.count ? lines.join("\n") : "ما عندك معاملات بعد.";
  }

  /* --- help / default ---------------------------------------------------- */
  return (
    "أنا أور، مساعد أور پاي الذكي 🤖 أقدر أساعدك بـ:\n" +
    "• «شكد رصيدي» — استعلام الرصيد\n" +
    "• «فواتيري» — عرض الفواتير غير المدفوعة\n" +
    "• «ادفع رقم 3» — دفع فاتورة (بيطلب PIN)\n" +
    "• «حوّل 25000 على 4539123412341234» — تحويل\n" +
    "• «سجل معاملاتي» — آخر الحركات\n" +
    "• «اشحن رصيدي 50000» — تعبئة المحفظة\n" +
    "• «ميزانية الكهرباء 150 ألف» — حد صرف شهري\n" +
    "• «شكد صرفي هذا الشهر؟» — تحليل الصرف\n" +
    "• «جدّل فاتورة الكهرباء أول الشهر الجاي» — دفع مجدول\n" +
    "شنو تحب نسوي؟"
  );
}
