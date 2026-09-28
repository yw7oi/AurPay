import { err, getAuthUser, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb } from "@/lib/urpay-server/store";
import { fmtAr, goalItem } from "@/lib/urpay-server/serializers";
import type { SavingsGoalRow } from "@/lib/urpay-server/types";

export const dynamic = "force-dynamic";

const MAX_GOALS = 8;
const ALLOWED_EMOJI = new Set([
  "🎯", "🕌", "✈️", "🎓", "🚗", "🏠", "💍", "📱", "💻", "👶", "🏝️", "🎁",
]);
const DEFAULT_EMOJI = "🎯";

/* GET /api/goals — goals.py list_goals
 * Python orders by status DESC ("completed" < "active" reversed → completed
 * first), then created_at — ported verbatim. */
export async function GET(req: Request) {
  return runRoute(async () => {
    const user = getAuthUser(req);
    const db = getDb();

    const rows = db.goals
      .filter((g) => g.user_id === user.id)
      .sort(
        (a, b) =>
          (a.status < b.status ? 1 : a.status > b.status ? -1 : 0) ||
          a.created_at - b.created_at,
      );

    return jsonOk({
      items: rows.map(goalItem),
      totals: {
        count: rows.length,
        target: rows.reduce((s, g) => s + g.target_amount, 0),
        saved: rows.reduce((s, g) => s + g.saved_amount, 0),
      },
    });
  });
}

/* POST /api/goals — goals.py create_goal */
export async function POST(req: Request) {
  return runRoute(async () => {
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const user = getAuthUser(req);
    const db = getDb();

    const nameRaw = typeof body.name === "string" ? body.name.trim() : "";
    if (nameRaw.length < 2 || nameRaw.length > 48) {
      return err(422, "اسم الهدف يجب أن يكون بين 2 و 48 حرفًا");
    }
    const target = body.target_amount;
    if (
      typeof target !== "number" ||
      !Number.isInteger(target) ||
      target < 10_000 ||
      target > 100_000_000
    ) {
      return err(422, "المبلغ المستهدف يجب أن يكون بين 10,000 و 100,000,000 د.ع");
    }
    const emoji =
      typeof body.emoji === "string" && ALLOWED_EMOJI.has(body.emoji)
        ? body.emoji
        : DEFAULT_EMOJI;

    const count = db.goals.filter((g) => g.user_id === user.id).length;
    if (count >= MAX_GOALS) {
      return err(422, `عندك الحد الأقصى ${MAX_GOALS} أهداف — احذف واحد أولًا`);
    }

    const g: SavingsGoalRow = {
      id: ++db.seq.goals,
      user_id: user.id,
      name: nameRaw,
      emoji,
      target_amount: target,
      saved_amount: 0,
      status: "active",
      created_at: Date.now(),
      updated_at: null,
    };
    db.goals.push(g);

    return jsonOk(
      {
        message: `انشاء هدف «${g.name}» — وفّر له ${fmtAr(g.target_amount)} د.ع`,
        goal: goalItem(g),
      },
      201,
    );
  });
}
