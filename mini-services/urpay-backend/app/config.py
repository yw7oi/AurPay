"""UrPay backend configuration."""
import os
from pathlib import Path

# mini-services/urpay-backend/app/config.py -> repo root is 3 levels up
ROOT = Path(__file__).resolve().parents[3]

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
