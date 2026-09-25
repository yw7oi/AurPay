"use client";

import {
  ArrowDownLeft, ArrowUpRight, Banknote, CarFront, Droplets, Flame,
  GraduationCap, HeartPulse, Landmark, PiggyBank, Smartphone, Wallet, Wifi, Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  electricity: Zap,
  water: Droplets,
  internet: Wifi,
  mobile: Smartphone,
  education: GraduationCap,
  traffic: CarFront,
  health: HeartPulse,
  gas: Flame,
  transfer: ArrowUpRight,
  wallet: Wallet,
  savings: PiggyBank,
  topup: Banknote,
};

const CATEGORY_HUES: Record<string, { bg: string; fg: string; ring: string }> = {
  electricity: {
    bg: "bg-amber-100 dark:bg-amber-400/15",
    fg: "text-amber-700 dark:text-amber-300",
    ring: "ring-amber-200 dark:ring-amber-400/25",
  },
  water: {
    bg: "bg-cyan-100 dark:bg-cyan-400/15",
    fg: "text-cyan-700 dark:text-cyan-300",
    ring: "ring-cyan-200 dark:ring-cyan-400/25",
  },
  internet: {
    bg: "bg-violet-100 dark:bg-violet-400/15",
    fg: "text-violet-700 dark:text-violet-300",
    ring: "ring-violet-200 dark:ring-violet-400/25",
  },
  mobile: {
    bg: "bg-rose-100 dark:bg-rose-400/15",
    fg: "text-rose-700 dark:text-rose-300",
    ring: "ring-rose-200 dark:ring-rose-400/25",
  },
  education: {
    bg: "bg-emerald-100 dark:bg-emerald-400/15",
    fg: "text-emerald-700 dark:text-emerald-300",
    ring: "ring-emerald-200 dark:ring-emerald-400/25",
  },
  traffic: {
    bg: "bg-orange-100 dark:bg-orange-400/15",
    fg: "text-orange-700 dark:text-orange-300",
    ring: "ring-orange-200 dark:ring-orange-400/25",
  },
  health: {
    bg: "bg-red-100 dark:bg-red-400/15",
    fg: "text-red-700 dark:text-red-300",
    ring: "ring-red-200 dark:ring-red-400/25",
  },
  gas: {
    bg: "bg-fuchsia-100 dark:bg-fuchsia-400/15",
    fg: "text-fuchsia-700 dark:text-fuchsia-300",
    ring: "ring-fuchsia-200 dark:ring-fuchsia-400/25",
  },
  transfer: {
    bg: "bg-slate-100 dark:bg-slate-400/15",
    fg: "text-slate-700 dark:text-slate-300",
    ring: "ring-slate-200 dark:ring-slate-400/25",
  },
  wallet: {
    bg: "bg-stone-100 dark:bg-stone-400/15",
    fg: "text-stone-700 dark:text-stone-300",
    ring: "ring-stone-200 dark:ring-stone-400/25",
  },
  savings: {
    bg: "bg-teal-100 dark:bg-teal-400/15",
    fg: "text-teal-700 dark:text-teal-300",
    ring: "ring-teal-200 dark:ring-teal-400/25",
  },
  topup: {
    bg: "bg-lime-100 dark:bg-lime-400/15",
    fg: "text-lime-700 dark:text-lime-300",
    ring: "ring-lime-200 dark:ring-lime-400/25",
  },
};

export function CategoryIcon({
  category,
  className,
  boxed = true,
}: {
  category: string;
  className?: string;
  boxed?: boolean;
}) {
  const Icon = CATEGORY_ICONS[category] ?? Landmark;
  const hue = CATEGORY_HUES[category] ?? CATEGORY_HUES.wallet;
  if (!boxed) return <Icon className={cn("h-5 w-5", className)} />;
  return (
    <span
      className={cn(
        "inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1",
        hue.bg, hue.fg, hue.ring,
        className,
      )}
    >
      <Icon className="h-5 w-5" />
    </span>
  );
}

export function DirectionIcon({ direction, className }: { direction: "in" | "out"; className?: string }) {
  return direction === "out" ? (
    <ArrowUpRight className={cn("h-4 w-4 text-rose-500 dark:text-rose-300", className)} />
  ) : (
    <ArrowDownLeft className={cn("h-4 w-4 text-emerald-600 dark:text-emerald-300", className)} />
  );
}
