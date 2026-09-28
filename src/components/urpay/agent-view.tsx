"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check, CheckCircle2, Copy, Download, Eraser, Loader2, Mic, SendHorizonal,
  Sparkles, Square, Wrench, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToastAction } from "@/components/ui/toast";
import { useSession } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { urpay, type AgentAction, type AgentMessage } from "@/lib/urpay";
import { copyToClipboard } from "@/lib/clipboard";
import { useToast } from "@/hooks/use-toast";
import { UrPayMark } from "./logo";
import { ReceiptCard } from "./parts";

type ChatMsg = AgentMessage & { actions?: AgentAction[] };
type Step = { tool: string; label: string };

/* ------------------------------------------------------------------ */
/* Voice recording — MediaRecorder + upload → ASR text in the input.   */
/* ------------------------------------------------------------------ */

type VoiceState = "idle" | "recording" | "uploading" | "done";

function pickAudioMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const mime of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return undefined;
}

/* Map a getUserMedia failure to the clearest possible message key. */
function micErrorKey(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return "agent.voice.noMic";
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return "agent.voice.busy";
  }
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "agent.voice.micBlocked";
  }
  return "agent.voice.denied";
}

const inIframe = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

function useVoiceRecorder(
  token: string | null,
  onText: (text: string) => void,
) {
  const { t } = useT();
  const { toast } = useToast();
  const [state, setState] = useState<VoiceState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [micDenied, setMicDenied] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => stopTimer(), [stopTimer]);

  const upload = useCallback(async (blob: Blob) => {
    if (!token || blob.size < 1200) {
      setState("idle");
      toast({ title: t("agent.voice.failTitle"), description: t("agent.voice.tooShort"), variant: "destructive" });
      return;
    }
    setState("uploading");
    try {
      const text = await urpay.agentVoice(token, blob);
      if (cancelledRef.current) return;
      if (text) {
        onText(text);
        setState("done");
        toast({ title: t("agent.voice.done"), description: text.slice(0, 80) });
        setTimeout(() => setState("idle"), 1600);
      } else {
        setState("idle");
        toast({ title: t("agent.voice.failTitle"), description: t("agent.voice.tooShort"), variant: "destructive" });
      }
    } catch (err) {
      if (cancelledRef.current) return;
      setState("idle");
      toast({
        title: t("agent.voice.failTitle"),
        description: err instanceof Error ? err.message : t("common.tryAgain"),
        variant: "destructive",
      });
    }
  }, [token, onText, t, toast]);

  const start = useCallback(async () => {
    if (state !== "idle" || !token) return;
    cancelledRef.current = false;
    /* secure-context / API availability checks first */
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicDenied(true);
      toast({ title: t("agent.voice.failTitle"), description: t("agent.voice.insecure"), variant: "destructive" });
      return;
    }
    const mime = pickAudioMime();
    if (!mime) {
      setMicDenied(true);
      toast({ title: t("agent.voice.failTitle"), description: t("agent.voice.noRecorder"), variant: "destructive" });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        void upload(blob);
      };
      recorderRef.current = rec;
      setSeconds(0);
      setMicDenied(false);
      setState("recording");
      rec.start(250);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (err) {
      /* precise diagnostics: no mic / busy / blocked (+ iframe hint) */
      setMicDenied(true);
      const key = micErrorKey(err);
      const needsNewTab = key === "agent.voice.micBlocked" || (key === "agent.voice.denied" && inIframe());
      toast({
        title: t("agent.voice.failTitle"),
        description: t(key),
        variant: "destructive",
        ...(needsNewTab
          ? {
              action: (
                <ToastAction
                  altText={t("agent.voice.openNewTab")}
                  onClick={() => window.open("/", "_blank", "noopener")}
                >
                  {t("agent.voice.openNewTab")}
                </ToastAction>
              ),
            }
          : {}),
      });
    }
  }, [state, token, upload, t, toast]);

  const stop = useCallback(() => {
    stopTimer();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    recorderRef.current = null;
  }, [stopTimer]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    stopTimer();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.stop();
    }
    recorderRef.current = null;
    setState("idle");
  }, [stopTimer]);

  return { state, seconds, micDenied, start, stop, cancel };
}

