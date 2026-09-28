import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 60s — LLM bridge calls need the headroom
export const maxDuration = 60;

const SECRET = process.env.URPAY_BRIDGE_SECRET ?? "urpay-bridge-secret";

export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-bridge-secret");
  if (provided !== SECRET) {
    return Response.json({ detail: "unauthorized bridge call" }, { status: 401 });
  }

  let messages: { role: string; content: string }[] = [];
  let toolSchemaText = "";
  try {
    const body = await req.json();
    messages = Array.isArray(body.messages) ? body.messages : [];
    toolSchemaText = typeof body.tool_schema_text === "string" ? body.tool_schema_text : "";
  } catch {
    return Response.json({ detail: "invalid json body" }, { status: 400 });
  }

  if (messages.length === 0) {
    return Response.json({ detail: "messages required" }, { status: 400 });
  }

  try {
    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();

    const completion = await zai.chat.completions.create({
      messages: messages.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      })),
      thinking: { type: "disabled" },
    });

    const content = completion.choices?.[0]?.message?.content ?? "";
    return Response.json({ content });
  } catch (err) {
    const message = err instanceof Error ? err.message : "bridge failure";
    return Response.json({ detail: message }, { status: 502 });
  }
}
