import { getAuthUser, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { isoDate, isoTime } from "@/lib/urpay-server/serializers";

export const dynamic = "force-dynamic";

const TYPE_AR: Record<string, string> = {
  bill_payment: "دفع فاتورة",
  transfer_out: "تحويل صادر",
  transfer_in: "تحويل وارد",
  topup: "تعبئة محفظة",
  goal_deposit: "إيداع هدف",
  goal_withdraw: "سحب من هدف",
};
const DIRECTION_AR: Record<string, string> = { in: "وارد", out: "صادر" };

/** RFC-4180 CSV field escaping (wallet.py uses Python's csv.writer). */
function csvField(v: string | number): string {
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/* GET /api/transactions/export — wallet.py export_transactions
 * CSV export of the user's full history (Excel-friendly UTF-8 BOM). */
export async function GET(req: Request) {
  return runRoute(async () => {
    const user = await getAuthUser(req);
    const db = getDb();
    const rows = [...db.txns]
      .filter((t) => t.user_id === user.id)
      .sort((a, b) => b.created_at - a.created_at || b.id - a.id);

    const lines: string[] = [];
    lines.push(
      [
        "الرقم المرجعي", "التاريخ", "الوقت", "النوع", "الاتجاه",
        "العنوان", "التفاصيل", "التصنيف", "المبلغ (د.ع)",
        "الرصيد بعد العملية (د.ع)",
      ].map(csvField).join(","),
    );
    for (const t of rows) {
      lines.push(
        [
          t.reference,
          isoDate(t.created_at),
          isoTime(t.created_at),
          TYPE_AR[t.type] ?? t.type,
          DIRECTION_AR[t.direction] ?? t.direction,
          t.title,
          t.subtitle,
          t.category,
          t.amount,
          t.balance_after,
        ]
          .map(csvField)
          .join(","),
      );
    }

    const csv = "\ufeff" + lines.join("\r\n") + "\r\n";
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="urpay-transactions.csv"',
      },
    });
  });
}
