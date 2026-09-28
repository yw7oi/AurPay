/* Transfer-request helpers — port of wallet.py expire_stale_requests. */

import type { Db, UserRow } from "./types";
import { notify } from "./notify";
import { fmtAr } from "./serializers";

const TTL_MS = 24 * 3_600_000;

/** Cancel pending transfer requests older than 24h + notify both sides. */
export function expireStaleRequests(db: Db, user: UserRow): number {
  const cutoff = Date.now() - TTL_MS;
  const stale = db.transferRequests.filter(
    (r) =>
      r.sender_id === user.id && r.status === "pending" && r.created_at < cutoff,
  );
  for (const r of stale) {
    r.status = "expired";
    const receiver = db.users.find((u) => u.id === r.receiver_id);
    const amountAr = `${fmtAr(r.amount)} د.ع`;
    notify(db, user.id, {
      kind: "transfer_expired",
      title: "انتهت صلاحية طلب حوالة",
      body:
        `طلب حوالة بمبلغ ${amountAr} إلى ${receiver ? receiver.full_name : "مستخدم"} ` +
        `انتهت صلاحيته بعد ٢٤ ساعة بدون تأكيد.`,
      amount: r.amount,
      reference: `tr-${r.id}`,
    });
    if (receiver) {
      notify(db, receiver.id, {
        kind: "transfer_expired",
        title: "انتهت صلاحية طلب حوالة",
        body:
          `طلب حوالة بمبلغ ${amountAr} من ${user.full_name} ` +
          `انتهت صلاحيته بعد ٢٤ ساعة بدون تأكيد.`,
        amount: r.amount,
        reference: `tr-${r.id}`,
      });
    }
  }
  return stale.length;
}
