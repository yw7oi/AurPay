"use client";

import { useState } from "react";
import {
  BadgeCheck, CalendarDays, CreditCard, Fingerprint, KeyRound, Landmark,
  Loader2, LogOut, MapPin, Moon, Phone, ShieldCheck, Sun, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/store";
import { fmtDate, fmtIQD, urpay } from "@/lib/urpay";
import { useToast } from "@/hooks/use-toast";
import { UserAvatar } from "./parts";
import { UrSeal } from "./logo";
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
      toast({ title: "تم التغيير ✅", description: res.message });
      onOpenChange(false);
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحديث الرمز");
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
      <DialogContent className="max-w-sm rounded-3xl" dir="rtl">
        <DialogHeader className="text-center items-center space-y-0">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gold/15 text-gold-deep ring-1 ring-gold/30">
            <KeyRound className="h-7 w-7" />
          </span>
          <DialogTitle className="font-display text-xl mt-3">غيّر رمز الـ PIN</DialogTitle>
          <DialogDescription className="text-center leading-relaxed">
            أدخل رمزك الحالي للتأكيد — الرمز الجديد يُفعّل فورًا لكل العمليات.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3.5">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">
              الرمز الحالي
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
                الرمز الجديد
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
                تأكيد الرمز
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
              التأكيد ما يطابق الرمز الجديد
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
            حدّث الرمز
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
  const { theme, setTheme } = useTheme();
  const [pinOpen, setPinOpen] = useState(false);
  if (!user) return null;

  const rows: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; ltr?: boolean }[] = [
    { icon: User, label: "الاسم الثلاثي", value: user.full_name },
    { icon: CalendarDays, label: "العمر", value: `${user.age} سنة`, ltr: true },
    { icon: MapPin, label: "المحافظة (السكن)", value: `${user.city}${user.district ? ` — ${user.district}` : ""}` },
    { icon: Phone, label: "الهاتف", value: user.phone, ltr: true },
    { icon: CreditCard, label: "رقم البطاقة", value: user.card_number.replace(/(\d{4})(?=\d)/g, "$1 "), ltr: true },
    { icon: BadgeCheck, label: "عضو منذ", value: fmtDate(user.created_at) },
  ];

  return (
    <div className="space-y-5 max-w-2xl" dir="rtl">
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
                  حساب تجريبي
                </Badge>
              )}
            </div>
            <p className="text-white/60 text-sm mt-1">
              {user.city} · {user.age} سنة · بطاقة{" "}
              <span className="num" dir="ltr">
                •••• {user.card_number.slice(-4)}
              </span>
            </p>
            <p className="num mt-2 text-xl text-[#3ED9A3]" dir="rtl">
              {fmtIQD(user.balance)}
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
          <p className="mt-3 font-bold">غيّر رمز الـ PIN</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            رمز جديد لكل عمليات الدفع والتحويل — يتطلب الرمز الحالي.
          </p>
        </button>

        <div className="rounded-3xl border border-border/70 bg-card p-5">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-primary ring-1 ring-border/60">
            {theme === "dark" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
          </span>
          <p className="mt-3 font-bold">مظهر المحفظة</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            {theme === "dark" ? "الوضع الليلي مفعّل" : "الوضع النهاري مفعّل"} — بدّل حسب راحتك.
          </p>
          <div className="mt-3.5 flex gap-2">
            <Button
              size="sm"
              variant={theme === "light" ? "default" : "outline"}
              onClick={() => setTheme("light")}
              className="rounded-xl font-bold flex-1"
            >
              <Sun className="h-3.5 w-3.5" />
              نهاري
            </Button>
            <Button
              size="sm"
              variant={theme === "dark" ? "default" : "outline"}
              onClick={() => setTheme("dark")}
              className="rounded-xl font-bold flex-1"
            >
              <Moon className="h-3.5 w-3.5" />
              ليلي
            </Button>
          </div>
        </div>
      </section>

      {/* details */}
      <section className="rounded-3xl border border-border/70 bg-card p-5 sm:p-6">
        <h2 className="font-display text-lg mb-4">بيانات التسجيل</h2>
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
            أمان حسابك
          </p>
          <ul className="mt-3 space-y-2 text-xs text-muted-foreground leading-relaxed">
            <li className="flex gap-2">
              <Fingerprint className="h-3.5 w-3.5 text-gold-deep shrink-0 mt-0.5" />
              الـ PIN مخزّن PBKDF2-SHA256 مع ملح فردي — الدفع يتطلبه دائمًا.
            </li>
            <li className="flex gap-2">
              <Landmark className="h-3.5 w-3.5 text-gold-deep shrink-0 mt-0.5" />
              جلساتك موقّعة JWT وتنتهي تلقائيًا بعد ٧ أيام.
            </li>
          </ul>
        </div>
        <div className="rounded-3xl border border-border/70 bg-card p-5">
          <p className="font-bold text-sm">تقنية المنصة</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="outline" className="rounded-lg font-semibold">FastAPI · SQLite</Badge>
            <Badge variant="outline" className="rounded-lg font-semibold">Groq gpt-oss-120b</Badge>
            <Badge variant="outline" className="rounded-lg font-semibold">Next.js 16</Badge>
            <Badge variant="outline" className="rounded-lg font-semibold">Inter Tight + Plex Arabic</Badge>
          </div>
          <p className="mt-3 text-[0.68rem] text-muted-foreground/80 leading-relaxed">
            نسخة هاكاثون — البيانات تجريبية بالكامل ولا تمثل أموالًا حقيقية.
          </p>
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() => setTab("agent")}
          className="rounded-xl font-bold"
        >
          جرّب المساعد أور
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            logout();
            toast({ title: "تم تسجيل الخروج", description: "نشتاقلك! ترجع بأي وقت." });
          }}
          className="rounded-xl font-bold"
        >
          <LogOut className="h-4 w-4 rtl:-scale-x-100" />
          تسجيل الخروج
        </Button>
      </div>

      <ChangePinDialog open={pinOpen} onOpenChange={setPinOpen} />
    </div>
  );
}
