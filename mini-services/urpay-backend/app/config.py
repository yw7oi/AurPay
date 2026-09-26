"""UrPay backend configuration."""
import os
from pathlib import Path

# mini-services/urpay-backend/app/config.py -> repo root is 3 levels up
ROOT = Path(__file__).resolve().parents[3]


def _load_env_file(path: Path) -> None:
    """Tiny .env loader (no dependencies).

    Reads KEY=VALUE lines from the project-root .env and fills any variables
    that are NOT already set in the environment — so `set GROQ_API_KEY=...`
    still wins over the file. Comments (#) and blank lines are ignored.
    """
    if not path.is_file():
        return
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except OSError:
        pass  # unreadable .env — behave as if absent


# Drop your GROQ_API_KEY in <project root>/.env — one line, done:
#   GROQ_API_KEY=gsk_...
_load_env_file(ROOT / ".env")

DB_PATH = Path(os.environ.get("URPAY_DB", str(ROOT / "db" / "urpay.db")))
JWT_SECRET = os.environ.get("URPAY_JWT_SECRET", "urpay-demo-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 7

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_BASE_URL = os.environ.get("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
AGENT_MODEL = os.environ.get("URPAY_AGENT_MODEL", "openai/gpt-oss-120b")

# Node bridge (Next.js /api/internal/llm using z-ai-web-dev-sdk)
LLM_BRIDGE_URL = os.environ.get("URPAY_LLM_BRIDGE", "http://127.0.0.1:3000/api/internal/llm")
LLM_BRIDGE_SECRET = os.environ.get("URPAY_BRIDGE_SECRET", "urpay-bridge-secret")

WELCOME_BALANCE = 250_000  # IQD credited to newly registered users (demo wallet)
