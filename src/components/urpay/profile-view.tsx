"use client";

import {
  BadgeCheck, CalendarDays, CreditCard, Fingerprint, Landmark, LogOut, MapPin,
  Phone, ShieldCheck, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/store";
import { fmtDate, fmtIQD } from "@/lib/urpay";
import { useToast } from "@/hooks/use-toast";
import { UserAvatar } from "./parts";
import { UrSeal } from "./logo";
import type { DashTab } from "./dashboard";

export function ProfileView({ setTab }: { setTab: (t: DashTab) => void }) {
  const { user, logout } = useSession();
  const { toast } = useToast();
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
    </div>
  );
}
