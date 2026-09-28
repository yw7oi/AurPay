/* Shared notification pusher — port of app/notify.py.
 * Adds the row to the in-memory store (no transaction semantics needed). */

import type { Db } from "./types";

export function notify(
  db: Db,
  userId: number,
  opts: {
    kind: string;
    title: string;
    body?: string;
    amount?: number | null;
    reference?: string;
  },
): void {
  db.notifications.push({
    id: ++db.seq.notifications,
    user_id: userId,
    kind: opts.kind,
    title: opts.title.slice(0, 160),
    body: (opts.body ?? "").slice(0, 280),
    amount: opts.amount ?? null,
    reference: (opts.reference ?? "").slice(0, 32),
    is_read: false,
    created_at: Date.now(),
  });
}
