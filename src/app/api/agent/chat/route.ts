import { err, getAuthUser, jsonOk, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb, addAgentMessage } from "@/lib/urpay-server/store";
import { runAgent, maskForCompare } from "@/lib/urpay-server/agent/engine";

export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 60s — the LLM agent loop needs the full headroom
export const maxDuration = 60;

/* POST /api/agent/chat — routers/agent.py agent_chat
 * Persists the PIN-masked user turn, runs the agent, persists the assistant
 * reply with its provider tag. In-memory rows are live — nothing to refresh. */
export async function POST(req: Request) {
  return runRoute(async () => {
    const body = await parseJsonBody<{ message?: unknown }>(req);
    const user = getAuthUser(req);

    const message =
      typeof body.message === "string" ? body.message : "";
    if (message.length < 1 || message.length > 2000) {
      return err(422, "الرسالة لازم تكون بين 1 و 2000 حرف");
    }

    const db = getDb();
    addAgentMessage(db, user.id, "user", maskForCompare(message.trim()));

    const { reply, actions, provider } = await runAgent(db, user, message);

    addAgentMessage(db, user.id, "assistant", reply, provider);

    return jsonOk({
      reply,
      actions: actions.map((a) => ({
        tool: a.tool,
        ok: a.ok,
        data: a.data ?? null,
        error: a.error ?? null,
      })),
      provider,
    });
  });
}
