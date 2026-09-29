import { getAuthUser, jsonOk, runRoute } from "@/lib/urpay-server/http";
import { groqPoolStatus, groqTotals } from "@/lib/urpay-server/agent/providers";

export const dynamic = "force-dynamic";

/* GET /api/agent/usage — routers/agent.py agent_usage
 * Groq key-pool status + token accounting (transparency for spend). */
export async function GET(req: Request) {
  return runRoute(async () => {
    await getAuthUser(req);
    return jsonOk({
      groq_keys: groqPoolStatus(),
      totals: groqTotals(),
    });
  });
}
