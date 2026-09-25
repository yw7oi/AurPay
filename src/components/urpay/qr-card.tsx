"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { motion } from "framer-motion";
import {
  BadgeCheck, Camera, CameraOff, Copy, Download, Loader2,
  QrCode, ScanLine, Share2, UserRoundCheck, X,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/store";
import { urpay, type UserSummary } from "@/lib/urpay";
import { useT } from "@/lib/i18n";
import { copyToClipboard } from "@/lib/clipboard";
import { useToast } from "@/hooks/use-toast";
import { UrPayMark } from "./logo";
import { UserAvatar } from "./parts";

/* ------------------------------------------------------------------ */
/* QR payload — URPAY:1:<16-digit card>:<full name>                    */
/* ------------------------------------------------------------------ */

export function buildQrPayload(cardNumber: string, fullName: string): string {
  return `URPAY:1:${cardNumber}:${fullName}`;
}

export function parseQrPayload(raw: string): { card: string; name: string | null } | null {
  const text = raw.trim();
  const colon = /^(?:urpay:?)?(?:1:)?([\d]{14,19}):(.+)$/i.exec(text);
  let card = "";
  let name: string | null = null;
  if (colon) {
    card = colon[1];
    name = colon[2];
  } else {
    const digits = text.replace(/\D/g, "");
    if (digits.length === 16) card = digits;
  }
  card = card.replace(/\D/g, "");
  if (card.length < 14 || card.length > 19) return null;
  return { card, name };
}

/* ------------------------------------------------------------------ */
/* My-QR section — compact card that opens the full QR dialog          */
/* ------------------------------------------------------------------ */

export function MyQrCard({ onScan }: { onScan: () => void }) {
  const { user } = useSession();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  if (!user) return null;
  const payload = buildQrPayload(user.card_number, user.full_name);

  return (
    <section className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-l from-primary/[.07] via-card to-card p-5 sm:p-6">
      <span
        className="absolute -top-16 -start-16 h-44 w-44 rounded-full bg-primary/[.08] blur-2xl"
        aria-hidden="true"
      />
      <div className="relative flex items-center gap-4">
        {/* mini QR preview — decorative, the dialog carries the real scan */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("transfer.qrOpenBtn")}
          className="group relative shrink-0 rounded-2xl bg-white p-2 shadow-lift ring-1 ring-primary/25 transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
        >
          <QRCode value={payload} size={72} level="M" bgColor="#FFFFFF" fgColor="#0C2A21" />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white ring-1 ring-primary/20">
              <UrPayMark className="h-6 w-6" />
            </span>
          </span>
          <span className="absolute -bottom-1 -end-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[#0C2A21] shadow-sm transition-transform group-hover:scale-110">
            <QrCode className="h-3 w-3" />
          </span>
        </button>

        <div className="flex-1 min-w-0">
          <h2 className="font-display text-lg flex items-center gap-2">
            <QrCode className="h-4.5 w-4.5 h-[18px] w-[18px] text-primary" />
            {t("transfer.qrSectionTitle")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {t("transfer.qrSectionHint")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => setOpen(true)}
              className="rounded-xl h-9 px-4 text-xs font-bold"
            >
              <QrCode className="h-3.5 w-3.5" />
              {t("transfer.qrOpenBtn")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onScan}
              className="rounded-xl h-9 px-4 text-xs font-bold"
            >
              <ScanLine className="h-3.5 w-3.5" />
              {t("transfer.qrScanBtn")}
            </Button>
          </div>
        </div>
      </div>

      <QrDialog open={open} onOpenChange={setOpen} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Full QR display dialog — branded frame, copy / share / download     */
/* ------------------------------------------------------------------ */

function downloadSvgPng(svg: SVGSVGElement, fileName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const xml = new XMLSerializer().serializeToString(svg);
      const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
      const img = new Image();
      img.onload = () => {
        const pad = 24;
        const canvas = document.createElement("canvas");
        canvas.width = img.width + pad * 2;
        canvas.height = img.height + pad * 2;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no ctx"));
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, pad, pad);
        const url = canvas.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        resolve();
      };
      img.onerror = () => reject(new Error("img decode failed"));
      img.src = svgUrl;
    } catch (e) {
      reject(e instanceof Error ? e : new Error("png failed"));
    }
  });
}

