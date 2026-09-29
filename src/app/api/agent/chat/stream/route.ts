import { err, getAuthUser, parseJsonBody, runRoute } from "@/lib/urpay-server/http";
import { getDb, addAgentMessage } from "@/lib/urpay-server/store";
import { persistState } from "@/lib/urpay-server/persist";
import { runDueScheduled } from "@/lib/urpay-server/scheduler";
import { runAgent, maskForCompare, TOOL_STEP_LABELS } from "@/lib/urpay-server/agent/engine";

export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 60s — streaming agent replies need the headroom
export const maxDuration = 60;

/** Split the final reply into small chunks for the typewriter effect
 * (routers/agent.py _chunk_words). */
function* chunkWords(text: string, size = 3): Generator<string> {
  const words = text.split(" ");
  for (let i = 0; i < words.length; i += size) {
    yield words.slice(i, i + size).join(" ") + (i + size < words.length ? " " : "");
  }
}

/* POST /api/agent/chat/stream — SSE port of routers/agent.py agent_chat_stream
 *
 * Frames (exactly `event: {name}\ndata: {json}\n\n`, Arabic kept raw):
 *  - `step`  {tool, label}  — live tool progress while the agent works
 *  - `token` {t}            — the final reply, 3 words at a time (45ms)
 *  - `done`  {actions, provider}
 *  - `error` {detail}       — only on unexpected failure
 */
export async function POST(req: Request) {
  return runRoute(async () => {
    const body = await parseJsonBody<{ message?: unknown }>(req);
    const user = getAuthUser(req);

    const message = typeof body.message === "string" ? body.message : "";
    if (message.length < 1 || message.length > 2000) {
      return err(422, "الرسالة لازم تكون بين 1 و 2000 حرف");
    }

    const db = getDb();
    // lazy housekeeping parity with the notifications route (serverless port)
    runDueScheduled(db);
    addAgentMessage(db, user.id, "user", maskForCompare(message.trim()));

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const send = (event: string, data: unknown): void => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
              ),
            );
          } catch {
            closed = true; // client went away — stop writing
          }
        };

        try {
          // step events stream LIVE: the emit callback is wired straight to
          // the SSE writer, so tool progress appears while the agent works
          const emit = (ev: { tool: string }): void => {
            const label = TOOL_STEP_LABELS[ev.tool] ?? "يشتغل…";
            send("step", { tool: ev.tool, label });
          };

          const { reply, actions, provider } = await runAgent(db, user, message, emit);

          addAgentMessage(db, user.id, "assistant", reply, provider);

          for (const chunk of chunkWords(reply)) {
            send("token", { t: chunk });
            await new Promise((r) => setTimeout(r, 45));
          }
          send("done", { actions, provider });
        } catch (e) {
          send("error", {
            detail: e instanceof Error ? e.message : "خطأ بالبث",
          });
        } finally {
          /* the reply + any tool mutations (balances, txns) happened after
           * runRoute already returned — persist them now that the stream is
           * done, so the shared database stays in sync */
          await persistState();
          if (!closed) {
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  });
}
