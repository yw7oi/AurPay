"use client";

import {
  ArrowDownLeft, ArrowUpRight, Banknote, CarFront, Droplets, GraduationCap,
  Landmark, Smartphone, Wallet, Wifi, Zap, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  electricity: Zap,
  water: Droplets,
  internet: Wifi,
  mobile: Smartphone,
  education: GraduationCap,
  traffic: CarFront,
  transfer: ArrowUpRight,
  wallet: Wallet,
  topup: Banknote,
};

const CATEGORY_HUES: Record<string, { bg: string; fg: string; ring: string }> = {
  electricity: { bg: "bg-amber-100", fg: "text-amber-700", ring: "ring-amber-200" },
  water: { bg: "bg-cyan-100", fg: "text-cyan-700", ring: "ring-cyan-200" },
  internet: { bg: "bg-violet-100", fg: "text-violet-700", ring: "ring-violet-200" },
  mobile: { bg: "bg-rose-100", fg: "text-rose-700", ring: "ring-rose-200" },
  education: { bg: "bg-emerald-100", fg: "text-emerald-700", ring: "ring-emerald-200" },
  traffic: { bg: "bg-orange-100", fg: "text-orange-700", ring: "ring-orange-200" },
  transfer: { bg: "bg-slate-100", fg: "text-slate-700", ring: "ring-slate-200" },
  wallet: { bg: "bg-stone-100", fg: "text-stone-700", ring: "ring-stone-200" },
  topup: { bg: "bg-lime-100", fg: "text-lime-700", ring: "ring-lime-200" },
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
    <ArrowUpRight className={cn("h-4 w-4 text-rose-500", className)} />
  ) : (
    <ArrowDownLeft className={cn("h-4 w-4 text-emerald-600", className)} />
  );
}
