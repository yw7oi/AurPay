"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, BadgeCheck, Banknote, CarFront, Check, CreditCard, Droplets,
  Fingerprint, GraduationCap, Landmark, Lock, MessageCircleHeart,
  ShieldCheck, Smartphone, Sparkles, Wifi, Zap,
} from "lucide-react";
import { UrPayLogo, UrPayMark, UrSeal } from "./logo";
import { CategoryIcon } from "./icons";
import { ThemeToggle } from "./theme-toggle";
import { LangToggle } from "./lang-toggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { categoryName, type PlatformStats } from "@/lib/urpay";
import { useT } from "@/lib/i18n";

/* ------------------------------------------------------------------ */

const NAV = [
  { href: "#features", labelKey: "landing.nav.features" },
  { href: "#categories", labelKey: "landing.nav.categories" },
  { href: "#agent", labelKey: "landing.nav.agent" },
  { href: "#security", labelKey: "landing.nav.security" },
];

export function Landing({ onEnter, onDemo }: { onEnter: () => void; onDemo: () => void }) {
  const { t, lang } = useT();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => setStats(null));
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background overflow-x-clip">
      {/* ============================== NAV ============================== */}
      <header
        className={`sticky top-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-background/90 backdrop-blur-xl border-b border-border/70 shadow-[0_8px_30px_-18px_rgba(27,33,30,.25)] dark:shadow-[0_8px_30px_-18px_rgba(0,0,0,.6)]"
            : "bg-transparent"
        }`}
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 sm:h-[4.5rem] flex items-center justify-between gap-4">
          <UrPayLogo />
          <nav className="hidden md:flex items-center gap-1" aria-label={t("landing.nav.aria")}>
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                className="px-3.5 py-2 rounded-full text-[0.9rem] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                {t(n.labelKey)}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <div className="flex items-center sm:hidden">
              <LangToggle compact className="me-1" />
              <ThemeToggle compact className="me-1" />
            </div>
            <div className="hidden sm:flex items-center">
              <LangToggle compact className="me-1" />
              <ThemeToggle className="me-1" />
            </div>
            <Button
              onClick={onEnter}
              variant="outline"
              className="hidden sm:inline-flex rounded-full border-border/80 font-semibold"
            >
              {t("landing.nav.login")}
            </Button>
            <Button
              onClick={onEnter}
              className="rounded-full font-semibold shadow-lift"
            >
              {t("landing.nav.openWallet")}
              <ArrowLeft className="ms-1 h-4 w-4 rtl:-scale-x-100" />
            </Button>
          </div>
        </div>
      </header>

      {/* ============================== HERO ============================= */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pattern-ur opacity-90" aria-hidden="true" />
        <div
          className="absolute -top-40 -start-40 h-[34rem] w-[34rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, rgba(17,138,99,.16), transparent)" }}
          aria-hidden="true"
        />
        <div
          className="absolute -bottom-56 -end-40 h-[30rem] w-[30rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, rgba(203,161,53,.14), transparent)" }}
          aria-hidden="true"
        />

        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 pt-10 pb-16 sm:pt-16 sm:pb-24 grid lg:grid-cols-[1.05fr_.95fr] gap-12 lg:gap-8 items-center">
          <div className="max-w-xl">
            <Badge
              variant="outline"
              className="mb-5 rounded-full border-gold/60 bg-gold/10 text-gold-deep px-3.5 py-1.5 gap-1.5 font-medium"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t("landing.hero.badge")}
            </Badge>

            <h1 className="font-display text-[2.6rem] leading-[1.08] sm:text-6xl text-ink">
              {t("landing.hero.title1")}
              <br />
              <span className="text-primary">{t("landing.hero.title2")}</span>
            </h1>

            <p className="mt-5 text-[1.05rem] sm:text-lg leading-relaxed text-muted-foreground max-w-lg">
              {t("landing.hero.desc1")}{" "}
              <b className="text-foreground">{t("landing.hero.descBold")}</b>{" "}
              {t("landing.hero.desc2")}
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button
                size="lg"
                onClick={onEnter}
                className="rounded-full h-12 px-7 text-base font-bold shadow-lift-lg"
              >
                <CreditCard className="me-2 h-5 w-5" />
                {t("landing.hero.ctaOpen")}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={onDemo}
                className="rounded-full h-12 px-6 text-base font-semibold border-border"
              >
                {t("landing.hero.ctaDemo")}
              </Button>
            </div>

            {stats?.demo && (
              <div
                className="mt-6 inline-flex items-center gap-2.5 rounded-2xl border border-dashed border-primary/35 bg-primary/[.06] px-4 py-2.5 text-sm"
              >
                <Fingerprint className="h-4 w-4 text-primary" />
                <span className="text-muted-foreground">{t("landing.hero.demoCard")}</span>
                <span className="num tracking-wide" dir="ltr">
                  {stats.demo.card_number.replace(/(\d{4})(?=\d)/g, "$1 ")}
                </span>
                <span className="text-muted-foreground">· PIN</span>
                <span className="num">123456</span>
              </div>
            )}
          </div>

          {/* phone demo */}
          <AgentPhoneDemo />
        </div>
      </section>

      {/* ============================ BILLERS ============================ */}
      <section className="border-y border-border/70 bg-secondary/40 py-5 overflow-hidden marquee-hover">
        <div className="relative flex" dir="ltr">
          <div className="animate-marquee flex shrink-0 items-center gap-3 pl-3">
            {[...BILLERS_ROW, ...BILLERS_ROW].map((b, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card px-4 py-2 text-sm font-semibold text-muted-foreground whitespace-nowrap"
              >
                <b.icon className="h-4 w-4 text-primary" />
                {b.name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ FEATURES =========================== */}
      <section id="features" className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-24 w-full">
        <SectionHead
          kicker={t("landing.features.kicker")}
          title={t("landing.features.title")}
          sub={t("landing.features.sub")}
        />
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <FeatureCard key={f.titleKey} icon={f.icon} title={t(f.titleKey)} desc={t(f.descKey)} />
          ))}
        </div>
      </section>

      {/* =========================== CATEGORIES ========================== */}
      <section id="categories" className="bg-card border-y border-border/70 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHead
            kicker={t("landing.categories.kicker")}
            title={t("landing.categories.title")}
            sub={t("landing.categories.sub")}
          />
          <div className="mt-10 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {CATEGORIES.map((c) => (
              <div
                key={c.key}
                className="group rounded-2xl border border-border/70 bg-background p-4 text-center transition-all hover:shadow-lift hover:-translate-y-0.5 hover:border-primary/40"
              >
                <div className="mx-auto w-fit transition-transform group-hover:scale-110">
                  <CategoryIcon category={c.key} />
                </div>
                <p className="mt-3 font-bold text-[0.95rem]">{categoryName(c.key, lang)}</p>
                <p className="mt-1 text-[0.72rem] leading-snug text-muted-foreground">{t(c.descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================= AGENT ============================= */}
      <section id="agent" className="relative py-16 sm:py-24 overflow-hidden bg-night text-[#F4F1E8]">
        <div className="absolute inset-0 pattern-ur-dark opacity-80" aria-hidden="true" />
        <div
          className="absolute -top-32 end-1/4 h-96 w-96 rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, rgba(62,217,163,.18), transparent)" }}
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-6xl px-4 sm:px-6 grid lg:grid-cols-[.9fr_1.1fr] gap-12 items-center">
          <div>
            <Badge className="rounded-full bg-[#3ED9A3]/15 text-[#3ED9A3] border-[#3ED9A3]/30 gap-1.5 px-3.5 py-1.5 font-medium hover:bg-[#3ED9A3]/15">
              <Zap className="h-3.5 w-3.5" />
              {t("landing.agent.badge")}
            </Badge>
            <h2 className="font-display mt-4 text-4xl sm:text-5xl leading-[1.12]">
              {t("landing.agent.title1")}{" "}
              <span className="text-[#E8C867]">{t("landing.agent.titleBold")}</span>{" "}
              {t("landing.agent.title2")}
            </h2>
            <p className="mt-4 text-white/70 leading-relaxed text-[1.02rem] max-w-md">
              {t("landing.agent.desc1")}{" "}
              <b className="text-white/90">{t("landing.agent.descBold")}</b>{" "}
              {t("landing.agent.desc2")}
            </p>
            <ol className="mt-8 space-y-4">
              {AGENT_STEPS.map((s, i) => (
                <li key={s.titleKey} className="flex gap-4">
                  <span className="font-display flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#3ED9A3]/15 text-[#3ED9A3] ring-1 ring-[#3ED9A3]/25 num">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-bold">{t(s.titleKey)}</p>
                    <p className="text-sm text-white/60 leading-relaxed">{t(s.descKey)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <AgentFlowCard />
        </div>
      </section>

      {/* ========================== HOW IT WORKS ========================= */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-24 w-full">
        <SectionHead
          kicker={t("landing.how.kicker")}
          title={t("landing.how.title")}
          sub={t("landing.how.sub")}
        />
        <div className="mt-10 grid md:grid-cols-2 gap-5 max-w-2xl">
          {STEPS.map((s, i) => (
            <div key={s.titleKey} className="relative rounded-2xl border border-border/70 bg-card p-6">
              <span className="font-display absolute -top-4 start-5 rounded-full bg-primary text-primary-foreground h-9 min-w-9 px-3 inline-flex items-center justify-center num shadow-lift">
                {i + 1}
              </span>
              <s.icon className="h-6 w-6 text-primary" />
              <p className="mt-3 font-bold text-lg">{t(s.titleKey)}</p>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{t(s.descKey)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* =========================== SECURITY =========================== */}
      <section id="security" className="bg-secondary/40 border-t border-border/70 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <SectionHead
            kicker={t("landing.security.kicker")}
            title={t("landing.security.title")}
            sub={t("landing.security.sub")}
          />
          <div className="mt-10 grid sm:grid-cols-3 gap-5">
            {SECURITY.map((s) => (
              <div key={s.titleKey} className="rounded-2xl bg-card border border-border/70 p-6">
                <s.icon className="h-6 w-6 text-gold-deep" />
                <p className="mt-3 font-bold">{t(s.titleKey)}</p>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{t(s.descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================== CTA ============================== */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-16 sm:pb-24 w-full">
        <div className="relative overflow-hidden rounded-[2rem] bg-night text-[#F4F1E8] p-8 sm:p-14 grain">
          <div className="absolute inset-0 pattern-ur-dark" aria-hidden="true" />
          <div
            className="absolute -bottom-24 -start-24 h-72 w-72 rounded-full blur-3xl"
            style={{ background: "radial-gradient(closest-side, rgba(203,161,53,.25), transparent)" }}
            aria-hidden="true"
          />
          <div className="relative max-w-2xl">
            <UrSeal className="h-3 w-40 text-[#E8C867]" />
            <h2 className="font-display mt-4 text-3xl sm:text-5xl leading-[1.15]">
              {t("landing.cta.title1")}{" "}
              <span className="text-gold-gradient">{t("landing.cta.title2")}</span>
            </h2>
            <p className="mt-4 text-white/70 leading-relaxed">
              {t("landing.cta.desc")}
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button
                size="lg"
                onClick={onEnter}
                className="rounded-full h-12 px-7 text-base font-bold bg-[#3ED9A3] text-[#0C2A21] hover:bg-[#5ce0b0] shadow-gold"
              >
                <CreditCard className="me-2 h-5 w-5" />
                {t("landing.cta.openWallet")}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={onDemo}
                className="rounded-full h-12 px-6 text-base font-semibold border-white/25 bg-white/5 text-white hover:bg-white/10 hover:text-white"
              >
                {t("landing.cta.demo")}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ============================= FOOTER ============================ */}
      <footer className="mt-auto border-t border-border/70 bg-card">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div>
              <UrPayLogo />
              <p className="mt-3 text-sm text-muted-foreground max-w-sm leading-relaxed">
                {t("landing.footer.about")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5" dir="ltr">
                Made in Iraq 🇮🇶
              </span>
            </div>
          </div>
          <div className="mt-8 border-t border-border/60 pt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground/80">
            <span>{t("landing.footer.copyright")}</span>
            <UrSeal className="h-2.5 w-28 text-primary/50" />
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SectionHead({ kicker, title, sub }: { kicker: string; title: string; sub: string }) {
  return (
    <div className="max-w-2xl">
      <p className="font-semibold text-primary text-sm tracking-wide">{kicker}</p>
      <h2 className="font-display mt-2 text-3xl sm:text-4xl leading-[1.18] text-ink">{title}</h2>
      <p className="mt-3 text-muted-foreground leading-relaxed">{sub}</p>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  desc,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
}) {
  return (
    <div className="group rounded-2xl border border-border/70 bg-card p-6 transition-all hover:shadow-lift hover:-translate-y-1 hover:border-primary/35">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15 transition-transform group-hover:scale-110">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-4 font-bold">{title}</p>
      <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

/* ------------------------- hero phone demo -------------------------- */

const CHAT_SCRIPT: { role: "user" | "assistant"; textKey: string; receipt?: boolean }[] = [
  { role: "user", textKey: "landing.hero.chat.q1" },
  { role: "assistant", textKey: "landing.hero.chat.a1" },
  { role: "user", textKey: "landing.hero.chat.q2" },
  {
    role: "assistant",
    textKey: "landing.hero.chat.a2",
  },
  { role: "user", textKey: "landing.hero.chat.q3" },
  {
    role: "assistant",
    textKey: "landing.hero.chat.a3",
    receipt: true,
  },
];

function AgentPhoneDemo() {
  const { t } = useT();
  const [step, setStep] = useState(0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = (step + 1) % (CHAT_SCRIPT.length + 2);
      setTyping(next <= CHAT_SCRIPT.length && CHAT_SCRIPT[next - 1]?.role === "assistant");
      setStep(next);
    }, step === 0 ? 1400 : 2600);
    return () => clearTimeout(timer);
  }, [step]);

  const visible = CHAT_SCRIPT.slice(0, Math.min(step, CHAT_SCRIPT.length));

  return (
    <div className="relative mx-auto w-full max-w-[340px]">
      {/* floating cards */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="absolute -top-6 -start-10 sm:-start-16 z-20 animate-float"
      >
        <div className="rounded-2xl border border-border/60 bg-card/95 backdrop-blur px-4 py-3 shadow-lift-lg">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/25">
              <Check className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-bold">{t("landing.hero.card1Title")}</p>
              <p className="num text-[0.7rem] text-muted-foreground">{t("landing.hero.card1Amount")}</p>
            </div>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1 }}
        className="absolute -bottom-8 -end-6 sm:-end-12 z-20 animate-float"
        style={{ animationDelay: "1.2s" }}
      >
        <div className="rounded-2xl border border-gold/40 bg-card/95 backdrop-blur px-4 py-3 shadow-lift-lg">
          <p className="text-[0.68rem] font-medium text-muted-foreground">{t("landing.hero.card2Label")}</p>
          <p className="num text-lg text-primary">{t("landing.hero.card2Value")}</p>
        </div>
      </motion.div>

      {/* phone */}
      <div className="relative rounded-[2.6rem] border border-black/10 bg-night p-2.5 shadow-lift-lg">
        <div className="rounded-[2.1rem] overflow-hidden bg-[#F4F1E8] h-[560px] flex flex-col">
          {/* status bar */}
          <div className="bg-night text-white/80 px-5 pt-3 pb-4 flex items-center justify-between text-[0.65rem]" dir="ltr">
            <span className="num">9:41</span>
            <span className="h-4 w-16 rounded-full bg-black/60 mx-auto" />
            <span className="flex gap-1 items-center">
              <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
              <span className="h-1.5 w-1.5 rounded-full bg-white/70" />
              <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
            </span>
          </div>
          {/* chat header */}
          <div className="bg-night px-4 pb-3.5 flex items-center gap-3">
            <UrPayMark className="h-9 w-9" />
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm truncate">{t("landing.hero.chatHeader")}</p>
              <p className="text-white/50 text-[0.68rem] flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#3ED9A3] animate-pulse-dot" />
                {t("landing.hero.chatStatus")}
              </p>
            </div>
            <MessageCircleHeart className="h-4 w-4 text-white/40" />
          </div>
          {/* messages */}
          <div className="flex-1 overflow-hidden px-3.5 py-4 space-y-2.5 scrollbar-slim">
            <AnimatePresence initial={false}>
              {visible.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.3 }}
                  className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}
                >
                  {m.receipt ? (
                    <div className="w-[85%] rounded-2xl border border-emerald-200 bg-card p-3 shadow-lift">
                      <div className="flex items-center justify-between">
                        <p className="text-[0.7rem] font-bold text-emerald-700">{t("landing.hero.receipt")}</p>
                        <Badge className="rounded-md bg-emerald-100 text-emerald-700 hover:bg-emerald-100 text-[0.6rem] px-1.5">
                          {t("landing.hero.paid")}
                        </Badge>
                      </div>
                      <p className="mt-1.5 text-[0.72rem] font-semibold leading-snug">
                        {t("landing.hero.receiptBiller")}
                      </p>
                      <p className="num mt-1 text-primary text-base">{t("landing.hero.receiptAmount")}</p>
                      <div className="mt-2 border-t border-dashed border-border pt-1.5 flex justify-between text-[0.62rem] text-muted-foreground">
                        <span dir="ltr">UR-8XK2F3</span>
                        <span>{t("landing.hero.receiptDate")}</span>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[0.78rem] leading-relaxed whitespace-pre-line ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground rounded-bl-md"
                          : "bg-card border border-border/60 shadow-sm rounded-br-md"
                      }`}
                    >
                      {t(m.textKey)}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            {typing && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-end">
                <div className="bg-card border border-border/60 rounded-2xl rounded-br-md px-4 py-3 flex gap-1.5">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-pulse-dot"
                      style={{ animationDelay: `${d * 0.2}s` }}
                    />
                  ))}
                </div>
              </motion.div>
            )}
          </div>
          {/* input */}
          <div className="px-3.5 pb-4">
            <div className="rounded-full border border-border/60 bg-card px-4 py-2.5 flex items-center gap-2">
              <span className="flex-1 text-[0.75rem] text-muted-foreground/70">
                {t("landing.hero.placeholder")}
              </span>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <ArrowLeft className="h-3.5 w-3.5 rtl:-scale-x-100" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------- agent flow card -------------------------- */

function AgentFlowCard() {
  const { t } = useT();
  return (
    <div className="rounded-[1.75rem] border border-white/10 bg-white/[.04] backdrop-blur p-5 sm:p-6">
      <p className="text-xs font-bold text-white/50 tracking-wide mb-4" dir="ltr">
        POST /api/agent/chat → tools
      </p>
      <div className="space-y-2.5 font-mono text-[0.72rem] leading-relaxed" dir="ltr">
        {[
          { c: "user", text: t("landing.agent.flow.user") },
          { c: "tool", text: "list_bills() → 1 unpaid (45,000 IQD)" },
          { c: "tool", text: "pay_bill(bill_id=4, pin=••••••)" },
          { c: "ok", text: "✓ receipt UR-YQ9KY3RK · balance 1,705,000" },
          { c: "agent", text: t("landing.agent.flow.agent") },
        ].map((l, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -14 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.14 }}
            className={`rounded-xl px-3.5 py-2.5 border ${
              l.c === "user"
                ? "bg-[#3ED9A3]/10 border-[#3ED9A3]/25 text-[#9be8c8]"
                : l.c === "tool"
                  ? "bg-white/[.05] border-white/10 text-white/75"
                  : l.c === "ok"
                    ? "bg-[#E8C867]/10 border-[#E8C867]/30 text-[#E8C867]"
                    : "bg-white/[.08] border-white/15 text-white"
            }`}
          >
            {l.text}
          </motion.div>
        ))}
      </div>
      <p className="mt-4 text-[0.7rem] text-white/45 leading-relaxed">
        {t("landing.agent.flow.hint")}
      </p>
    </div>
  );
}

/* ----------------------------- data -------------------------------- */

const BILLERS_ROW = [
  { name: "زين العراق", icon: Smartphone },
  { name: "وزارة الكهرباء", icon: Zap },
  { name: "كهرباء أربيل", icon: Zap },
  { name: "تارين", icon: Wifi },
  { name: "هلال نت", icon: Wifi },
  { name: "إيرثلينك", icon: Wifi },
  { name: "هيلي", icon: Wifi },
  { name: "نور سات", icon: Wifi },
  { name: "ماء بغداد", icon: Droplets },
  { name: "ماء البصرة", icon: Droplets },
  { name: "جامعة بغداد", icon: GraduationCap },
  { name: "جامعة الموصل", icon: GraduationCap },
  { name: "المرور العراقي", icon: CarFront },
  { name: "مرور البصرة", icon: CarFront },
];

const CATEGORIES = [
  { key: "electricity", descKey: "landing.categories.electricity.desc" },
  { key: "water", descKey: "landing.categories.water.desc" },
  { key: "internet", descKey: "landing.categories.internet.desc" },
  { key: "mobile", descKey: "landing.categories.mobile.desc" },
  { key: "education", descKey: "landing.categories.education.desc" },
  { key: "traffic", descKey: "landing.categories.traffic.desc" },
];

const FEATURES = [
  {
    icon: MessageCircleHeart,
    titleKey: "landing.features.f1.title",
    descKey: "landing.features.f1.desc",
  },
  {
    icon: ShieldCheck,
    titleKey: "landing.features.f2.title",
    descKey: "landing.features.f2.desc",
  },
  {
    icon: Banknote,
    titleKey: "landing.features.f3.title",
    descKey: "landing.features.f3.desc",
  },
  {
    icon: Landmark,
    titleKey: "landing.features.f4.title",
    descKey: "landing.features.f4.desc",
  },
  {
    icon: BadgeCheck,
    titleKey: "landing.features.f5.title",
    descKey: "landing.features.f5.desc",
  },
  {
    icon: Zap,
    titleKey: "landing.features.f6.title",
    descKey: "landing.features.f6.desc",
  },
];

const AGENT_STEPS = [
  { titleKey: "landing.agent.s1.title", descKey: "landing.agent.s1.desc" },
  { titleKey: "landing.agent.s2.title", descKey: "landing.agent.s2.desc" },
  { titleKey: "landing.agent.s3.title", descKey: "landing.agent.s3.desc" },
  { titleKey: "landing.agent.s4.title", descKey: "landing.agent.s4.desc" },
];

const STEPS = [
  {
    icon: Fingerprint,
    titleKey: "landing.how.s1.title",
    descKey: "landing.how.s1.desc",
  },
  {
    icon: Check,
    titleKey: "landing.how.s3.title",
    descKey: "landing.how.s3.desc",
  },
];

const SECURITY = [
  {
    icon: Lock,
    titleKey: "landing.security.s1.title",
    descKey: "landing.security.s1.desc",
  },
  {
    icon: ShieldCheck,
    titleKey: "landing.security.s2.title",
    descKey: "landing.security.s2.desc",
  },
  {
    icon: Fingerprint,
    titleKey: "landing.security.s3.title",
    descKey: "landing.security.s3.desc",
  },
];
