"use client";

/* AurPay — types + typed API client (goes through the Next.js /api proxy). */

import type { Lang } from "./i18n";

export type User = {
  id: number;
  full_name: string;
  first_name: string;
  father_name: string;
  family_name: string;
  age: number;
  city: string;
  district: string;
  phone: string;
  email: string;
  card_number: string;
  card_masked: string;
  balance: number;
  avatar_hue: number;
  is_demo: boolean;
  created_at: string;
};

export type Bill = {
  id: number;
  category: CategoryKey;
  biller_code: string;
  biller_name: string;
  subscriber_no: string;
  amount: number;
  period: string;
  due_date: string;
  status: "unpaid" | "paid";
  overdue: boolean;
  issued_at: string;
  paid_at: string | null;
  receipt_ref: string | null;
};

export type Txn = {
  id: number;
  reference: string;
  type: "bill_payment" | "transfer_out" | "transfer_in" | "topup"
    | "goal_deposit" | "goal_withdraw";
  direction: "in" | "out";
  amount: number;
  balance_after: number;
  title: string;
  subtitle: string;
  category: string;
  created_at: string;
};

export type Receipt = {
  reference: string;
  title: string;
  subtitle: string;
  amount: number;
  balance_after: number;
  created_at: string;
};

export type AgentAction = {
  tool: string;
  ok: boolean;
  data: Receipt | null;
  error: string | null;
};

export type AgentMessage = {
  role: "user" | "assistant";
  content: string;
  provider?: string;
  created_at?: string;
};

export type CategoryKey =
  | "electricity" | "water" | "internet" | "mobile" | "education" | "traffic";

export type CategoryMeta = {
  key: CategoryKey;
  ar: string;
  en: string;
  icon: string;
  desc: string;
};

export type PlatformStats = {
  users: number;
  transactions: number;
  volume_iqd: number;
  bills_paid: number;
  demo: { full_name: string; card_number: string; pin: string; city: string } | null;
};

export type UserSummary = {
  id: number;
  full_name: string;
  city: string;
  card_number: string;
  avatar_hue: number;
};

export type TransferReq = {
  id: number;
  amount: number;
  status: "pending";
  role: "sender" | "receiver";
  counterparty: string;
  counterparty_card: string;
  created_at: string;
};

export type Notification = {
  id: number;
  kind:
    | "payment" | "topup" | "transfer_in" | "transfer_out"
    | "transfer_request" | "transfer_declined" | "bill_due" | "welcome"
    | "budget_exceeded" | "scheduled_executed" | "scheduled_failed";
  title: string;
  body: string;
  amount: number | null;
  reference: string;
  is_read: boolean;
  created_at: string;
};

export type NotificationsFeed = {
  items: Notification[];
  unread: number;
};

export type AgentStreamHandlers = {
  onStep?: (step: { tool: string; label: string }) => void;
  onToken?: (chunk: string) => void;
};

export type BudgetRow = {
  category: string;
  monthly_limit: number;
  spent: number;
  remaining: number;
  pct: number;
  status: "ok" | "near" | "over";
};

export type BudgetsFeed = {
  month: string;
  month_start: string;
  items: BudgetRow[];
  total: { limit: number; spent: number };
  categories: string[];
};

export type Analytics = {
  window_days: number;
  spend_total: number;
  categories: { category: string; total: number; count: number }[];
  months: { label: string; out: number; in: number }[];
  bills: { unpaid_count: number; unpaid_total: number; overdue_count: number };
  top_counterparties: {
    name: string; total: number; count: number; avatar_hue: number;
  }[];
};

export type ScheduledItem = {
  id: number;
  kind: "bill" | "transfer";
  label: string;
  category: string;
  biller_name: string;
  subscriber_no: string;
  receiver_name: string;
  receiver_card_masked: string;
  amount: number;
  frequency: "once" | "monthly";
  next_run_at: string;
  last_run_at: string | null;
  status: "pending" | "paused" | "executed" | "cancelled" | "failed";
  created_at: string;
};

