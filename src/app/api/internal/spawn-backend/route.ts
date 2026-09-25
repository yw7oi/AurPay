import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const SECRET = process.env.URPAY_BRIDGE_SECRET ?? "urpay-bridge-secret";

/** Is something already listening on the backend port? */
async function backendUp(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:8000/api/health", {
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * POST /api/internal/spawn-backend
 * Bridge-secret-guarded supervisor: starts the FastAPI backend as a detached
 * child of the Next.js server process (so it survives agent tool-call
 * cleanup in the sandbox) if it isn't already listening on :8000.
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-bridge-secret");
  if (provided !== SECRET) {
    return Response.json({ detail: "unauthorized bridge call" }, { status: 401 });
  }

  if (await backendUp()) {
    return Response.json({ status: "already-running" });
  }

  const projectRoot = process.cwd();
  const backendDir = path.join(projectRoot, "mini-services", "urpay-backend");
  if (!existsSync(path.join(backendDir, "app", "main.py"))) {
    return Response.json({ detail: "backend directory not found" }, { status: 404 });
  }

  const logDir = "/tmp";
  try {
    mkdirSync(logDir, { recursive: true });
  } catch { /* exists */ }
  const out = openSync(`${logDir}/urpay-backend.log`, "a");

  const env = {
    ...process.env,
    URPAY_DB: process.env.URPAY_DB ?? path.join(projectRoot, "db", "urpay.db"),
  };

  try {
    const child = spawn(
      process.platform === "win32" ? "python" : "python3",
      ["-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"],
      {
        cwd: backendDir,
        env,
        detached: true,
        stdio: ["ignore", out, out],
      },
    );
    child.unref();

    // wait briefly for the port to come up so the caller gets a truthful status
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await backendUp()) {
        return Response.json({ status: "started", pid: child.pid });
      }
    }
    return Response.json({ status: "spawned-but-slow", pid: child.pid });
  } catch (err) {
    const message = err instanceof Error ? err.message : "spawn failure";
    return Response.json({ detail: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  // health-probe variant (also secret-guarded)
  const provided = req.headers.get("x-bridge-secret");
  if (provided !== SECRET) {
    return Response.json({ detail: "unauthorized bridge call" }, { status: 401 });
  }
  return Response.json({ up: await backendUp() });
}
