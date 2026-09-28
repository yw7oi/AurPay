/* LLM providers for the Bill Pay Agent — port of app/agent/providers.py.
 *
 * Priority:
 * 1. Groq — native function calling with `openai/gpt-oss-120b`
 *    (set GROQ_API_KEY_1..5 or GROQ_API_KEYS in the environment). Up to 5
 *    keys are kept in a pool and rotated automatically whenever one hits its
 *    tokens-per-minute limit — the user never waits for a key to recover.
 * 2. z-ai bridge — Node route on the Next.js server using z-ai-web-dev-sdk
 *    (works out of the box in the sandbox / no key needed).
 * 3. Local deterministic Arabic intent engine (always available, offline).
 *
 * Token-saving measures (Groq path):
 * - `reasoning_effort: "low"` for gpt-oss models — reasoning tokens are the
 *   biggest hidden completion cost on these models.
 * - `max_tokens` capped at 700 (replies are 2-5 sentences; tool calls are
 *   small JSON).
 * - Per-key token accounting exposed via groqPoolStatus().
 *
 * The key pool state (cooldowns + usage stats) lives on globalThis so
 * Next.js dev HMR reloads never reset it — same trick as the data store. */

export type ChatMessage = { role: string; content: string };

export type ToolCall = { name: string; args: Record<string, unknown> };

export type LlmOut = { content: string } | { tool_calls: ToolCall[] };

export type GroqKeyStat = {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  rate_limited: number;
};

export type GroqKeyStatus = GroqKeyStat & {
  index: number;
  key: string;
  available: boolean;
  cooldown_left: number;
};

type GroqPool = {
  keys: string[];
  cooldown: Map<number, number>; // key index → monotonic ms until usable
  stats: Map<number, GroqKeyStat>;
};

const GROQ_BASE_URL =
  process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1";
export { GROQ_BASE_URL };
const AGENT_MODEL = process.env.URPAY_AGENT_MODEL ?? "openai/gpt-oss-120b";
export const LLM_BRIDGE_URL =
  process.env.URPAY_LLM_BRIDGE ?? "http://127.0.0.1:3000/api/internal/llm";
export const LLM_BRIDGE_SECRET =
  process.env.URPAY_BRIDGE_SECRET ?? "urpay-bridge-secret";

/** Groq key pool — GROQ_API_KEYS ("k1,k2,…") + GROQ_API_KEY_1..5 + legacy
 * GROQ_API_KEY, deduped with order preserved (config.py _collect_groq_keys). */
export function collectGroqKeys(): string[] {
  const keys: string[] = [];
  const bulk = process.env.GROQ_API_KEYS ?? "";
  if (bulk.trim()) {
    for (const k of bulk.split(",")) if (k.trim()) keys.push(k.trim());
  }
  for (let i = 1; i <= 5; i++) {
    const slot = (process.env[`GROQ_API_KEY_${i}`] ?? "").trim();
    if (slot) keys.push(slot);
  }
  const legacy = (process.env.GROQ_API_KEY ?? "").trim();
  if (legacy) keys.push(legacy);
  return [...new Set(keys.filter((k) => k))];
}

const globalPool = globalThis as unknown as { __urpayGroqPool?: GroqPool };

function pool(): GroqPool {
  if (!globalPool.__urpayGroqPool) {
    globalPool.__urpayGroqPool = {
      keys: collectGroqKeys(),
      cooldown: new Map(),
      stats: new Map(),
    };
  }
  return globalPool.__urpayGroqPool;
}

/** monotonic clock (ms) — like Python time.monotonic() */
function mono(): number {
  return performance.now();
}

function stats(idx: number): GroqKeyStat {
  const p = pool();
  let st = p.stats.get(idx);
  if (!st) {
    st = { calls: 0, prompt_tokens: 0, completion_tokens: 0, rate_limited: 0 };
    p.stats.set(idx, st);
  }
  return st;
}

function keyAvailable(idx: number, now = mono()): boolean {
  return now >= (pool().cooldown.get(idx) ?? 0);
}

/** Snapshot of the key pool for /api/agent/usage (keys are masked). */
export function groqPoolStatus(): GroqKeyStatus[] {
  const p = pool();
  const now = mono();
  const out: GroqKeyStatus[] = [];
  p.keys.forEach((k, i) => {
    out.push({
      index: i + 1,
      key: k.length > 6 ? `•••${k.slice(-6)}` : "•••",
      available: keyAvailable(i, now),
      cooldown_left: Math.max(0, Math.floor((p.cooldown.get(i) ?? 0) - now)),
      ...stats(i),
    });
  });
  return out;
}

export function groqTotals(): {
  keys: number;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  rate_limited_events: number;
} {
  const p = pool();
  let calls = 0;
  let prompt = 0;
  let completion = 0;
  let limited = 0;
  for (const st of p.stats.values()) {
    calls += st.calls;
    prompt += st.prompt_tokens;
    completion += st.completion_tokens;
    limited += st.rate_limited;
  }
  return {
    keys: p.keys.length,
    calls,
    prompt_tokens: prompt,
    completion_tokens: completion,
    rate_limited_events: limited,
  };
}

/** Honor the server's reset hints when present, else ~1 minute. */
function cooldownSeconds(resp: Response): number {
  for (const header of [
    "x-ratelimit-reset-tokens",
    "x-ratelimit-reset-requests",
    "retry-after",
  ]) {
    const val = resp.headers.get(header);
    if (val) {
      const n = Number(val);
      if (Number.isFinite(n)) return Math.min(120, Math.max(5, n));
    }
  }
  return 65;
}