export type ScheduledFeed = {
  pending: ScheduledItem[];
  history: ScheduledItem[];
  monthly_total: number;
  pending_total: number;
};

export type FavoriteItem = {
  id: number;
  user_id: number;
  full_name: string;
  first_name: string;
  city: string;
  card_number: string;
  avatar_hue: number;
};

export type GoalItem = {
  id: number;
  name: string;
  emoji: string;
  target_amount: number;
  saved_amount: number;
  remaining: number;
  pct: number;
  status: "active" | "completed";
  created_at: string;
};

export type GoalsFeed = {
  items: GoalItem[];
  totals: { count: number; target: number; saved: number };
};

/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined)
    headers["Content-Type"] = "application/json";
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;

  const res = await fetch(`/api/${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    let detail = `خطأ (${res.status})`;
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : detail;
    } catch {
      /* ignore */
    }
    // expired/invalid session -> force logout (derived view falls back to landing)
    if (res.status === 401 && typeof window !== "undefined") {
      const { useSession } = await import("./store");
      useSession.getState().logout();
    }
    throw new ApiError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

/* ------------------------------------------------------------------ */
/* Re-encode a recorded audio blob as 16-bit mono WAV via Web Audio.  */
/* The ASR service only accepts WAV/WebM, but Safari records MP4 —    */
/* this runs fully client-side so every browser can use the mic.      */
/* ------------------------------------------------------------------ */
async function blobToWav(blob: Blob): Promise<Blob> {
  const arrayBuf = await blob.arrayBuffer();
  const Ctx: typeof AudioContext =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(arrayBuf);
    const frames = audio.length;
    const rate = audio.sampleRate;
    /* downmix to mono */
    let mono: Float32Array;
    if (audio.numberOfChannels <= 1) {
      mono = audio.getChannelData(0);
    } else {
      mono = new Float32Array(frames);
      for (let c = 0; c < audio.numberOfChannels; c++) {
        const data = audio.getChannelData(c);
        for (let i = 0; i < frames; i++) mono[i] += data[i] / audio.numberOfChannels;
      }
    }
    /* 16-bit PCM WAV container */
    const view = new DataView(new ArrayBuffer(44 + frames * 2));
    const tag = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    tag(0, "RIFF");
    view.setUint32(4, 36 + frames * 2, true);
    tag(8, "WAVE");
    tag(12, "fmt ");
    view.setUint32(16, 16, true);        // PCM chunk size
    view.setUint16(20, 1, true);         // PCM format
    view.setUint16(22, 1, true);         // mono
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);  // byte rate
    view.setUint16(32, 2, true);         // block align
    view.setUint16(34, 16, true);        // bits per sample
    tag(36, "data");
    view.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i++) {
      const s = Math.max(-1, Math.min(1, mono[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([view.buffer], { type: "audio/wav" });
  } finally {
    void ctx.close();
  }
}

export const urpay = {
  /* public */
  stats: () => api<PlatformStats>("stats"),
  billers: () =>
    api<{ categories: CategoryMeta[]; billers: Record<string, { code: string; name: string }[]> }>("billers"),
  cities: () => api<{ cities: string[] }>("cities"),

  /* auth */
  login: (card_number: string, pin: string) =>
    api<{ access_token: string; expires_at: string; user: User }>("auth/login", {
      method: "POST",
      body: { card_number, pin },
    }),
  register: (body: {
    first_name: string;
    father_name: string;
    family_name: string;
    age: number;
    city: string;
    phone?: string;
    card_number: string;
    pin: string;
  }) =>
    api<{ access_token: string; expires_at: string; user: User }>("auth/register", {
      method: "POST",
      body,
    }),
  me: (token: string) => api<User>("auth/me", { token }),

  /* wallet */
  bills: (token: string, status?: "unpaid" | "paid" | "all") =>
    api<Bill[]>(`bills${status ? `?status=${status}` : ""}`, { token }),
  payBill: (token: string, bill_id: number, pin: string) =>
    api<Receipt>("bills/pay", { method: "POST", body: { bill_id, pin }, token }),
  simulateBill: (
    token: string,
    body: { category: string; biller_code: string; subscriber_no: string; amount: number },
  ) => api<Bill>("bills/simulate", { method: "POST", body, token }),
  transactions: (token: string, limit = 60, type?: string) =>
    api<Txn[]>(`transactions?limit=${limit}${type ? `&type=${type}` : ""}`, { token }),
  searchUsers: (token: string, q: string) =>
    api<UserSummary[]>(`users/search?q=${encodeURIComponent(q)}`, { token }),
  transferRequest: (token: string, body: { receiver_card: string; amount: number }) =>
    api<{ message: string; request: { id: number; receiver: string; amount: number } }>(
      "transfer/request",
      { method: "POST", body, token },
    ),
  transferConfirm: (token: string, id: number, pin: string) =>
    api<{ message: string; receipt: Receipt }>(`transfer/confirm/${id}`, {
      method: "POST",
      body: { pin },
      token,
    }),
  transferRequests: (token: string) =>
    api<TransferReq[]>("transfer/requests", { token }),
  transferCancel: (token: string, id: number) =>
    api<{ message: string }>(`transfer/cancel/${id}`, { method: "POST", token }),
  transferDecline: (token: string, id: number) =>
    api<{ message: string }>(`transfer/decline/${id}`, { method: "POST", token }),

  changePin: (token: string, current_pin: string, new_pin: string) =>
    api<{ message: string }>("auth/change-pin", {
      method: "POST",
      body: { current_pin, new_pin },
      token,
    }),

  /* notifications */
  notifications: (token: string) =>
    api<NotificationsFeed>("notifications", { token }),
  notificationsReadAll: (token: string) =>
    api<{ message: string; updated: number }>("notifications/read-all", {
      method: "POST",
      token,
    }),
  notificationRead: (token: string, id: number) =>
    api<{ message: string }>(`notifications/${id}/read`, {
      method: "POST",
      token,
    }),

  /* CSV export — fetches a blob through the proxy and triggers a download */
  exportTransactionsCsv: async (token: string): Promise<void> => {
    const res = await fetch("/api/transactions/export", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new ApiError(`خطأ (${res.status})`, res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "urpay-transactions.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  /* agent — SSE streaming (POST + ReadableStream; falls back to agentChat) */
  agentChatStream: async (
    token: string,
    message: string,
    handlers: AgentStreamHandlers,
  ): Promise<{ reply: string; actions: AgentAction[]; provider: string }> => {
    const res = await fetch("/api/agent/chat/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message }),
    });
    if (res.status === 401 && typeof window !== "undefined") {
      const { useSession } = await import("./store");
      useSession.getState().logout();
    }
    if (!res.ok || !res.body) {
      let detail = `خطأ (${res.status})`;
      try {
        const data = await res.json();
        if (typeof data.detail === "string") detail = data.detail;
      } catch {
        /* ignore */
      }
      throw new ApiError(detail, res.status);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let reply = "";
    let actions: AgentAction[] = [];
    let provider = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      /* SSE frames are separated by a blank line */
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = "";
        let data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7).trim();
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        if (!data) continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        if (event === "step" && handlers.onStep) {
          handlers.onStep({
            tool: String(payload.tool ?? ""),
            label: String(payload.label ?? "يشتغل…"),
          });
        } else if (event === "token") {
          const t = String(payload.t ?? "");
          reply += t;
          handlers.onToken?.(t);
        } else if (event === "done") {
          actions = (payload.actions as AgentAction[]) ?? [];
          provider = String(payload.provider ?? "");
        } else if (event === "error") {
          throw new ApiError(String(payload.detail ?? "خطأ بالبث"), 500);
        }
      }
    }
    return { reply, actions, provider };
  },

  topup: (token: string, amount: number, pin: string) =>
    api<Receipt>("topup", { method: "POST", body: { amount, pin }, token }),

  /* analytics */
  analytics: (token: string) =>
    api<Analytics>(`analytics`, { token }),

  /* budgets */
  budgets: (token: string) =>
    api<BudgetsFeed>("budgets", { token }),
  setBudget: (token: string, category: string, monthly_limit: number) =>
    api<{ message: string; removed: boolean }>("budgets", {
      method: "PUT",
      body: { category, monthly_limit },
      token,
    }),

  /* scheduled payments */
  scheduled: (token: string) =>
    api<ScheduledFeed>("scheduled", { token }),
  scheduleCreate: (token: string, body: {
    kind: "bill" | "transfer";
    biller_code?: string;
    subscriber_no?: string;
    receiver_card?: string;
    amount: number;
    execute_at: string;
    frequency: "once" | "monthly";
    pin: string;
  }) =>
    api<{ message: string; scheduled: ScheduledItem }>("scheduled", {
      method: "POST",
      body,
      token,
    }),
  scheduledCancel: (token: string, id: number) =>
    api<{ message: string }>(`scheduled/${id}/cancel`, { method: "POST", token }),
  scheduledPause: (token: string, id: number) =>
    api<{ message: string; scheduled: ScheduledItem }>(`scheduled/${id}/pause`, {
      method: "POST",
      token,
    }),
  scheduledResume: (token: string, id: number) =>
    api<{ message: string; scheduled: ScheduledItem }>(`scheduled/${id}/resume`, {
      method: "POST",
      token,
    }),
  scheduledEdit: (token: string, id: number, body: {
    amount?: number;
    execute_at?: string;
    pin: string;
  }) =>
    api<{ message: string; scheduled: ScheduledItem }>(`scheduled/${id}/edit`, {
      method: "POST",
      body,
      token,
    }),

  /* savings goals */
  goals: (token: string) => api<GoalsFeed>("goals", { token }),
  goalCreate: (token: string, body: { name: string; target_amount: number; emoji?: string }) =>
    api<{ message: string; goal: GoalItem }>("goals", { method: "POST", body, token }),
  goalDeposit: (token: string, id: number, amount: number, pin: string) =>
    api<{ message: string; goal: GoalItem; receipt: Receipt }>(`goals/${id}/deposit`, {
      method: "POST",
      body: { amount, pin },
      token,
    }),
  goalWithdraw: (token: string, id: number, amount: number | null, pin: string) =>
    api<{ message: string; goal: GoalItem; receipt: Receipt }>(`goals/${id}/withdraw`, {
      method: "POST",
      body: { amount, pin },
      token,
    }),
  goalDelete: (token: string, id: number, pin: string) =>
    api<{ message: string }>(`goals/${id}/delete`, {
      method: "POST",
      body: { pin },
      token,
    }),

  /* favorites */
  favorites: (token: string) =>
    api<FavoriteItem[]>("favorites", { token }),
  favoriteAdd: (token: string, card_number: string) =>
    api<{ message: string; favorite: FavoriteItem }>("favorites", {
      method: "POST",
      body: { card_number },
      token,
    }),
  favoriteRemove: (token: string, targetUserId: number) =>
    api<{ message: string }>(`favorites/${targetUserId}`, {
      method: "DELETE",
      token,
    }),

  /* agent */
  agentChat: (token: string, message: string) =>
    api<{ reply: string; actions: AgentAction[]; provider: string }>("agent/chat", {
      method: "POST",
      body: { message },
      token,
    }),
  agentHistory: (token: string) =>
    api<AgentMessage[]>("agent/history", { token }),
  agentClear: (token: string) => api<{ message: string }>("agent/history", { method: "DELETE", token }),

  /* agent voice — multipart upload (recorded blob) → transcribed text.
     The ASR service accepts ONLY WAV and WebM; Safari records MP4/MP3 and
     some browsers produce OGG — anything else is re-encoded to 16-bit mono
     WAV in the browser via the Web Audio API (no dependencies, works
     offline, keeps the payload small). */
  agentVoice: async (token: string, rawBlob: Blob): Promise<string> => {
    let blob = rawBlob;
    if (!/webm|wav/i.test(blob.type) && typeof window !== "undefined") {
      try {
        blob = await blobToWav(blob);
      } catch { /* keep original — backend/ASR will surface the error */ }
    }
    const form = new FormData();
    const ext = blob.type.includes("mp4") ? "m4a"
      : blob.type.includes("webm") ? "webm"
      : blob.type.includes("ogg") ? "ogg"
      : blob.type.includes("wav") ? "wav" : "audio";
    form.append("file", blob, `voice.${ext}`);
    const res = await fetch("/api/agent/voice", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (res.status === 401 && typeof window !== "undefined") {
      const { useSession } = await import("./store");
      useSession.getState().logout();
    }
    if (!res.ok) {
      let detail = `خطأ (${res.status})`;
      try {
        const data = await res.json();
        if (typeof data.detail === "string") detail = data.detail;
      } catch { /* ignore */ }
      throw new ApiError(detail, res.status);
    }
    const data = (await res.json()) as { text: string };
    return (data.text ?? "").trim();
  },
};

/* ------------------------------------------------------------------ */

export function fmtIQD(amount: number, withCurrency = true, lang: Lang = "ar"): string {
  const n = Math.round(amount);
  const s = lang === "en" ? n.toLocaleString("en-US") : n.toLocaleString("en-US").replace(/,/g, "،");
  if (!withCurrency) return s;
  return lang === "en" ? `${s} IQD` : `${s} د.ع`;
}

export function fmtDate(iso: string, lang: Lang = "ar"): string {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "en" ? "en-GB" : "ar-IQ-u-nu-latn", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateTime(iso: string, lang: Lang = "ar"): string {
  const d = new Date(iso);
  const loc = lang === "en" ? "en-GB" : "ar-IQ-u-nu-latn";
  return (
    d.toLocaleDateString(loc, { day: "numeric", month: "short" }) +
    " · " +
    d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })
  );
}

export function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function timeAgo(iso: string, lang: Lang = "ar"): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (lang === "en") {
    if (mins < 1) return "now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 7) return `${days}d ago`;
    return fmtDate(iso, lang);
  }
  if (mins < 1) return "الآن";
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "أمس";
  if (days < 7) return `قبل ${days} أيام`;
  return fmtDate(iso);
}

export function dueLabel(iso: string, lang: Lang = "ar"): string {
  const days = daysUntil(iso);
  if (lang === "en") {
    if (days < 0) return `overdue ${Math.abs(days)}d`;
    if (days === 0) return "due today";
    if (days === 1) return "due tomorrow";
    return `in ${days} days`;
  }
  if (days < 0) return `متأخرة ${Math.abs(days)} يوم`;
  if (days === 0) return "تستحق اليوم";
  if (days === 1) return "تستحق غدًا";
  return `بعد ${days} يوم`;
}

export const CATEGORY_AR: Record<string, string> = {
  electricity: "كهرباء",
  water: "ماء",
  internet: "إنترنت",
  mobile: "اتصالات",
  education: "تعليم",
  traffic: "مرور",
  health: "صحة",
  gas: "غاز",
  transfer: "تحويل",
  wallet: "محفظة",
  savings: "توفير",
  topup: "تعبئة",
};

export const CATEGORY_EN: Record<string, string> = {
  electricity: "Electricity",
  water: "Water",
  internet: "Internet",
  mobile: "Mobile",
  education: "Education",
  traffic: "Traffic",
  health: "Health",
  gas: "Gas",
  transfer: "Transfer",
  wallet: "Wallet",
  savings: "Savings",
  topup: "Top-up",
};

/** Localized category label. */
export function categoryName(cat: string, lang: Lang = "ar"): string {
  return (lang === "en" ? CATEGORY_EN : CATEGORY_AR)[cat] ?? cat;
}
