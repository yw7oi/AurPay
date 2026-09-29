import { getAuthUser, jsonOk, runRoute } from "@/lib/urpay-server/http";
import { getDb, clearAgentMessages } from "@/lib/urpay-server/store";
import { isoNaive } from "@/lib/urpay-server/serializers";

export const dynamic = "force-dynamic";

/* GET /api/agent/history — routers/agent.py agent_history
 * The last 100 stored turns, oldest-first. */
export async function GET(req: Request) {
  return runRoute(async () => {
    const user = await getAuthUser(req);
    const db = getDb();

    const rows = db.agentMessages
      .filter((m) => m.user_id === user.id)
      .sort((a, b) => b.id - a.id) // newest first …
      .slice(0, 100)
      .reverse(); // …then presented oldest-first

    return jsonOk(
      rows.map((m) => ({
        role: m.role,
        content: m.content,
        provider: m.provider,
        created_at: isoNaive(m.created_at),
      })),
    );
  });
}

/* DELETE /api/agent/history — routers/agent.py clear_history */
export async function DELETE(req: Request) {
  return runRoute(async () => {
    const user = await getAuthUser(req);
    clearAgentMessages(getDb(), user.id);
    return jsonOk({ message: "تم مسح المحادثة" });
  });
}