export function QrDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { user } = useSession();
  const { t, lang } = useT();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const qrWrapRef = useRef<HTMLDivElement | null>(null);

  const payload = user ? buildQrPayload(user.card_number, user.full_name) : "";

  async function copyCard() {
    if (!user) return;
    const ok = await copyToClipboard(user.card_number);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }

  async function share() {
    if (!user) return;
    const text = `${t("transfer.qrDialogTitle")} — ${user.full_name} · ${user.card_number}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "UrPay", text });
        return;
      }
    } catch { /* aborted or unsupported — fall back to copy */ }
    const ok = await copyToClipboard(text);
    if (ok) toast({ title: t("transfer.qrCopied") });
  }

  async function download() {
    const svg = qrWrapRef.current?.querySelector("svg");
    if (!svg) return;
    try {
      await downloadSvgPng(svg as SVGSVGElement, "urpay-qr.png");
      toast({ title: t("transfer.qrSavedToast") });
    } catch {
      /* silent */
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl p-6" dir={lang === "ar" ? "rtl" : "ltr"}>
        <DialogHeader className="text-center">
          <DialogTitle className="flex items-center justify-center gap-2 font-display text-xl">
            <QrCode className="h-5 w-5 text-primary" />
            {t("transfer.qrDialogTitle")}
          </DialogTitle>
          <DialogDescription>{t("transfer.qrDialogDesc")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center pt-1 pb-2">
          {/* branded QR frame with corner brackets */}
          <div className="relative rounded-3xl bg-white p-5 shadow-lift-lg ring-1 ring-primary/20">
            <span className="qr-corner" style={{ top: 8, left: 8 }} aria-hidden="true" />
            <span className="qr-corner" style={{ top: 8, right: 8, rotate: "90deg" }} aria-hidden="true" />
            <span className="qr-corner" style={{ bottom: 8, right: 8, rotate: "180deg" }} aria-hidden="true" />
            <span className="qr-corner" style={{ bottom: 8, left: 8, rotate: "270deg" }} aria-hidden="true" />
            <div ref={qrWrapRef} className="relative">
              <QRCode
                value={payload}
                size={216}
                level="M"
                bgColor="#FFFFFF"
                fgColor="#0C2A21"
                style={{ height: "auto", maxWidth: "216px", width: "216px" }}
              />
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white ring-1 ring-primary/15 shadow-sm">
                  <UrPayMark className="h-9 w-9" />
                </span>
              </span>
            </div>
          </div>

          {/* identity */}
          <div className="mt-4 flex items-center gap-3">
            <UserAvatar name={user?.full_name ?? ""} hue={user?.avatar_hue ?? 150} size={40} />
            <div className="text-start">
              <p className="font-bold text-sm">{user?.full_name}</p>
              <p className="text-[0.7rem] text-muted-foreground">{user?.city}</p>
            </div>
          </div>
          <button
            onClick={copyCard}
            className="mt-3 group inline-flex items-center gap-2 rounded-2xl border border-border/70 bg-secondary/50 px-4 py-2.5 transition-colors hover:border-primary/40 hover:bg-primary/[.05]"
            title={t("transfer.qrCopyBtn")}
          >
            <span className="text-[0.68rem] font-semibold text-muted-foreground">{t("transfer.qrCardLabel")}</span>
            <span className="num font-bold tracking-[0.08em]" dir="ltr">
              {user ? user.card_number.replace(/(\d{4})(?=\d)/g, "$1 ") : ""}
            </span>
            {copied ? (
              <BadgeCheck className="h-4 w-4 text-primary" />
            ) : (
              <Copy className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-primary" />
            )}
          </button>
          {copied && (
            <p className="mt-1 text-[0.68rem] font-semibold text-primary">{t("transfer.qrCopied")}</p>
          )}

          {/* actions */}
          <div className="mt-4 grid w-full grid-cols-2 gap-2.5">
            <Button variant="outline" onClick={share} className="rounded-xl h-10 font-bold text-xs">
              <Share2 className="h-4 w-4" />
              {t("transfer.qrShareBtn")}
            </Button>
            <Button variant="outline" onClick={download} className="rounded-xl h-10 font-bold text-xs">
              <Download className="h-4 w-4" />
              {t("transfer.qrDownloadBtn")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Scan dialog — camera (BarcodeDetector) / image / manual paste       */
/* ------------------------------------------------------------------ */

type CameraState = "idle" | "starting" | "on" | "denied";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource | ImageBitmapSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

function getDetectorCtor(): BarcodeDetectorCtor | null {
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return w.BarcodeDetector ?? null;
}

export function ScanDialog({
  open,
  onOpenChange,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onResolved: (card: string, name: string | null) => void;
}) {
  const { token } = useSession();
  const { t, lang } = useT();
  const { toast } = useToast();
  const [camState, setCamState] = useState<CameraState>("idle");
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const loopRef = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const resolvedRef = useRef(false);

  const stopCamera = useCallback(() => {
    if (loopRef.current !== null) {
      window.clearTimeout(loopRef.current);
      loopRef.current = null;
    }
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  /* start camera when the dialog opens (progressive enhancement) */
  useEffect(() => {
    if (!open) {
      stopCamera();
      setCamState("idle");
      setManual("");
      setError(null);
      resolvedRef.current = false;
      return;
    }
    const Ctor = getDetectorCtor();
    if (!Ctor || !navigator.mediaDevices?.getUserMedia) return;
    let cancelled = false;
    setCamState("starting");
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        detectorRef.current = new Ctor({ formats: ["qr_code"] });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCamState("on");
      } catch {
        if (!cancelled) setCamState("denied");
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, stopCamera]);

  /* detection loop */
  useEffect(() => {
    if (!open || camState !== "on") return;
    let stopped = false;

    async function tick() {
      if (stopped) return;
      const video = videoRef.current;
      const detector = detectorRef.current;
      if (video && detector && video.readyState >= 2 && !resolvedRef.current) {
        try {
          const codes = await detector.detect(video);
          const hit = codes.find((c) => c.rawValue);
          if (hit) {
            resolvedRef.current = true;
            await handleRaw(hit.rawValue);
            return;
          }
        } catch { /* transient — keep polling */ }
      }
      loopRef.current = window.setTimeout(tick, 350);
    }
    tick();
    return () => {
      stopped = true;
      if (loopRef.current !== null) {
        window.clearTimeout(loopRef.current);
        loopRef.current = null;
      }
    };
  }, [open, camState, token]);

  async function handleRaw(raw: string): Promise<void> {
    const parsed = parseQrPayload(raw);
    if (!parsed) {
      resolvedRef.current = false;
      setError(t("transfer.qrInvalid"));
      return;
    }
    await resolveCard(parsed.card, parsed.name);
  }

  async function resolveCard(card: string, name: string | null) {
    setError(null);
    setResolving(true);
    try {
      if (token) {
        try {
          const users: UserSummary[] = await urpay.searchUsers(token, card);
          const exact = users.find((u) => u.card_number === card);
          if (exact) {
            finish(exact.card_number, exact.full_name, exact);
            return;
          }
        } catch { /* fall through to raw card */ }
      }
      finish(card, name);
    } finally {
      setResolving(false);
    }
  }

  function finish(card: string, name: string | null, _u?: UserSummary) {
    toast({ title: t("transfer.qrResolvedToast"), description: name ?? `•••• ${card.slice(-4)}` });
    onOpenChange(false);
    onResolved(card, name);
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const raw = manual.trim();
    if (!raw) return;
    await handleRaw(raw);
  }

  async function decodeFile(file: File) {
    const Ctor = getDetectorCtor();
    if (!Ctor) return;
    try {
      const bitmap = await createImageBitmap(file);
      const detector = new Ctor({ formats: ["qr_code"] });
      const codes = await detector.detect(bitmap);
      bitmap.close?.();
      const hit = codes.find((c) => c.rawValue);
      if (hit) await handleRaw(hit.rawValue);
      else setError(t("transfer.qrInvalid"));
    } catch {
      setError(t("transfer.qrInvalid"));
    }
  }

  const camAvailable = camState === "on" || camState === "starting";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl p-6" dir={lang === "ar" ? "rtl" : "ltr"}>
        <DialogHeader className="text-center">
          <DialogTitle className="flex items-center justify-center gap-2 font-display text-xl">
            <ScanLine className="h-5 w-5 text-primary" />
            {t("transfer.qrScanTitle")}
          </DialogTitle>
          <DialogDescription>{t("transfer.qrScanDesc")}</DialogDescription>
        </DialogHeader>

        {/* camera viewport */}
        <div className="relative mx-auto w-full max-w-[260px]">
          <div
            className={`relative overflow-hidden rounded-3xl border bg-secondary/40 ${
              camState === "on" ? "border-primary/40" : "border-dashed border-border"
            } aspect-square`}
          >
            <video
              ref={videoRef}
              muted
              playsInline
              className={`h-full w-full object-cover ${camState === "on" ? "" : "hidden"}`}
              aria-label={t("transfer.qrCameraOn")}
            />
            {camState !== "on" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground p-6 text-center">
                {camState === "starting" ? (
                  <>
                    <Loader2 className="h-7 w-7 animate-spin text-primary" />
                    <p className="text-xs font-semibold">{t("transfer.qrCameraOn")}</p>
                  </>
                ) : camState === "denied" ? (
                  <>
                    <CameraOff className="h-7 w-7" />
                    <p className="text-[0.72rem] leading-relaxed">{t("transfer.qrCameraDenied")}</p>
                  </>
                ) : (
                  <Camera className="h-7 w-7" />
                )}
              </div>
            )}
            {/* scan frame brackets */}
            {camState === "on" && (
              <>
                <span className="qr-corner scan" style={{ top: 18, left: 18 }} aria-hidden="true" />
                <span className="qr-corner scan" style={{ top: 18, right: 18, rotate: "90deg" }} aria-hidden="true" />
                <span className="qr-corner scan" style={{ bottom: 18, right: 18, rotate: "180deg" }} aria-hidden="true" />
                <span className="qr-corner scan" style={{ bottom: 18, left: 18, rotate: "270deg" }} aria-hidden="true" />
                <span className="scan-beam" aria-hidden="true" />
              </>
            )}
          </div>
          {camState === "on" && (
            <p className="mt-2 text-center text-[0.7rem] font-semibold text-primary flex items-center justify-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              {t("transfer.qrCameraOn")}
            </p>
          )}
        </div>

        {/* decode from image (only where BarcodeDetector exists) */}
        {getDetectorCtor() && camState !== "on" && (
          <div className="mt-3 flex justify-center">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) decodeFile(f);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              className="rounded-xl h-9 text-xs font-bold"
            >
              <QrCode className="h-3.5 w-3.5" />
              {t("transfer.qrUploadBtn")}
            </Button>
          </div>
        )}

        {/* manual paste — always available */}
        <form onSubmit={submitManual} className="mt-3 space-y-2">
          <Label className="text-xs font-semibold text-muted-foreground">{t("transfer.qrPasteLabel")}</Label>
          <div className="flex gap-2">
            <Input
              dir="ltr"
              value={manual}
              onChange={(e) => {
                setManual(e.target.value.slice(0, 120));
                setError(null);
              }}
              placeholder={t("transfer.qrPastePlaceholder")}
              className="text-xs"
              autoFocus
            />
            <Button
              type="submit"
              disabled={!manual.trim() || resolving}
              className="rounded-xl font-bold shrink-0"
            >
              {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCheck className="h-4 w-4" />}
            </Button>
          </div>
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-xs font-semibold text-destructive flex items-center gap-1.5"
            >
              <X className="h-3.5 w-3.5" />
              {error}
            </motion.p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
