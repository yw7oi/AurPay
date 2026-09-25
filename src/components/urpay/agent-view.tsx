"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Eraser, Loader2, SendHorizonal, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/store";
import { urpay, type AgentAction, type AgentMessage } from "@/lib/urpay";
import { UrPayMark } from "./logo";
import { ReceiptCard } from "./parts";

type ChatMsg = AgentMessage & { actions?: AgentAction[] };

const SUGGESTIONS = [
  "شكد رصيدي؟",
  "فواتيري",
  "ادفع فاتورة الكهرباء",
  "سجل معاملاتي",
  "حوّل 25000 على بطاقة 4539555544441236",
];

const PROVIDER_LABEL: Record<string, string> = {
  groq: "Groq · gpt-oss-120b",
  zai: "Z-AI Bridge",
  local: "المحرك المحلي",
};

export function AgentView() {
  const { token, setUser, user } = useSession();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [provider, setProvider] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  /* load history */
  useEffect(() => {
    if (!token) return;
    urpay
      .agentHistory(token)
      .then((h) => {
        setMessages(h);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [token]);

  /* auto-scroll */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if (!message || sending || !token) return;
    setInput("");
    setSending(true);
    setMessages((ms) => [...ms, { role: "user", content: message }]);
    try {
      const res = await urpay.agentChat(token, message);
      setProvider(res.provider);
      setMessages((ms) => [
        ...ms,
        { role: "assistant", content: res.reply, actions: res.actions, provider: res.provider },
      ]);
      // refresh balance after possible payment
      const me = await urpay.me(token).catch(() => null);
      if (me) setUser(me);
    } catch (err) {
      setMessages((ms) => [
        ...ms,
        {
          role: "assistant",
          content: `صار خطأ بالاتصال: ${err instanceof Error ? err.message : "حاول مرة ثانية"}`,
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function clearChat() {
    if (!token) return;
    await urpay.agentClear(token).catch(() => null);
    setMessages([]);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-12.5rem)] lg:h-[calc(100vh-10rem)]" dir="rtl">
      {/* header */}
      <div className="flex items-center justify-between gap-3 pb-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="relative shrink-0">
            <UrPayMark className="h-12 w-12" />
            <span className="absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full bg-[#3ED9A3] ring-2 ring-background animate-pulse-dot" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl leading-tight">أور · وكيل الدفع الذكي</h1>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {provider ? PROVIDER_LABEL[provider] ?? provider : "متصل — Groq gpt-oss-120b"}
              {user && (
                <>
                  <span className="text-border">|</span>
                  <span className="num">رصيدك: {user.balance.toLocaleString("en-US")} د.ع</span>
                </>
              )}
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearChat}
            className="rounded-xl text-muted-foreground hover:text-destructive font-semibold shrink-0"
          >
            <Eraser className="h-4 w-4" />
            محادثة جديدة
          </Button>
        )}
      </div>

      {/* messages */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto scrollbar-slim rounded-3xl border border-border/60 bg-secondary/25 p-4 sm:p-5 space-y-3.5"
        role="log"
        aria-live="polite"
      >
        {loaded && messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <UrPayMark className="h-16 w-16" />
            <p className="mt-4 font-display text-lg">
              هلا {user?.first_name ?? "بك"}! أنا أور — وكيلك المالي
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground max-w-sm leading-relaxed">
              أقدر أدفع فواتيرك، أسويلك تحويلات، أچيك رصيدك وأسرد معاملاتك — كل شي من هنا.
              أي دفعة بيطلب مني الـ PIN مالك.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 max-w-md">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-primary/30 bg-card px-3.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/[.07] hover:border-primary/50 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
              className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}
            >
              <div className={`max-w-[88%] sm:max-w-[76%] space-y-2.5 ${m.role === "user" ? "" : "items-end"}`}>
                <div
                  className={`rounded-2xl px-4 py-3 text-[0.88rem] leading-relaxed whitespace-pre-line ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-bl-md shadow-lift"
                      : "bg-card border border-border/60 shadow-sm rounded-br-md"
                  }`}
                >
                  {m.content}
                </div>
                {m.actions
                  ?.filter((a) => a.ok && a.data)
                  .map((a, j) => <ReceiptCard key={j} receipt={a.data!} floating />)}
                {m.role === "assistant" && m.provider && (
                  <p className="text-[0.6rem] text-muted-foreground/70 text-end num" dir="ltr">
                    ⚡ {PROVIDER_LABEL[m.provider] ?? m.provider}
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {sending && (
          <div className="flex justify-end">
            <div className="bg-card border border-border/60 rounded-2xl rounded-br-md px-4 py-3.5 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-pulse-dot" />
              <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-pulse-dot" style={{ animationDelay: "0.2s" }} />
              <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-pulse-dot" style={{ animationDelay: "0.4s" }} />
              <span className="text-[0.68rem] text-muted-foreground ms-1">أور يفكر…</span>
            </div>
          </div>
        )}
      </div>

      {/* input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="mt-4 flex items-center gap-2.5 rounded-2xl border border-border/70 bg-card p-2 pe-2.5 shadow-lift"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="اكتب لأور… (مثال: ادفع فاتورة الإنترنت)"
          className="flex-1 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground/60"
          disabled={sending}
          maxLength={500}
          aria-label="رسالة للمساعد أور"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!input.trim() || sending}
          className="rounded-xl h-10 w-10 shrink-0"
          aria-label="إرسال"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <SendHorizonal className="h-4 w-4 rtl:-scale-x-100" />
          )}
        </Button>
      </form>
      <p className="mt-2 text-[0.65rem] text-muted-foreground/70 text-center flex items-center justify-center gap-1.5">
        <Sparkles className="h-3 w-3 text-gold-deep" />
        الوكيل ينفّذ أدوات حقيقية (رصيد، فواتير، دفع، تحويل) — أي عملية دفع تتطلب PIN.
        <Zap className="h-3 w-3 text-gold-deep" />
      </p>
    </div>
  );
}
