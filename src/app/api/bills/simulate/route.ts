import { err, getAuthUser, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { BILLERS } from "@/lib/urpay-server/constants";
import { billPublic } from "@/lib/urpay-server/serializers";
import { validateSimulateBill } from "@/lib/urpay-server/validate";
import type { BillRow } from "@/lib/urpay-server/types";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/* POST /api/bills/simulate (201) — wallet.py simulate_bill */
export async function POST(req: Request) {
  return runRoute(async () => {
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const user = await getAuthUser(req);

    const [input, validationError] = validateSimulateBill(body);
    if (!input) return err(422, validationError);

    const biller = Object.values(BILLERS)
      .flat()
      .find((b) => b.code === input.biller_code);
    const name = biller ? biller.name : input.biller_code;

    const db = getDb();
    const now = Date.now();
    const bill: BillRow = {
      id: ++db.seq.bills,
      user_id: user.id,
      category: input.category,
      biller_code: input.biller_code,
      biller_name: name,
      subscriber_no: input.subscriber_no,
      amount: input.amount,
      period: "فاتورة تجريبية",
      due_date: now + 14 * DAY,
      status: "unpaid",
      issued_at: now,
      paid_at: null,
      receipt_ref: null,
    };
    db.bills.push(bill);
    return jsonOk(billPublic(bill), 201);
  });
}
