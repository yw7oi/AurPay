"use client";

import type { Lang } from "@/lib/i18n";
import { fmtDateTime, fmtIQD, type Receipt } from "@/lib/urpay";

/* ------------------------------------------------------------------ */
/* Receipt PDF export — renders a branded print page in a hidden       */
/* iframe and calls print(); the browser's "Save as PDF" produces a    */
/* pixel-perfect Arabic RTL receipt (native font shaping).            */
/* ------------------------------------------------------------------ */

const BRAND_EMERALD = "#0F8A63";
const BRAND_EMERALD_DARK = "#0B5C46";
const BRAND_GOLD = "#E8C867";
const INK = "#0C2A21";
const PAPER = "#F4F1E8";

function receiptHtml(receipt: Receipt, lang: Lang): string {
  const rtl = lang === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const L = (ar: string, en: string) => (rtl ? ar : en);

  const labels = {
    success: L("عملية ناجحة", "Operation successful"),
    receipt: L("إيصال دفع", "Payment receipt"),
    reference: L("الرقم المرجعي", "Reference"),
    amount: L("المبلغ", "Amount"),
    balanceAfter: L("الرصيد بعد العملية", "Balance after"),
    date: L("التاريخ والوقت", "Date & time"),
    issued: L("صادر عن محفظة أور پاي — العراق", "Issued by UrPay wallet — Iraq"),
    verified: L("إيصال موثّق إلكترونيًا", "Electronically verified receipt"),
    title: L("إيصال أور پاي", "UrPay receipt"),
  };

  return `<!DOCTYPE html>
<html lang="${rtl ? "ar" : "en"}" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${labels.title} · ${receipt.reference}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; }
  body {
    font-family: "IBM Plex Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif;
    color: ${INK};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    width: 210mm;
    min-height: 120mm;
    margin: 0 auto;
    padding: 14mm 16mm;
    position: relative;
  }
  /* gold edge bar — the UrPay signature */
  .sheet::before {
    content: "";
    position: absolute;
    top: 0; bottom: 0; ${rtl ? "right" : "left"}: 0;
    width: 6mm;
    background: linear-gradient(180deg, ${BRAND_GOLD} 0%, #d4ae4f 100%);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 6mm;
    border-bottom: 0.6mm dashed #c9c4b4;
  }
  .brand { display: flex; align-items: center; gap: 4mm; }
  .mark {
    width: 13mm; height: 13mm;
    border-radius: 4mm;
    background: linear-gradient(135deg, ${BRAND_EMERALD}, ${BRAND_EMERALD_DARK});
    display: flex; align-items: center; justify-content: center;
  }
  .mark svg { width: 8mm; height: 8mm; }
  .brand-name {
    font-size: 7mm;
    font-weight: 700;
    letter-spacing: -0.2mm;
    color: ${BRAND_EMERALD_DARK};
  }
  .brand-name span { color: #a8862d; }
  .badge {
    font-size: 3.4mm;
    font-weight: 700;
    color: ${BRAND_EMERALD};
    border: 0.4mm solid ${BRAND_EMERALD}55;
    background: ${BRAND_EMERALD}11;
    border-radius: 99px;
    padding: 1.6mm 4.5mm;
  }
  .success-row {
    display: flex;
    align-items: center;
    gap: 3mm;
    margin-top: 7mm;
  }
  .success-dot {
    width: 7mm; height: 7mm;
    border-radius: 99px;
    background: ${BRAND_EMERALD}18;
    display: flex; align-items: center; justify-content: center;
  }
  .success-dot svg { width: 4.4mm; height: 4.4mm; }
  .success-text { font-size: 4.6mm; font-weight: 700; color: ${BRAND_EMERALD}; }
  .title {
    font-size: 5.4mm;
    font-weight: 600;
    margin-top: 4mm;
    line-height: 1.5;
  }
  .subtitle {
    font-size: 3.4mm;
    color: #6f7468;
    margin-top: 1mm;
  }
  .amount {
    font-size: 11mm;
    font-weight: 700;
    color: ${BRAND_EMERALD};
    letter-spacing: -0.3mm;
    margin-top: 5mm;
    font-variant-numeric: tabular-nums;
  }
  table {
    width: 100%;
    margin-top: 7mm;
    border-collapse: collapse;
  }
  td {
    padding: 3.2mm 0;
    font-size: 3.6mm;
    border-bottom: 0.35mm solid #e4e0d2;
  }
  td.label { color: #6f7468; ${rtl ? "padding-left: 12mm" : "padding-right: 12mm"}; white-space: nowrap; }
  td.value { font-weight: 600; text-align: ${rtl ? "left" : "right"}; font-variant-numeric: tabular-nums; }
  .ref { letter-spacing: 0.3mm; direction: ltr; unicode-bidi: embed; }
  .footer {
    margin-top: 8mm;
    padding-top: 4mm;
    border-top: 0.6mm dashed #c9c4b4;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .footer p { font-size: 3mm; color: #8a8f81; }
  .seal {
    display: flex; align-items: center; gap: 2mm;
    font-size: 3mm; color: #8a8f81;
  }
  .seal-dot { width: 2.2mm; height: 2.2mm; border-radius: 99px; background: ${BRAND_EMERALD}; }
  @media print {
    .sheet { margin: 0; width: auto; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="head">
      <div class="brand">
        <div class="mark">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M7 8v5a5 5 0 0 0 10 0V8" stroke="${BRAND_GOLD}" stroke-width="2.6" stroke-linecap="round"/>
            <circle cx="12" cy="5.5" r="1.7" fill="${BRAND_GOLD}"/>
          </svg>
        </div>
        <div>
          <div class="brand-name">Ur<span>Pay</span></div>
          <div style="font-size:3mm;color:#8a8f81;">${L("محفظة العراق الذكية", "Iraq's smart wallet")}</div>
        </div>
      </div>
      <span class="badge">${labels.receipt}</span>
    </div>

    <div class="success-row">
      <span class="success-dot">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M20 6 9 17l-5-5" stroke="${BRAND_EMERALD}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <span class="success-text">${labels.success}</span>
    </div>

    <p class="title">${receipt.title}</p>
    ${receipt.subtitle ? `<p class="subtitle">${receipt.subtitle}</p>` : ""}
    <p class="amount">${fmtIQD(receipt.amount, true, lang)}</p>

    <table>
      <tr>
        <td class="label">${labels.reference}</td>
        <td class="value ref">${receipt.reference}</td>
      </tr>
      <tr>
        <td class="label">${labels.amount}</td>
        <td class="value">${fmtIQD(receipt.amount, true, lang)}</td>
      </tr>
      <tr>
        <td class="label">${labels.balanceAfter}</td>
        <td class="value">${fmtIQD(receipt.balance_after, true, lang)}</td>
      </tr>
      <tr>
        <td class="label">${labels.date}</td>
        <td class="value">${fmtDateTime(receipt.created_at, lang)}</td>
      </tr>
    </table>

    <div class="footer">
      <p>${labels.issued}</p>
      <div class="seal">
        <span class="seal-dot"></span>
        ${labels.verified}
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function printReceipt(receipt: Receipt, lang: Lang = "ar"): void {
  if (typeof document === "undefined") return;

  /* reuse a single hidden iframe */
  let frame = document.getElementById("urpay-print-frame") as HTMLIFrameElement | null;
  if (!frame) {
    frame = document.createElement("iframe");
    frame.id = "urpay-print-frame";
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("title", "receipt print");
    frame.style.cssText =
      "position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none;";
    document.body.appendChild(frame);
  }

  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(receiptHtml(receipt, lang));
  doc.close();

  /* give the iframe a tick to layout, then print, then clean up */
  window.setTimeout(() => {
    try {
      frame!.contentWindow?.focus();
      frame!.contentWindow?.print();
    } catch {
      /* print blocked — iframe stays for manual retry via context menu */
    }
    window.setTimeout(() => {
      frame?.parentElement?.removeChild(frame);
    }, 60_000);
  }, 120);
}
