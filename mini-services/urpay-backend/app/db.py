"""Database engine/session management."""
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .config import DB_PATH
from .models import Base

DB_PATH.parent.mkdir(parents=True, exist_ok=True)

engine = create_async_engine(
    f"sqlite+aiosqlite:///{DB_PATH}",
    echo=False,
    connect_args={"timeout": 30},
)

session_factory = async_sessionmaker(engine, expire_on_commit=False)

# lightweight column migrations (ALTER TABLE ADD COLUMN) — SQLite create_all
# cannot add columns to existing tables. (name, DDL) pairs applied when missing.
_COLUMN_MIGRATIONS = [
    ("users", "failed_attempts", "ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0"),
    ("users", "ban_count", "ALTER TABLE users ADD COLUMN ban_count INTEGER NOT NULL DEFAULT 0"),
    ("users", "locked_until", "ALTER TABLE users ADD COLUMN locked_until DATETIME"),
]


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for table, column, ddl in _COLUMN_MIGRATIONS:
            exists = await conn.run_sync(
                lambda sync_conn, t=table, c=column:
                any(col["name"] == c for col in inspect(sync_conn).get_columns(t))
            )
            if not exists:
                await conn.execute(text(ddl))
        # migrations that rewrite rows (one-time flags keyed in a tiny meta table)
        await _migrate_rows(conn)


async def _migrate_rows(conn) -> None:
    """One-time data migrations (guarded by a meta table so they run once)."""
    await conn.execute(
        text("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE)"))
    done = {
        row[0] for row in (
            await conn.execute(text("SELECT name FROM _migrations"))).fetchall()
    }

    if "pin_6_digits" not in done:
        # PIN policy moved from 4-6 to exactly 6 digits — re-issue every
        # account with the demo PIN 123456 (hash freshly generated per row so
        # salts stay unique).
        from .security import make_pin_secret
        ids = [row[0] for row in (
            await conn.execute(text("SELECT id FROM users"))).fetchall()]
        for uid in ids:
            salt, pin_hash = make_pin_secret("123456")
            await conn.execute(
                text("UPDATE users SET pin_salt=:s, pin_hash=:h WHERE id=:i"),
                {"s": salt, "h": pin_hash, "i": uid})
        await conn.execute(
            text("INSERT OR IGNORE INTO _migrations (name) VALUES ('pin_6_digits')"))

    if "zain_only_telecom" not in done:
        # Telecom billers trimmed to Zain only — rename stray Asiacell/Korek
        # rows so old databases stay consistent with the biller catalog.
        await conn.execute(text(
            "UPDATE bills SET biller_name='زين العراق Zain Iraq', biller_code='TEL-ZAIN' "
            "WHERE biller_name LIKE '%آسياسيل%' OR biller_name LIKE '%كورك%'"))
        await conn.execute(text(
            "UPDATE transactions SET title='شحن رصيد زين العراق Zain Iraq' "
            "WHERE title LIKE '%آسياسيل%' OR title LIKE '%كورك%'"))
        await conn.execute(
            text("INSERT OR IGNORE INTO _migrations (name) VALUES ('zain_only_telecom')"))


async def get_session():
    async with session_factory() as session:
        yield session
