#!/usr/bin/env python3
"""Build a clean, valid, Windows-friendly UrPay project zip.

Usage: python3 scripts/make_zip.py [output.zip]

- Everything is packed under a single top-level folder (UrPay/) so
  "Extract Here" stays tidy.
- start.bat is normalized to CRLF line endings (cmd.exe safest).
- run.sh keeps LF; .py files keep LF; source encoding preserved (UTF-8).
- The live SQLite db is snapshotted via the sqlite3 backup API (consistent
  even while the backend is running).
- Excluded: node_modules, .next, venv, __pycache__, .git, logs, QA dumps,
  workspace-only folders (download/, skills/, examples/, tool-results/).
"""
from __future__ import annotations

import os
import sqlite3
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "download" / "UrPay.zip"

TOP = "UrPay"  # folder inside the zip

# Root files to include (relative to project root).
ROOT_FILES = [
    "start.bat",
    "README.md",
    "package.json",
    "bun.lock",
    ".gitignore",
    ".env",
    "components.json",
    "eslint.config.mjs",
    "next.config.ts",
    "postcss.config.mjs",
    "tsconfig.json",
]

# Whole directories to include (walked recursively).
INCLUDE_DIRS = ["src", "public", "scripts", "prisma"]

# Backend pieces (app/ walked for *.py only, plus root files).
BACKEND = Path("mini-services") / "urpay-backend"
BACKEND_FILES = ["requirements.txt", "run.sh", "package.json"]

SKIP_DIRS = {"node_modules", ".next", "venv", "__pycache__", ".git", ".turbo"}
SKIP_SUFFIXES = (".pyc", ".pyo", ".log", ".lock~")
SKIP_NAMES = {".DS_Store", "Thumbs.db"}

CRLF_SUFFIXES = (".bat", ".cmd")


def should_skip(p: Path) -> bool:
    if p.name in SKIP_NAMES:
        return True
    if p.suffix in SKIP_SUFFIXES:
        return True
    return any(part in SKIP_DIRS for part in p.parts)


def read_maybe_crlf(p: Path) -> bytes:
    data = p.read_bytes()
    if p.suffix.lower() in CRLF_SUFFIXES:
        # normalize to CRLF for Windows cmd.exe (idempotent: strip CR first)
        data = data.replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
    return data


def snapshot_sqlite(src: Path) -> bytes:
    """Consistent in-memory snapshot of a (possibly live) SQLite db."""
    tmp = src.with_suffix(src.suffix + ".snapshot")
    src_conn = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
    dst_conn = sqlite3.connect(tmp)
    with dst_conn:
        src_conn.backup(dst_conn)
    src_conn.close()
    dst_conn.close()
    data = tmp.read_bytes()
    tmp.unlink()
    return data


def add(zf: zipfile.ZipFile, arcname: str, data: bytes, mtime: float) -> None:
    info = zipfile.ZipInfo(f"{TOP}/{arcname}", date_time=mtimestamp(mtime))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16
    zf.writestr(info, data)


def mtimestamp(mtime: float):
    import time

    t = time.localtime(mtime)
    return (t.tm_year, t.tm_mon, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec)


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        # root files
        for rel in ROOT_FILES:
            p = ROOT / rel
            if not p.exists():
                print(f"  ! missing (skipped): {rel}")
                continue
            add(zf, rel, read_maybe_crlf(p), p.stat().st_mtime)
            count += 1

        # included directories
        for d in INCLUDE_DIRS:
            base = ROOT / d
            if not base.exists():
                continue
            for p in sorted(base.rglob("*")):
                if p.is_dir() or should_skip(p):
                    continue
                rel = p.relative_to(ROOT).as_posix()
                add(zf, rel, read_maybe_crlf(p), p.stat().st_mtime)
                count += 1

        # database — consistent snapshots
        db_dir = ROOT / "db"
        db_dir.mkdir(exist_ok=True)
        urpay_db = db_dir / "urpay.db"
        if urpay_db.exists():
            add(zf, "db/urpay.db", snapshot_sqlite(urpay_db), urpay_db.stat().st_mtime)
            count += 1
        custom_db = db_dir / "custom.db"
        if custom_db.exists():
            add(zf, "db/custom.db", custom_db.read_bytes(), custom_db.stat().st_mtime)
            count += 1

        # backend
        for p in sorted((ROOT / BACKEND / "app").rglob("*.py")):
            if should_skip(p):
                continue
            rel = p.relative_to(ROOT).as_posix()
            add(zf, rel, p.read_bytes(), p.stat().st_mtime)
            count += 1
        for rel in BACKEND_FILES:
            p = ROOT / BACKEND / rel
            if p.exists():
                add(zf, p.relative_to(ROOT).as_posix(), p.read_bytes(), p.stat().st_mtime)
                count += 1

    size = OUT.stat().st_size
    print(f"OK  {OUT}  ({count} files, {size / 1024 / 1024:.2f} MB)")


if __name__ == "__main__":
    main()
