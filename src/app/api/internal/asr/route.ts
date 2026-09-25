import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const SECRET = process.env.URPAY_BRIDGE_SECRET ?? "urpay-bridge-secret";
/* audio bigger than ~20MB base64 is rejected outright */
const MAX_BASE64_LEN = 28_000_000;

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
    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();

    const response = await zai.audio.asr.create({
      file_base64: audioBase64,
    });

    const text = (response.text ?? "").trim();
    return Response.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "asr bridge failure";
    return Response.json({ detail: message }, { status: 502 });
  }
}