/* suggestion chips are Arabic demo phrases (example chat input) — kept as-is in both languages */
const SUGGESTIONS = [
  "شكد رصيدي؟",
  "فواتيري",
  "ادفع فاتورة الكهرباء",
  "سوّي لي هدف حج بمليون",
  "ميزانية الكهرباء 150 ألف",
  "سجل معاملاتي",
];

/* provider badge labels — "local" is resolved via t("agent.providerLocal") */
const PROVIDER_LABEL: Record<string, string> = {
  groq: "وكيل Ur الذكي",
  zai: "وكيل Ur الذكي",
};

/* mask PIN-like digit runs in the user's own live echo (server already masks
   stored history — this keeps the on-screen bubble consistent + shoulder-surf
   safe). Mirrors the backend PIN_MASK_RE behavior. */
const PIN_ECHO_RE = /\b(?:pin|بصورة|رمز)?\s*[:=]?\s*(\d{6})\b/gi;
function maskPin(text: string): string {
  return text.replace(PIN_ECHO_RE, (m, digits: string, offset: number) => {
    /* don't mask 16-digit card numbers or amounts attached to الف/ألف */
    const before = text.slice(Math.max(0, offset - 2), offset);
    if (/\d/.test(before) || m.replace(/\D/g, "").length >= 8) return m;
    return m.replace(digits, "•".repeat(digits.length));
  });
}

