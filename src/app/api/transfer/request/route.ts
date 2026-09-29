import { err, getAuthUser, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { fmtAr } from "@/lib/urpay-server/serializers";
import { notify } from "@/lib/urpay-server/notify";
import { expireStaleRequests } from "@/lib/urpay-server/transfer";
import { validateTransferRequest } from "@/lib/urpay-server/validate";
import type { TransferRequestRow, UserRow } from "@/lib/urpay-server/types";

export const dynamic = "force-dynamic";

/* POST /api/transfer/request (202) — wallet.py make_transfer */
export async function POST(req: Request) {
  return runRoute(async () => {
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const user = await getAuthUser(req);

    const [input, validationError] = validateTransferRequest(body);
    if (!input) return err(422, validationError);

    const db = getDb();
    expireStaleRequests(db, user); // TTL housekeeping

    let receiver: UserRow | null = null;
    if (input.receiverCard) {
      receiver = db.users.find((u) => u.card_number === input.receiverCard) ?? null;
    } else if (input.receiverId) {
      receiver = db.users.find((u) => u.id === input.receiverId) ?? null;
    }
    if (!receiver) {
      return err(404, "المستلم غير موجود — تحقق من رقم البطاقة");
    }
    if (receiver.id === user.id) {
      return err(405, "ما تصير تحوّل لنفسك 😅");
    }
    if (user.balance < input.amount) {
      return err(406, "الرصيد غير كافٍ لهذا التحويل");
    }

    const request: TransferRequestRow = {
      id: ++db.seq.transferRequests,
      sender_id: user.id,
      receiver_id: receiver.id,
      amount: input.amount,
      status: "pending",
      created_at: Date.now(),
      confirmed_at: null,
    };
    db.transferRequests.push(request);

    notify(db, receiver.id, {
      kind: "transfer_request",
      title: `${user.full_name} أرسل لك طلب حوالة`,
      body: `مبلغ ${fmtAr(input.amount)} د.ع — لقّبول أو رفض الطلب من صفحة التحويل.`,
      amount: input.amount,
      reference: `tr-${user.id}`,
    });

    return jsonOk(
      {
        message: "تم إنشاء طلب التحويل — أكّده برمز الـ PIN",
        request: {
          id: request.id,
          receiver: receiver.full_name,
          receiver_card_masked: `•••• ${receiver.card_number.slice(-4)}`,
          amount: request.amount,
          status: request.status,
        },
      },
      202,
    );
  });
}
