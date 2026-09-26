"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, Building2, CalendarDays, CreditCard, Fingerprint, KeyRound,
  Loader2, Lock, MapPin, ShieldCheck, User as UserIcon,
} from "lucide-react";
import { UrPayLogo, UrSeal } from "./logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSession, useUi } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { urpay, type User } from "@/lib/urpay";
import { useToast } from "@/hooks/use-toast";

const IRAQ_CITIES = [
  "بغداد", "البصرة", "الموصل", "أربيل", "النجف", "كربلاء", "السليمانية",
  "كركوك", "بابل", "ذي قار", "الأنبار", "ديالى", "واسط", "ميسان",
  "المثنى", "صلاح الدين", "دهوك", "حلبجة",
];

export function AuthView({
  onBack,
  demoCard,
}: {
  onBack: () => void;
  demoCard?: { card_number: string; pin: string } | null;
}) {
  const { authTab, setAuthTab } = useUi();
  const { t } = useT();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="absolute inset-0 pattern-ur opacity-60 pointer-events-none" aria-hidden="true" />
      <header className="relative z-10 mx-auto w-full max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowRight className="h-4 w-4" />
          {t("auth.back.home")}
        </button>
        <UrPayLogo compact />
      </header>

      <main className="relative z-10 flex-1 grid lg:grid-cols-2 items-stretch">
        {/* left brand panel */}
        <aside className="hidden lg:flex relative overflow-hidden bg-night text-[#F4F1E8] p-12 flex-col justify-between grain">
          <div className="absolute inset-0 pattern-ur-dark" aria-hidden="true" />
          <div
            className="absolute -bottom-32 -start-32 h-96 w-96 rounded-full blur-3xl"
            style={{ background: "radial-gradient(closest-side, rgba(62,217,163,.2), transparent)" }}
            aria-hidden="true"
          />
          <div className="relative">
            <UrPayLogo dark />
            <h2 className="font-display mt-10 text-4xl leading-[1.2] max-w-md">
              {t("auth.welcome.headline")}
              <br />
              <span className="text-gold-gradient">{t("auth.welcome.headlineGold")}</span>
            </h2>
            <p className="mt-4 text-white/65 leading-relaxed max-w-sm">
              {t("auth.welcome.desc")}
            </p>
          </div>
          <div className="relative space-y-4">
            {[
              { icon: ShieldCheck, key: "auth.welcome.benefit1" },
              { icon: KeyRound, key: "auth.welcome.benefit2" },
              { icon: Fingerprint, key: "auth.welcome.benefit3" },
            ].map((r) => (
              <div key={r.key} className="flex items-center gap-3 text-sm text-white/75">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 ring-1 ring-white/15">
                  <r.icon className="h-4 w-4 text-[#E8C867]" />
                </span>
                {t(r.key)}
              </div>
            ))}
            <UrSeal className="h-3 w-36 text-[#E8C867]/60 mt-6" />
          </div>
        </aside>

        {/* form panel */}
        <section className="flex items-center justify-center p-4 sm:p-8">
          <div className="w-full max-w-md">
            <div className="rounded-3xl border border-border/70 bg-card p-6 sm:p-8 shadow-lift-lg">
              <div className="grid grid-cols-2 gap-1 rounded-2xl bg-secondary p-1 mb-6">
                {(
                  [
                    { k: "login", labelKey: "auth.login.tab" },
                    { k: "register", labelKey: "auth.register.tab" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.k}
                    onClick={() => setAuthTab(tab.k)}
                    className={`rounded-xl py-2.5 text-sm font-bold transition-all ${
                      authTab === tab.k
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t(tab.labelKey)}
                  </button>
                ))}
              </div>

              {authTab === "login" ? (
                <LoginForm demoCard={demoCard} />
              ) : (
                <RegisterForm />
              )}
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground leading-relaxed">
                {t("auth.common.disclaimer")}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function LoginForm({ demoCard }: { demoCard?: { card_number: string; pin: string } | null }) {
  const { setSession } = useSession();
  const { toast } = useToast();
  const { t } = useT();
  const [card, setCard] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await urpay.login(card.replace(/\D/g, ""), pin);
      setSession(res.access_token, res.user);
      toast({
        title: t("auth.login.toastTitle", { name: res.user.first_name }),
        description: t("auth.login.toastDesc"),
      });
    } catch (err) {
      toast({
        title: t("auth.errors.loginFailed"),
        description: err instanceof Error ? err.message : t("auth.errors.retry"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t("auth.labels.card")} icon={CreditCard}>
        <Input
          dir="ltr"
          inputMode="numeric"
          placeholder="4539 1234 1234 1234"
          value={card}
          onChange={(e) =>
            setCard(
              e.target.value
                .replace(/\D/g, "")
                .slice(0, 16)
                .replace(/(\d{4})(?=\d)/g, "$1 "),
            )
          }
          className="num text-left tracking-[0.08em]"
          required
        />
      </Field>
      <Field label={t("auth.labels.pin")} icon={KeyRound}>
        <Input
          dir="ltr"
          inputMode="numeric"
          type="password"
          placeholder="••••••"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="num text-left tracking-[0.3em]"
          required
        />
      </Field>

      {demoCard && (
        <button
          type="button"
          onClick={() => {
            setCard(demoCard.card_number.replace(/(\d{4})(?=\d)/g, "$1 "));
            setPin(demoCard.pin);
          }}
          className="w-full rounded-xl border border-dashed border-primary/40 bg-primary/[.05] px-4 py-2.5 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
        >
          {t("auth.login.demoFill", { last4: demoCard.card_number.slice(-4) })}
        </button>
      )}

      <Button type="submit" disabled={loading} className="w-full h-12 rounded-2xl font-bold text-base shadow-lift">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Lock className="h-4 w-4" />}
        {t("auth.login.submit")}
      </Button>
    </form>
  );
}

function RegisterForm() {
  const { setSession } = useSession();
  const { toast } = useToast();
  const { t } = useT();
  const [form, setForm] = useState({
    first_name: "",
    father_name: "",
    family_name: "",
    age: "",
    city: "",
    phone: "",
    card_number: "",
    pin: "",
    pin2: "",
  });
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const pinMatch = form.pin.length === 6 && form.pin === form.pin2;
  const valid = useMemo(
    () =>
      form.first_name.trim().length >= 2 &&
      form.father_name.trim().length >= 2 &&
      form.family_name.trim().length >= 2 &&
      Number(form.age) >= 18 &&
      form.city &&
      form.card_number.replace(/\D/g, "").length === 16 &&
      pinMatch,
    [form, pinMatch],
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    try {
      const res = await urpay.register({
        first_name: form.first_name.trim(),
        father_name: form.father_name.trim(),
        family_name: form.family_name.trim(),
        age: Number(form.age),
        city: form.city,
        phone: form.phone.trim() || undefined,
        card_number: form.card_number.replace(/\D/g, ""),
        pin: form.pin,
      });
      setSession(res.access_token, res.user);
      toast({
        title: t("auth.register.toastTitle", { name: res.user.first_name }),
        description: t("auth.register.toastDesc"),
      });
    } catch (err) {
      toast({
        title: t("auth.errors.registerFailed"),
        description: err instanceof Error ? err.message : t("auth.errors.retry"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-xl bg-secondary/70 border border-border/60 px-4 py-3 flex items-center gap-2.5">
        <UserIcon className="h-4 w-4 text-primary shrink-0" />
        <p className="text-xs text-muted-foreground">
          {t("auth.register.nameHint")} <b className="text-foreground">{t("auth.register.nameParts")}</b>
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <Field label={t("auth.labels.firstName")}>
          <Input
            placeholder={t("auth.placeholders.firstName")}
            value={form.first_name}
            onChange={(e) => set("first_name")(e.target.value)}
            required
          />
        </Field>
        <Field label={t("auth.labels.fatherName")}>
          <Input
            placeholder={t("auth.placeholders.fatherName")}
            value={form.father_name}
            onChange={(e) => set("father_name")(e.target.value)}
            required
          />
        </Field>
        <Field label={t("auth.labels.familyName")}>
          <Input
            placeholder={t("auth.placeholders.familyName")}
            value={form.family_name}
            onChange={(e) => set("family_name")(e.target.value)}
            required
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("auth.labels.age")} icon={CalendarDays}>
          <Input
            dir="ltr"
            inputMode="numeric"
            type="number"
            min={18}
            max={100}
            placeholder="27"
            value={form.age}
            onChange={(e) => set("age")(e.target.value)}
            className="num text-left"
            required
          />
        </Field>
        <Field label={t("auth.labels.city")} icon={MapPin}>
          <Select value={form.city} onValueChange={set("city")}>
            <SelectTrigger className="w-full bg-background">
              <SelectValue placeholder={t("auth.placeholders.city")} />
            </SelectTrigger>
            <SelectContent>
              {IRAQ_CITIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label={t("auth.labels.phone")} icon={Building2}>
        <Input
          dir="ltr"
          inputMode="tel"
          placeholder="0770 123 4567"
          value={form.phone}
          onChange={(e) => set("phone")(e.target.value.replace(/[^\d+]/g, "").slice(0, 14))}
          className="num text-left"
        />
      </Field>

      <Field label={t("auth.labels.card16")} icon={CreditCard}>
        <Input
          dir="ltr"
          inputMode="numeric"
          placeholder="4539 .... .... ...."
          value={form.card_number}
          onChange={(e) =>
            set("card_number")(
              e.target.value
                .replace(/\D/g, "")
                .slice(0, 16)
                .replace(/(\d{4})(?=\d)/g, "$1 "),
            )
          }
          className="num text-left tracking-[0.08em]"
          required
        />
      </Field>

      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t("auth.labels.pinChoose")} icon={KeyRound}>
          <Input
            dir="ltr"
            inputMode="numeric"
            type="password"
            placeholder="••••••"
            value={form.pin}
            onChange={(e) => set("pin")(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className="num text-left tracking-[0.3em]"
            required
          />
        </Field>
        <Field label={t("auth.labels.pinConfirm")} icon={ShieldCheck}>
          <Input
            dir="ltr"
            inputMode="numeric"
            type="password"
            placeholder="••••••"
            value={form.pin2}
            onChange={(e) => set("pin2")(e.target.value.replace(/\D/g, "").slice(0, 6))}
            className={`num text-left tracking-[0.3em] ${
              form.pin2 && !pinMatch ? "border-destructive/60 focus-visible:ring-destructive/40" : ""
            }`}
            required
          />
        </Field>
      </div>

      <div className="rounded-xl border border-gold/40 bg-gold/[.07] px-4 py-3 flex gap-2.5">
        <Fingerprint className="h-4 w-4 text-gold-deep shrink-0 mt-0.5" />
        <p className="text-xs leading-relaxed text-gold-deep">
          <b>{t("auth.register.pinNoteLabel")}</b> {t("auth.register.pinNoteLead")} <b>{t("auth.register.pinNoteEvery")}</b> {t("auth.register.pinNoteTail")}
        </p>
      </div>

      <Button
        type="submit"
        disabled={loading || !valid}
        className="w-full h-12 rounded-2xl font-bold text-base shadow-lift"
      >
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-4 w-4" />}
        {t("auth.register.submit")}
      </Button>
    </form>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </Label>
      {children}
    </div>
  );
}
