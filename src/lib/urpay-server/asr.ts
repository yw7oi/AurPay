/* Speech-to-text for the agent voice input — works serverless (Vercel) AND
 * in the local sandbox, with zero code changes between the two:
 *
 * Provider priority:
 * 1. Groq Whisper (`whisper-large-v3`) — same GROQ_API_KEY_1..5 pool as the
 *    chat agent, so a deployment that has chat also has voice. Handles the
 *    Iraqi-Arabic dialect reasonably well with the `language: "ar"` hint.
 * 2. z-ai bridge SDK (z-ai-web-dev-sdk) — available out of the box inside
 *    the Z.ai sandbox; dynamic import keeps it optional elsewhere.
 *
 * If neither is configured the caller shows a friendly Arabic error.
 *
 * Called in-process by /api/agent/voice (no HTTP hop to localhost — that
 * would be unreachable on serverless). /api/internal/asr keeps the same
 * logic behind an HTTP endpoint for backwards compatibility. */

import { collectGroqKeys, GROQ_BASE_URL } from "@/lib/urpay-server/agent/providers";

export class AsrError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Map the browser mime type to a file extension Groq's parser accepts. */
function fileFor(bytes: Uint8Array, mime: string): File {
  const m = (mime || "").toLowerCase();
  let ext = "wav";
  if (m.includes("webm")) ext = "webm";
  else if (m.includes("mpeg") || m.includes("mp3")) ext = "mp3";
  else if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) ext = "m4a";
  else if (m.includes("ogg")) ext = "ogg";
  else if (m.includes("flac")) ext = "flac";
  return new File([bytes.slice()], `speech.${ext}`, { type: m || "audio/wav" });
}

async function groqAsr(bytes: Uint8Array, mime: string): Promise<string> {
  const keys = collectGroqKeys();
  // Try every key once (simple rotation — 429 on transcription is rare).
  let lastDetail = "";
  for (const key of keys) {
    const form = new FormData();
    form.append("file", fileFor(bytes, mime));
    form.append("model", process.env.URPAY_ASR_MODEL ?? "whisper-large-v3");
    form.append("language", "ar");
    form.append("temperature", "0");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const resp = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: controller.signal,
      });
      if (resp.status === 429) {
        lastDetail = "too many requests";
        continue; // next key
      }
      if (!resp.ok) {
        throw new AsrError(502, await safeText(resp));
      }
      const data = (await resp.json()) as { text?: string };
      return (data.text ?? "").trim();
    } catch (e) {
      if (e instanceof AsrError) throw e;
      lastDetail = e instanceof Error ? e.message : "network error";
    } finally {
      clearTimeout(timer);
    }
  }
  throw new AsrError(
    502,
    lastDetail.includes("too many requests") ? "too many requests" : lastDetail || "groq asr failed",
  );
}

async function zaiAsr(bytes: Uint8Array): Promise<string> {
  const { default: ZAI } = await import("z-ai-web-dev-sdk");
  const zai = await ZAI.create();
  const response = await zai.audio.asr.create({
    file_base64: Buffer.from(bytes).toString("base64"),
  });
  return (response.text ?? "").trim();
}

/** Transcribe raw audio bytes → Arabic text.
 * @throws AsrError with a `status` suitable for the HTTP response. */
export async function transcribeAudio(
  bytes: Uint8Array,
  mime = "audio/wav",
): Promise<string> {
  if (bytes.length === 0) throw new AsrError(400, "empty audio");

  if (collectGroqKeys().length > 0) {
    try {
      return await groqAsr(bytes, mime);
    } catch (e) {
      // fall through to the z-ai bridge so the user still gets voice input
      console.warn("[urpay-agent] Groq ASR failed:", e);
    }
  }

  try {
    return await zaiAsr(bytes);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "asr failure";
    if (/unsupported audio format/i.test(detail)) {
      throw new AsrError(415, "unsupported audio format");
    }
    throw new AsrError(502, detail);
  }
}

async function safeText(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 300);
  } catch {
    return "";
  }
}