export function groqAvailable(): boolean {
  return pool().keys.length > 0;
}

/** Call Groq chat completions with automatic multi-key rotation.
 *
 * Tries every non-cooling key once (in pool order); a 429 parks that key on
 * a cooldown and the next key is tried IMMEDIATELY. Only when the whole pool
 * is throttled/unreachable does this reject (the engine then falls back to
 * the z-ai bridge — still no user-visible wait).
 * Resolves {"content"} or {"tool_calls": [{name, args}]}. */
export async function groqChat(
  messages: ChatMessage[],
  tools: unknown[],
): Promise<LlmOut> {
  const p = pool();
  if (p.keys.length === 0) throw new Error("no Groq keys configured");

  const payload: Record<string, unknown> = {
    model: AGENT_MODEL,
    messages,
    temperature: 0.3,
    // 700 is plenty for 2-5 sentence replies + small tool-call JSON —
    // every unused cap token is wasted budget on rate-limited tiers.
    max_tokens: 700,
  };
  if (AGENT_MODEL.toLowerCase().includes("gpt-oss")) {
    // reasoning models burn completion tokens on hidden chain-of-thought;
    // "low" keeps tool-calling sharp at a fraction of the tokens.
    payload.reasoning_effort = "low";
  }
  if (tools && tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = "auto";
  }

  const now = mono();
  const available = p.keys
    .map((_, i) => i)
    .filter((i) => keyAvailable(i, now));
  const cooling = p.keys.map((_, i) => i).filter((i) => !available.includes(i));
  const order = [...available, ...cooling];

  let lastError: unknown = null;
  for (const idx of order) {
    const key = p.keys[idx];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    let resp: Response;
    try {
      resp = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (e) {
      lastError = e;
      console.warn(
        `[urpay-agent] Groq key #${idx + 1} unreachable (${
          e instanceof Error ? e.name : "error"
        }) — trying next key`,
      );
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (resp.status === 429) {
      const wait = cooldownSeconds(resp);
      p.cooldown.set(idx, mono() + wait * 1000);
      stats(idx).rate_limited += 1;
      console.warn(
        `[urpay-agent] Groq key #${idx + 1} rate-limited (429) — switching to the next key now (cooldown ${Math.round(wait)}s)`,
      );
      continue;
    }

    if (!resp.ok) {
      throw new Error(`Groq HTTP ${resp.status}: ${await safeText(resp)}`);
    }

    const data = (await resp.json()) as {
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: {
            function?: { name?: string; arguments?: string };
          }[];
        };
      }[];
    };

    // token accounting — surfaces real spend per key
    const usage = data.usage ?? {};
    const st = stats(idx);
    st.calls += 1;
    st.prompt_tokens += usage.prompt_tokens ?? 0;
    st.completion_tokens += usage.completion_tokens ?? 0;
    console.info(
      `[urpay-agent] Groq key #${idx + 1} usage: ${usage.prompt_tokens ?? "?"} prompt + ${usage.completion_tokens ?? "?"} completion tokens`,
    );

    const choice = data.choices?.[0]?.message ?? {};
    if (choice.tool_calls && choice.tool_calls.length > 0) {
      const calls: ToolCall[] = [];
      for (const tc of choice.tool_calls) {
        const fn = tc.function ?? {};
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(fn.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = {};
        }
        calls.push({ name: fn.name ?? "", args });
      }
      return { tool_calls: calls };
    }
    return { content: choice.content ?? "" };
  }

  throw new Error(
    `all ${p.keys.length} Groq keys exhausted (rate-limited or unreachable): ${
      lastError instanceof Error ? lastError.message : "429"
    }`,
  );
}

async function safeText(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/** Probe the z-ai bridge (4s budget) — false on ANY error. */
export async function bridgeAvailable(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const resp = await fetch(LLM_BRIDGE_URL.replace("/llm", "/health"), {
      headers: { "X-Bridge-Secret": LLM_BRIDGE_SECRET },
      signal: controller.signal,
    });
    return resp.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Call the Node z-ai bridge. The model is instructed to answer in strict
 * JSON: {"tool": "...", "args": {...}} or {"reply": "..."}. */
export async function zaiBridgeChat(
  messages: ChatMessage[],
  toolSchemaText: string,
): Promise<LlmOut> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let content = "";
  try {
    const resp = await fetch(LLM_BRIDGE_URL, {
      method: "POST",
      headers: {
        "X-Bridge-Secret": LLM_BRIDGE_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages, tool_schema_text: toolSchemaText }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`bridge HTTP ${resp.status}: ${await safeText(resp)}`);
    }
    const data = (await resp.json()) as { content?: string };
    content = data.content ?? "";
  } finally {
    clearTimeout(timer);
  }

  const parsed = extractJson(content);
  if (parsed === null) return { content };
  if ("tool" in parsed) {
    return {
      tool_calls: [
        {
          name: String(parsed.tool ?? ""),
          args: (parsed.args as Record<string, unknown>) ?? {},
        },
      ],
    };
  }
  return {
    content: "reply" in parsed ? String(parsed.reply ?? content) : content,
  };
}

/** Best-effort extraction of the first JSON object in a reply. */
export function extractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let t = text;
  const fence = t.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fence) t = fence[1];
  const match = t.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as unknown;
    return typeof obj === "object" && obj !== null && !Array.isArray(obj)
      ? (obj as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
