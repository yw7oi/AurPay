"use client";

/* BudgetCard — per-category monthly spending limits with live progress.
   Data from GET /api/budgets (merged with month-to-date spend). */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Check, Gauge, Loader2, Pencil, Plus, Sparkles, Trash2, TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/lib/store";
import { fmtIQD, urpay, type BudgetRow } from "@/lib/urpay";
import { useToast } from "@/hooks/use-toast";
import { CategoryIcon } from "./icons";

const QUICK_AMOUNTS = [50_000, 100_000, 250_000, 500_000, 1_000_000];

const CAT_LABEL: Record<string, string> = {
  electricity: "كهرباء",
  water: "ماء",
  internet: "إنترنت",
  mobile: "اتصالات",
  education: "تعليم",
  traffic: "مرور",
  transfer: "تحويلات",
};

function statusStyle(status: BudgetRow["status"]) {
  switch (status) {
    case "over":
      return {
        bar: "bg-destructive",
        track: "bg-destructive/15",
        badge: "bg-destructive/10 text-destructive border-destructive/25",
        badgeText: "تجاوزت الحد",
      };
    case "near":
      return {
        bar: "bg-gold-deep",
        track: "bg-gold-deep/15",
        badge: "bg-gold/15 text-gold-deep border-gold/30",
        badgeText: "قربت توصل الحد",
      };
    default:
      return {
        bar: "bg-primary",
        track: "bg-primary/15",
        badge: "bg-primary/10 text-primary border-primary/25",
        badgeText: "ضمن الحد",
      };
  }
}

