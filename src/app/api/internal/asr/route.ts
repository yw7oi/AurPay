import { NextRequest } from "next/server";
import { transcribeAudio } from "@/lib/urpay-server/asr";

export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 60s — audio transcription can take a while
export const maxDuration = 60;

const SECRET = process.env.URPAY_BRIDGE_SECRET ?? "urpay-bridge-secret";
/* audio bigger than ~20MB base64 is rejected outright */
const MAX_BASE64_LEN = 28_000_000;

/* POST /api/internal/asr — HTTP wrapper around the shared in-process
 * transcriber (kept for backwards compatibility with older clients and for
 * remote-bridge setups that POST audio_base64 directly). */
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-bridge-secret");
  if (provided !== SECRET) {
    return Response.json({ detail: "unauthorized bridge call" }, { status: 401 });
  }

  let audioBase64 = "";
  try {
    const body = await req.json();
    audioBase64 = typeof body.audio_base64 === "string" ? body.audio_base64 : "";
  } catch {
    return Response.json({ detail: "invalid json body" }, { status: 400 });
  }

  if (!audioBase64) {
    return Response.json({ detail: "audio_base64 required" }, { status: 400 });
  }
  if (audioBase64.length > MAX_BASE64_LEN) {
    return Response.json({ detail: "audio too large" }, { status: 413 });
  }

  try {
    const bytes = new Uint8Array(Buffer.from(audioBase64, "base64"));
    const text = await transcribeAudio(bytes, "audio/wav");
    return Response.json({ text });
  } catch (err) {
    const status = typeof err === "object" && err && "status" in err ? Number((err as { status: number }).status) : 502;
    const message = err instanceof Error ? err.message : "asr bridge failure";
    return Response.json({ detail: message }, { status });
  }
}
