import { err, getAuthUser, jsonOk, runRoute } from "@/lib/urpay-server/http";
import { transcribeAudio, AsrError } from "@/lib/urpay-server/asr";

export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 60s — Whisper transcription can take a while
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024; // 20MB

/* POST /api/agent/voice — routers/agent.py agent_voice (multipart "file")
 *
 * Transcribes the recording in-process:
 *   Groq Whisper (GROQ_API_KEY_1..5 — same pool as the chat agent) →
 *   z-ai SDK (sandbox) → friendly Arabic error.
 * No localhost HTTP hop (that would be unreachable on serverless); the
 * browser already re-encodes exotic formats to 16-bit WAV client-side
 * (urpay.ts blobToWav). */
export async function POST(req: Request) {
  return runRoute(async () => {
    const user = await getAuthUser(req);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return err(400, "طلب غير صالح");
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return err(422, "الملف مطلوب");
    }

    const raw = new Uint8Array(await file.arrayBuffer());
    if (raw.length === 0) {
      return err(400, "الملف فاضي");
    }
    if (raw.length > MAX_BYTES) {
      return err(413, "التسجيل طويل جدًا");
    }

    try {
      const text = await transcribeAudio(raw, file.type || "audio/wav");
      if (!text) return err(422, "ما سمعنا صوت واضح — جرب مرة ثانية");
      return jsonOk({ text });
    } catch (e) {
      let detail =
        e instanceof AsrError || e instanceof Error
          ? e.message
          : "تعذر تحويل الصوت لنص";
      // translate raw upstream hiccups into friendly Arabic
      const low = detail.toLowerCase();
      if (
        low.includes("429") ||
        low.includes("too many requests") ||
        low.includes("rate limit")
      ) {
        detail = "الخدمة مشغولة الآن — استنى ثواني وحاول مرة ثانية";
      } else if (low.includes("unsupported audio format")) {
        detail = "صيغة الصوت غير مدعومة — جرّب متصفح كروم أو حدّث المتصفح";
      } else {
        detail = "تعذر الوصول لخدمة التعرف على الصوت — جرب مرة ثانية";
      }
      return err(502, detail);
    }
  });
}
