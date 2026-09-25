"use client";

import { useState } from "react";
import {
  BadgeCheck, CalendarDays, CreditCard, Fingerprint, KeyRound, Landmark,
  Loader2, LogOut, MapPin, Moon, Phone, QrCode, ShieldCheck, Sun, User, Languages,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { fmtDate, fmtIQD, urpay } from "@/lib/urpay";
import { useToast } from "@/hooks/use-toast";
import { UserAvatar } from "./parts";
import { UrSeal } from "./logo";
import { QrDialog } from "./qr-card";
import { useTheme } from "./theme-toggle";
import type { DashTab } from "./dashboard";

/* ------------------------------------------------------------------ */
/* Change PIN dialog — verifies current PIN before updating.           */
/* ------------------------------------------------------------------ */

function ChangePinDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { token } = useSession();
  const { toast } = useToast();
  const { t, lang, setLang } = useT();
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    /^\d{4,6}$/.test(currentPin) &&
    /^\d{4,6}$/.test(newPin) &&
    newPin === confirmPin;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || loading || !token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await urpay.changePin(token, currentPin, newPin);
      toast({ title: t("profile.pinChanged"), description: res.message });
      onOpenChange(false);
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("profile.pinUpdateFail"));
      setCurrentPin("");
    } finally {
      setLoading(false);
    }
  }

  /* reset on open */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader className="text-center items-center space-y-0">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gold/15 text-gold-deep ring-1 ring-gold/30">
            <KeyRound className="h-7 w-7" />
          </span>
          <DialogTitle className="font-display text-xl mt-3">{t("profile.changePin")}</DialogTitle>
          <DialogDescription className="text-center leading-relaxed">
            {t("profile.changePinDesc")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3.5">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">
              {t("profile.currentPin")}
            </Label>
            <Input
              dir="ltr"
              inputMode="numeric"
              type="password"
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••"
              className="num text-left tracking-[0.4em]"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">
                {t("profile.newPin")}
              </Label>
              <Input
                dir="ltr"
                inputMode="numeric"
                type="password"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••"
                className="num text-left tracking-[0.4em]"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">
                {t("profile.confirmPin")}
              </Label>
              <Input
                dir="ltr"
                inputMode="numeric"
                type="password"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="••••"
                className="num text-left tracking-[0.4em]"
              />
            </div>
          </div>

          {newPin && confirmPin && newPin !== confirmPin && (
            <p className="text-xs font-semibold text-destructive">
              {t("profile.pinMismatch")}
            </p>
          )}
          {error && (
            <p className="text-sm font-semibold text-destructive text-center">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={!valid || loading}
            className="w-full h-12 rounded-2xl font-bold text-base shadow-lift"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <KeyRound className="h-5 w-5" />}
            {t("profile.updatePin")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

export function ProfileView({ setTab }: { setTab: (t: DashTab) => void }) {
  const { user, logout } = useSession();
  const { toast } = useToast();
  const { t, lang, setLang } = useT();
  const { theme, setTheme } = useTheme();
  const [pinOpen, setPinOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  if (!user) return null;

  const rows: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; ltr?: boolean }[] = [
    { icon: User, label: t("profile.field.name"), value: user.full_name },
    { icon: CalendarDays, label: t("profile.field.age"), value: t("profile.yearsOld", { n: user.age }), ltr: true },
    { icon: MapPin, label: t("profile.field.city"), value: `${user.city}${user.district ? ` — ${user.district}` : ""}` },
    { icon: Phone, label: t("profile.field.phone"), value: user.phone, ltr: true },
    { icon: CreditCard, label: t("profile.field.card"), value: user.card_number.replace(/(\d{4})(?=\d)/g, "$1 "), ltr: true },
    { icon: BadgeCheck, label: t("profile.field.memberSince"), value: fmtDate(user.created_at, lang) },
  ];

  return (
    <div className="space-y-5 max-w-2xl">
      {/* identity card */}
      <section className="relative overflow-hidden rounded-3xl bg-night text-[#F4F1E8] p-6 sm:p-8 grain">
        <div className="absolute inset-0 pattern-ur-dark opacity-70" aria-hidden="true" />
        <div className="relative flex items-center gap-5">
          <UserAvatar name={user.full_name} hue={user.avatar_hue} size={72} className="ring-4 ring-white/10" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-2xl truncate">{user.full_name}</h1>
              {user.is_demo && (
                <Badge className="rounded-full bg-[#E8C867]/15 text-[#E8C867] border-[#E8C867]/30 hover:bg-[#E8C867]/15">
                  {t("profile.demoAccount")}
                </Badge>
              )}
            </div>
            <p className="text-white/60 text-sm mt-1">
              {user.city} · {t("profile.yearsOld", { n: user.age })} · {t("profile.cardShort")}{" "}
              <span className="num" dir="ltr">
                •••• {user.card_number.slice(-4)}
              </span>
            </p>
            <p className="num mt-2 text-xl text-[#3ED9A3]">
              {fmtIQD(user.balance, true, lang)}
            </p>
          </div>
        </div>
        <UrSeal className="relative h-3 w-40 text-[#E8C867]/70 mt-6" />
      </section>

      {/* quick actions */}
      <section className="grid sm:grid-cols-2 gap-4">
        <button
          onClick={() => setPinOpen(true)}
          className="group rounded-3xl border border-border/70 bg-card p-5 text-start transition-all hover:border-primary/40 hover:shadow-lift"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20 group-hover:scale-105 transition-transform">
            <KeyRound className="h-5 w-5" />
          </span>
          <p className="mt-3 font-bold">{t("profile.changePin")}</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            {t("profile.changePinCardDesc")}
          </p>
        </button>

        <div className="rounded-3xl border border-border/70 bg-card p-5">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-primary ring-1 ring-border/60">
            {theme === "dark" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </span>
          <p className="mt-3 font-bold">{t("profile.appearance")}</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            {theme === "dark" ? t("theme.darkOn") : t("theme.lightOn")}{t("profile.appearanceSuffix")}
          </p>
          <div className="mt-3.5 flex gap-2">
            <Button
              size="sm"
              variant={theme === "light" ? "default" : "outline"}
              onClick={() => setTheme("light")}
              className="rounded-xl font-bold flex-1"
            >
              <Sun className="h-3.5 w-3.5" />
              {t("profile.themeLight")}
            </Button>
            <Button
              size="sm"
              variant={theme === "dark" ? "default" : "outline"}
              onClick={() => setTheme("dark")}
              className="rounded-xl font-bold flex-1"
            >
              <Moon className="h-3.5 w-3.5" />
              {t("profile.themeDark")}
            </Button>
          </div>
          <div className="mt-2.5 flex gap-2">
            <Button
              size="sm"
              variant={lang === "ar" ? "default" : "outline"}
              onClick={() => setLang("ar")}
              className="rounded-xl font-bold flex-1"
            >
              <Languages className="h-3.5 w-3.5" />
              العربية
            </Button>
            <Button
              size="sm"
              variant={lang === "en" ? "default" : "outline"}
              onClick={() => setLang("en")}
              className="rounded-xl font-bold flex-1"
            >
              <Languages className="h-3.5 w-3.5" />
              English
            </Button>
          </div>
        </div>
      </section>

      {/* details */}
      <section className="rounded-3xl border border-border/70 bg-card p-5 sm:p-6">
        <h2 className="font-display text-lg mb-4">{t("profile.detailsTitle")}</h2>
        <dl className="divide-y divide-border/60">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-3.5 py-3.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-primary shrink-0">
                <r.icon className="h-4 w-4" />
              </span>
              <dt className="text-xs font-semibold text-muted-foreground w-36 shrink-0">{r.label}</dt>
              <dd
                className={`font-bold text-sm flex-1 min-w-0 truncate ${r.ltr ? "num tracking-wide" : ""}`}
                dir={r.ltr ? "ltr" : "rtl"}
                style={r.ltr ? { textAlign: "end" } : undefined}
              >
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* security + meta */}
      <section className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-3xl border border-gold/35 bg-gold/[.06] p-5">
          <p className="font-bold flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4 text-gold-deep" />
            {t("profile.securityTitle")}
          </p>
          <ul className="mt-3 space-y-2 text-xs text-muted-foreground leading-relaxed">
            <li className="flex gap-2">
              <Fingerprint className="h-3.5 w-3.5 text-gold-deep shrink-0 mt-0.5" />
              {t("profile.securityPin")}
            </li>
            <li className="flex gap-2">
              <Landmark className="h-3.5 w-3.5 text-gold-deep shrink-0 mt-0.5" />
              {t("profile.securityJwt")}
            </li>
          </ul>
        </div>
        <div className="rounded-3xl border border-border/70 bg-card p-5">
          <p className="font-bold text-sm">{t("profile.techTitle")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-lg font-semibold">FastAPI · SQLite</Badge>
            <Badge variant="outline" className="rounded-lg font-semibold">Groq gpt-oss-120b</Badge>
            <Badge variant="outline" className="rounded-lg font-semibold">Next.js 16</Badge>
            <Badge variant="outline" className="rounded-lg font-semibold">Inter Tight + Plex Arabic</Badge>
          </div>
          <p className="mt-3 text-[0.68rem] text-muted-foreground/80 leading-relaxed">
            {t("profile.hackathonNote")}
          </p>
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() => setQrOpen(true)}
          className="rounded-xl font-bold"
        >
          <QrCode className="h-4 w-4" />
          {t("profile.myQr")}
        </Button>
        <Button
          variant="outline"
          onClick={() => setTab("agent")}
          className="rounded-xl font-bold"
        >
          {t("profile.tryAgent")}
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            logout();
            toast({ title: t("shell.logoutDone"), description: t("shell.logoutBye") });
          }}
          className="rounded-xl font-bold"
        >
          <LogOut className="h-4 w-4 rtl:-scale-x-100" />
          {t("shell.logout")}
        </Button>
      </div>

      <ChangePinDialog open={pinOpen} onOpenChange={setPinOpen} />
      <QrDialog open={qrOpen} onOpenChange={setQrOpen} />
    </div>
  );
}