export function AgentView() {
  const { token, setUser, user } = useSession();
  const { t, lang } = useT();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [provider, setProvider] = useState<string>("");
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  /* live streaming state */
  const [steps, setSteps] = useState<Step[]>([]);
  const [streamText, setStreamText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  /* voice — appends transcribed text into the input (user reviews then sends) */
  const voice = useVoiceRecorder(token, (text) => {
    setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
  });

  const providerName = (p: string) =>
    p === "local" ? t("agent.providerLocal") : PROVIDER_LABEL[p] ?? p;

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

  /* auto-scroll — follows streamed tokens too */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, steps, streamText]);

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if (!message || sending || !token) return;
    setInput("");
    setSending(true);
    setSteps([]);
    setStreamText("");
    setMessages((ms) => [...ms, { role: "user", content: maskPin(message) }]);
    try {
      /* SSE streaming path — tool steps + word-by-word reply */
      const res = await urpay.agentChatStream(token, message, {
        onStep: (s) => setSteps((prev) => [...prev, s]),
        onToken: (t) => setStreamText((prev) => prev + t),
      });
      setProvider(res.provider);
      setMessages((ms) => [
        ...ms,
        {
          role: "assistant",
          content: res.reply,
          actions: res.actions,
          provider: res.provider,
        },
      ]);
      // refresh balance after possible payment
      const me = await urpay.me(token).catch(() => null);
      if (me) setUser(me);
    } catch {
      /* graceful fallback — legacy non-streaming endpoint */
      try {
        const res = await urpay.agentChat(token, message);
        setProvider(res.provider);
        setMessages((ms) => [
          ...ms,
          { role: "assistant", content: res.reply, actions: res.actions, provider: res.provider },
        ]);
        const me = await urpay.me(token).catch(() => null);
        if (me) setUser(me);
      } catch (err) {
        setMessages((ms) => [
          ...ms,
          {
            role: "assistant",
            content: t("agent.error.connection", {
              msg: err instanceof Error ? err.message : t("agent.error.retry"),
            }),
          },
        ]);
      }
    } finally {
      setSending(false);
      setSteps([]);
      setStreamText("");
    }
  }

  async function clearChat() {
    if (!token) return;
    await urpay.agentClear(token).catch(() => null);
    setMessages([]);
  }

  function buildTranscript(): string {
    return (
      messages
        .map((m) =>
          m.role === "user"
            ? `🙋 ${m.content}`
            : `${t("agent.transcript.assistant", { content: m.content })}${m.actions?.length ? `\n${m.actions.map((a) => `↳ ${a.tool}: ${a.ok ? "✅" : "❌"}`).join("\n")}` : ""}`,
        )
        .join("\n\n") +
      `\n\n${t("agent.transcript.footer", {
        date: new Date().toLocaleDateString(lang === "en" ? "en-GB" : "ar-IQ-u-nu-latn"),
      })}`
    );
  }

  async function copyConversation() {
    if (messages.length === 0) return;
    const ok = await copyToClipboard(buildTranscript());
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  function downloadConversation() {
    if (messages.length === 0) return;
    const blob = new Blob([`\ufeff${buildTranscript()}`], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "urpay-chat.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const streaming = sending && (steps.length > 0 || streamText.length > 0);

  return (
    <div className="flex flex-col h-[calc(100vh-12.5rem)] lg:h-[calc(100vh-10rem)]">
      {/* header */}
      <div className="flex items-center justify-between gap-3 pb-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="relative shrink-0">
            <UrPayMark className="h-12 w-12" />
            <span className="absolute -bottom-0.5 -end-0.5 h-3.5 w-3.5 rounded-full bg-[#3ED9A3] ring-2 ring-background animate-pulse-dot" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-xl leading-tight">{t("agent.title")}</h1>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
              {provider ? providerName(provider) : t("agent.online")}
              {user && (
                <>
                  <span className="text-border">|</span>
                  <span className="num">{t("agent.yourBalance", { n: user.balance.toLocaleString("en-US") })}</span>
                </>
              )}
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={copyConversation}
              className={`rounded-xl font-semibold h-8 px-2.5 ${copied ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground hover:text-primary"}`}
              aria-label={t("agent.copyAria")}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              <span className="hidden sm:inline text-xs">{copied ? t("agent.copied") : t("agent.copy")}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={downloadConversation}
              className="rounded-xl text-muted-foreground hover:text-primary font-semibold"
              aria-label={t("agent.downloadAria")}
            >
              <Download className="h-4 w-4 rtl:-scale-x-100" />
              <span className="hidden sm:inline text-xs">{t("agent.download")}</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearChat}
              className="rounded-xl text-muted-foreground hover:text-destructive font-semibold"
            >
              <Eraser className="h-4 w-4" />
              {t("agent.newChat")}
            </Button>
          </div>
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
              {t("agent.welcomeTitle", { name: user?.first_name ?? t("agent.welcomeDefault") })}
            </p>
            <p className="mt-1.5 text-sm text-muted-foreground max-w-sm leading-relaxed">
              {t("agent.welcomeDesc")}
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
                    ⚡ {providerName(m.provider)}
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* live streaming bubble — tool steps + word-by-word reply */}
        {streaming && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex justify-end"
          >
            <div className="max-w-[88%] sm:max-w-[76%] space-y-2.5 items-end">
              {steps.length > 0 && (
                <div className="flex flex-wrap gap-1.5 justify-end">
                  {steps.map((s, i) => (
                    <motion.span
                      key={i}
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[.07] px-2.5 py-1 text-[0.66rem] font-semibold text-primary"
                    >
                      {i === steps.length - 1 && !streamText ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3 w-3" />
                      )}
                      {s.label}
                    </motion.span>
                  ))}
                </div>
              )}
              {streamText && (
                <div className="rounded-2xl rounded-br-md bg-card border border-border/60 shadow-sm px-4 py-3 text-[0.88rem] leading-relaxed whitespace-pre-line">
                  {streamText}
                  <span className="inline-block w-1.5 h-4 align-[-3px] ms-0.5 rounded-[2px] bg-primary/70 animate-pulse-dot" aria-hidden="true" />
                </div>
              )}
              {!streamText && steps.length === 0 && (
                <div className="bg-card border border-border/60 rounded-2xl rounded-br-md px-4 py-3.5 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-pulse-dot" />
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-pulse-dot" style={{ animationDelay: "0.2s" }} />
                  <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-pulse-dot" style={{ animationDelay: "0.4s" }} />
                  <span className="text-[0.68rem] text-muted-foreground ms-1">{t("agent.thinking")}</span>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* waiting (no steps/tokens yet) */}
        {sending && !streaming && (
          <div className="flex justify-end">
            <div className="bg-card border border-border/60 rounded-2xl rounded-br-md px-4 py-3.5 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-pulse-dot" />
              <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-pulse-dot" style={{ animationDelay: "0.2s" }} />
              <span className="h-2 w-2 rounded-full bg-muted-foreground/50 animate-pulse-dot" style={{ animationDelay: "0.4s" }} />
              <span className="text-[0.68rem] text-muted-foreground ms-1">{t("agent.thinking")}</span>
            </div>
          </div>
        )}
      </div>

      {/* input + voice */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className={`mt-4 rounded-2xl border bg-card p-2 pe-2.5 shadow-lift transition-colors ${
          voice.state === "recording"
            ? "border-destructive/50 ring-1 ring-destructive/25"
            : "border-border/70"
        }`}
      >
        {voice.state === "recording" ? (
          <div className="flex items-center gap-3 px-2 py-1.5">
            {/* recording bar — pulse dot + timer + live bars + stop */}
            <span className="relative flex h-3 w-3 shrink-0" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/60" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-destructive" />
            </span>
            <span className="text-xs font-bold text-destructive shrink-0">
              {t("agent.voice.recording")}
            </span>
            {/* live waveform bars */}
            <span className="flex items-end gap-1 h-6 shrink-0 mx-1" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <span
                  key={i}
                  className="voice-bar w-1 rounded-full bg-destructive/75"
                  style={{ animationDelay: `${i * 0.11}s` }}
                />
              ))}
            </span>
            <span className="num text-xs font-bold text-muted-foreground shrink-0" dir="ltr">
              0:{String(voice.seconds).padStart(2, "0")}
            </span>
            <div className="flex-1" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={voice.cancel}
              className="rounded-xl h-9 px-3 text-xs font-bold text-muted-foreground hover:text-foreground shrink-0"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={voice.stop}
              className="rounded-xl h-9 px-4 text-xs font-bold shrink-0"
              aria-label={t("agent.voice.stop")}
            >
              <Square className="h-3.5 w-3.5 fill-current" />
              {t("agent.voice.stop")}
            </Button>
          </div>
        ) : voice.state === "uploading" ? (
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
            <span className="text-sm text-muted-foreground">{t("agent.voice.uploading")}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("agent.placeholder")}
              className="flex-1 bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground/60"
              disabled={sending}
              maxLength={500}
              aria-label={t("agent.inputAria")}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={voice.start}
              disabled={sending || voice.state !== "idle"}
              aria-label={voice.micDenied ? t("agent.voice.denied") : t("agent.voice.record")}
              title={voice.micDenied ? t("agent.voice.denied") : t("agent.voice.record")}
              className={`rounded-xl h-10 w-10 shrink-0 transition-colors ${
                voice.state === "done"
                  ? "text-primary"
                  : voice.micDenied
                    ? "text-muted-foreground/40"
                    : "text-muted-foreground hover:text-primary hover:bg-primary/10"
              }`}
            >
              {voice.state === "done" ? (
                <Check className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || sending}
              className="rounded-xl h-10 w-10 shrink-0"
              aria-label={t("agent.send")}
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SendHorizonal className="h-4 w-4 rtl:-scale-x-100" />
              )}
            </Button>
          </div>
        )}
      </form>
      <p className="mt-2 text-[0.65rem] text-muted-foreground/70 text-center flex items-center justify-center gap-1.5">
        <Sparkles className="h-3 w-3 text-gold-deep" />
        {t("agent.disclaimer")}
        <Zap className="h-3 w-3 text-gold-deep" />
      </p>
    </div>
  );
}