function BudgetRowItem({ row, onEdit }: {
  row: BudgetRow;
  onEdit: (r: BudgetRow) => void;
}) {
  const s = statusStyle(row.status);
  const pct = Math.min(100, Math.max(0, row.pct));
  return (
    <div className="group rounded-2xl border border-border/60 bg-background/60 p-3.5 hover:border-primary/30 transition-colors">
      <div className="flex items-center gap-3">
        <CategoryIcon category={row.category} className="h-9 w-9 rounded-xl" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-bold">{CAT_LABEL[row.category] ?? row.category}</p>
            <p className="num text-xs text-muted-foreground" dir="rtl">
              <b className={row.status === "over" ? "text-destructive" : "text-foreground"}>
                {fmtIQD(row.spent, false)}
              </b>
              {" من "}
              {fmtIQD(row.monthly_limit, false)}
            </p>
          </div>
          {/* progress track */}
          <div className={`mt-2 h-2 rounded-full overflow-hidden ${s.track}`} role="progressbar" aria-valuenow={Math.round(row.pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`ميزانية ${CAT_LABEL[row.category] ?? row.category}`}>
            <motion.div
              className={`h-full rounded-full ${s.bar}`}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <Badge variant="outline" className={`rounded-full text-[0.6rem] font-bold px-2 py-0 h-auto ${s.badge}`}>
              {row.status === "over" ? <TriangleAlert className="h-2.5 w-2.5 me-1" /> : null}
              {s.badgeText}
              <span className="num ms-1">{Math.round(row.pct)}%</span>
            </Badge>
            <p className="num text-[0.62rem] text-muted-foreground/80" dir="rtl">
              {row.remaining >= 0
                ? `باقي ${fmtIQD(row.remaining, false)} د.ع`
                : `زائد ${fmtIQD(-row.remaining, false)} د.ع`}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(row)}
          className="rounded-xl h-8 w-8 shrink-0 opacity-60 hover:opacity-100"
          aria-label={`تعديل ميزانية ${CAT_LABEL[row.category] ?? row.category}`}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function BudgetCard({ refreshKey }: { refreshKey: number }) {
  const { token } = useSession();
  const { toast } = useToast();
  const [feed, setFeed] = useState<{
    month: string; items: BudgetRow[]; total: { limit: number; spent: number };
    categories: string[];
  } | null>(null);
  const [editRow, setEditRow] = useState<BudgetRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setFeed(await urpay.budgets(token));
    } catch {
      /* silent — card stays hidden on failure */
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const save = async (category: string, limit: number) => {
    if (!token || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const res = await urpay.setBudget(token, category, limit);
      toast({
        title: res.removed ? "انحذفت الميزانية" : "تم حفظ الميزانية ✅",
        description: res.message,
      });
      await load();
      setEditRow(null);
      setAddOpen(false);
    } catch (err) {
      toast({
        title: "ما تم الحفظ",
        description: err instanceof Error ? err.message : "حاول مرة ثانية",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
      inFlight.current = false;
    }
  };

  /* hidden while loading or on API failure */
  if (!token || feed === null) return null;

  const usedCats = new Set(feed.items.map((i) => i.category));
  const freeCats = feed.categories.filter((c) => !usedCats.has(c));

  /* empty state — still show the card with a CTA (budgets are a discovery feature) */
  if (feed.items.length === 0) {
    return (
      <>
        <section className="relative overflow-hidden rounded-3xl border border-dashed border-primary/30 bg-primary/[.03] p-6" dir="rtl">
          <div
            className="absolute -top-16 -start-16 h-40 w-40 rounded-full blur-3xl"
            style={{ background: "radial-gradient(closest-side, var(--primary)/12, transparent)" }}
            aria-hidden="true"
          />
          <div className="relative flex flex-wrap items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <Gauge className="h-6 w-6" />
            </span>
            <div className="flex-1 min-w-0">
              <h3 className="font-display text-lg leading-tight">حدد ميزانية لصرفك الشهري</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                حط حد شهري لأي تصنيف (كهرباء، ماء، تحويلات…) — نراقب صرفك ونخبرك قبل لا يتجاوز الحد. 📊
              </p>
            </div>
            <Button
              onClick={() => setAddOpen(true)}
              className="rounded-2xl font-bold"
            >
              <Plus className="h-4 w-4" />
              ابدأ الآن
            </Button>
          </div>
        </section>
        <BudgetDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          mode="add"
          categories={freeCats}
          saving={saving}
          onSave={(cat, limit) => save(cat, limit)}
        />
      </>
    );
  }

  const totalPct = feed.total.limit > 0
    ? Math.round((feed.total.spent / feed.total.limit) * 100) : 0;

  return (
    <>
      <section className="rounded-3xl border border-border/70 bg-card p-5 sm:p-6" dir="rtl">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/15">
              <Gauge className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-display text-lg leading-tight">ميزانياتي الشهرية</h2>
              <p className="text-[0.7rem] text-muted-foreground mt-0.5">
                شهر {feed.month} — إجمالي:{" "}
                <b className="num text-foreground">{fmtIQD(feed.total.spent, false)}</b>
                {" من "}
                <b className="num text-primary">{fmtIQD(feed.total.limit, false)}</b>
                <span className="num"> ({totalPct}%)</span>
              </p>
            </div>
          </div>
          {freeCats.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(true)}
              className="rounded-xl font-semibold"
            >
              <Plus className="h-3.5 w-3.5" />
              ميزانية جديدة
            </Button>
          )}
        </div>

        <div className="space-y-2.5 max-h-96 overflow-y-auto scrollbar-slim pe-1">
          {feed.items.map((row) => (
            <BudgetRowItem key={row.category} row={row} onEdit={setEditRow} />
          ))}
        </div>

        <p className="mt-3.5 text-[0.62rem] text-muted-foreground/70 text-center flex items-center justify-center gap-1.5">
          <Sparkles className="h-3 w-3 text-gold-deep" />
          جرّب أيضًا من المحادثة: «ميزانية الكهرباء 150 ألف»
        </p>
      </section>

      <BudgetDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode="add"
        categories={freeCats}
        saving={saving}
        onSave={(cat, limit) => save(cat, limit)}
      />
      <BudgetDialog
        open={editRow !== null}
        onOpenChange={(o) => { if (!o) setEditRow(null); }}
        mode="edit"
        row={editRow}
        saving={saving}
        onSave={(cat, limit) => save(cat, limit)}
        onRemove={(cat) => save(cat, 0)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */

function BudgetDialog({
  open, onOpenChange, mode, categories, row, saving, onSave, onRemove,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "add" | "edit";
  categories?: string[];
  row?: BudgetRow | null;
  saving: boolean;
  onSave: (category: string, limit: number) => void;
  onRemove?: (category: string) => void;
}) {
  const [cat, setCat] = useState("");
  const [err, setErr] = useState("");
  const [amount, setAmount] = useState("");

  /* reset during render when the dialog opens (adjust-state-on-prop-change) */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setCat("");
      setAmount(row ? String(row.monthly_limit) : "");
      setErr("");
    }
  }

  const limit = Number(amount.replace(/[^\d]/g, ""));

  function submit() {
    const finalCat = mode === "edit" ? row?.category : cat;
    if (!finalCat) { setErr("اختر التصنيف أولًا"); return; }
    if (!limit || limit < 1000) { setErr("الحد لازم يكون 1,000 د.ع على الأقل"); return; }
    if (limit > 20_000_000) { setErr("الحد الأقصى 20,000,000 د.ع"); return; }
    onSave(finalCat, limit);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-md rounded-3xl" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 font-display">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Gauge className="h-4.5 w-4.5 h-[18px] w-[18px]" />
            </span>
            {mode === "add" ? "ميزانية جديدة" : `تعديل ميزانية ${CAT_LABEL[row?.category ?? ""] ?? ""}`}
          </DialogTitle>
          <DialogDescription>
            حد شهري لتصنيف واحد — نراقب صرفك وننبهك عند التجاوز. تعديل الميزانية ما يحتاج PIN.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {mode === "add" && (
            <div>
              <label className="text-xs font-bold mb-1.5 block">التصنيف</label>
              <Select value={cat} onValueChange={(v) => { setCat(v); setErr(""); }}>
                <SelectTrigger className="rounded-xl h-11" dir="rtl">
                  <SelectValue placeholder="اختر التصنيف" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {(categories ?? []).map((c) => (
                    <SelectItem key={c} value={c} className="flex-row-reverse">
                      <span className="flex items-center gap-2">
                        <CategoryIcon category={c} className="h-6 w-6 rounded-lg" boxed={false} />
                        {CAT_LABEL[c] ?? c}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <label className="text-xs font-bold mb-1.5 block">الحد الشهري (د.ع)</label>
            <Input
              value={amount}
              onChange={(e) => { setAmount(e.target.value.replace(/[^\d]/g, "")); setErr(""); }}
              inputMode="numeric"
              placeholder="150000"
              className="rounded-xl h-11 num"
              dir="ltr"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_AMOUNTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => { setAmount(String(q)); setErr(""); }}
                  className="num rounded-full border border-border/70 bg-secondary/50 px-3 py-1 text-[0.68rem] font-bold text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                >
                  {q >= 1_000_000 ? `${q / 1_000_000}M` : `${q / 1000}k`}
                </button>
              ))}
            </div>
          </div>

          {err && (
            <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
              <TriangleAlert className="h-3.5 w-3.5" />
              {err}
            </p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row-reverse sm:justify-between">
          {mode === "edit" && onRemove ? (
            <Button
              variant="outline"
              onClick={() => row && onRemove(row.category)}
              disabled={saving}
              className="rounded-xl text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive font-bold"
            >
              <Trash2 className="h-4 w-4" />
              حذف
            </Button>
          ) : <span />}
          <Button
            onClick={submit}
            disabled={saving}
            className="rounded-xl font-bold"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            حفظ الميزانية
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
