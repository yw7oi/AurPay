"""UrPay backend — FastAPI app entry point."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db, session_factory
from .routers import agent, auth, public, wallet
from .seed import seed_if_empty

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()
    async with session_factory() as session:
        result = await seed_if_empty(session)
        logging.getLogger("urpay").info("DB ready: %s", result)
    yield


app = FastAPI(
    title="UrPay API",
    description="UrPay (أور پاي) — Iraqi agentic payments platform backend",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public.router)
app.include_router(auth.router)
app.include_router(wallet.router)
app.include_router(agent.router)


@app.get("/")
async def root():
    return {"service": "UrPay API", "docs": "/docs", "health": "/api/health"}
