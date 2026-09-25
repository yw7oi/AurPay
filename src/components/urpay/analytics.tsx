"use client";

import { useEffect, useState } from "react";
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowDownLeft, ArrowUpRight, ChartPie, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/store";
import { urpay, fmtIQD, categoryName } from "@/lib/urpay";
import { tr, useT, type Lang } from "@/lib/i18n";
import { UserAvatar } from "./parts";

/* Mesopotamian palette — category → fill */
const CAT_COLORS: Record<string, string> = {
  electricity: "#D9A62E",
  water: "#3BA99C",
  internet: "#8E7CC3",
  mobile: "#D96C57",
  education: "#2E8B6A",
  traffic: "#C47F3D",
  health: "#C94F4F",
  gas: "#A8557A",
  transfer: "#5B7C99",
  wallet: "#9C8F7A",
  savings: "#3E8E7E",
  topup: "#7FA65A",
  other: "#B0A695",
};

/* Localized category label — "transfer" (plural) and "other" aren't in the
   shared CATEGORY maps, so they resolve through their own dict keys. */
function catLabel(cat: string, lang: Lang): string {
  if (cat === "transfer") return tr(lang, "analytics.catTransfer");
  if (cat === "other") return tr(lang, "analytics.catOther");
  return categoryName(cat, lang);
}

export type Analytics = {
  window_days: number;
  spend_total: number;
  categories: { category: string; total: number; count: number }[];
  months: { label: string; out: number; in: number }[];
  bills: { unpaid_count: number; unpaid_total: number; overdue_count: number };
  top_counterparties: { name: string; total: number; count: number; avatar_hue: number }[];
};

function IQDTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name?: string; value?: number; payload?: { fill?: string } }[];
  label?: string;
}) {
  const { lang } = useT();
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-lift">
      {label && <p className="text-xs font-bold mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="num text-xs flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full inline-block" style={{ background: p.payload?.fill ?? "var(--primary)" }} />
          {p.name}: <b>{fmtIQD(p.value ?? 0, true, lang)}</b>
        </p>
      ))}
    </div>
  );
}

export function AnalyticsCard({ refreshKey }: { refreshKey: number }) {
  const { token } = useSession();
  const { t, lang } = useT();
  const [data, setData] = useState<Analytics | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    urpay.analytics(token)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [token, refreshKey]);

  if (!data) return null;
  if (data.spend_total === 0 && data.bills.unpaid_count === 0) return null;

  const pie = data.categories.map((c) => ({
    name: catLabel(c.category, lang),
    value: c.total,
    fill: CAT_COLORS[c.category] ?? CAT_COLORS.other,
  }));
  const hasPie = pie.length > 0;

  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <ChartPie className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-lg leading-tight">{t("analytics.title")}</h2>
            <p className="text-[0.7rem] text-muted-foreground mt-0.5">
              {t("analytics.lastPrefix")} {data.window_days} {t("analytics.daysSpent")} <b className="num text-primary">{fmtIQD(data.spend_total, true, lang)}</b>
            </p>
          </div>
        </div>
        {data.bills.overdue_count > 0 && (
          <Badge variant="destructive" className="rounded-full font-semibold">
            {t("analytics.overdueBadge", { n: data.bills.overdue_count })}
          </Badge>
        )}
      </div>

      <div className="mt-4 grid lg:grid-cols-[.9fr_1.1fr] gap-6 items-center">
        {/* donut */}
        {hasPie && (
          <div className="relative h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pie}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={76}
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {pie.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip content={<IQDTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <p className="text-[0.62rem] font-semibold text-muted-foreground">{t("analytics.totalSpend")}</p>
              <p className="num text-sm font-bold text-primary">
                {fmtIQD(data.spend_total, true, lang)}
              </p>
            </div>
            {/* legend */}
            <div className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1">
              {pie.slice(0, 6).map((p) => (
                <span key={p.name} className="inline-flex items-center gap-1.5 text-[0.62rem] font-semibold text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: p.fill }} />
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* monthly bars */}
        <div className="h-48">
          <p className="text-[0.7rem] font-bold text-muted-foreground mb-2 flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            {t("analytics.monthlyTitle")}
          </p>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.months} barGap={3}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={44}
                tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
              />
              <Tooltip content={<IQDTooltip />} cursor={{ fill: "var(--secondary)" }} />
              <Bar dataKey="in" name={t("analytics.barIn")} fill="#2E8B6A" radius={[4, 4, 0, 0]} maxBarSize={14} />
              <Bar dataKey="out" name={t("analytics.barOut")} fill="#D9A62E" radius={[4, 4, 0, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* top counterparties */}
      {data.top_counterparties.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border/60">
          <p className="text-[0.7rem] font-bold text-muted-foreground mb-2.5">
            {t("analytics.topCounterparties")}
          </p>
          <div className="flex flex-wrap gap-2.5">
            {data.top_counterparties.map((cp) => (
              <div
                key={cp.name}
                className="flex items-center gap-2.5 rounded-2xl border border-border/60 bg-background px-3 py-2"
              >
                <UserAvatar name={cp.name} hue={cp.avatar_hue} size={30} />
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate max-w-32">{cp.name}</p>
                  <p className="num text-[0.65rem] text-muted-foreground">
                    {fmtIQD(cp.total, true, lang)} · {t("analytics.transfersCount", { n: cp.count })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
