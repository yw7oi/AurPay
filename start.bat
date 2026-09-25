@echo off
chcp 65001 >nul
title UrPay - Iraqi Agentic Payments Platform
color 0A

echo.
echo  ============================================================
echo    UrPay  -  أور پاي
echo    Iraqi Agentic Payments Platform  (Zain Hackathon - S4)
echo  ============================================================
echo.

REM ---------------------------------------------------------------
REM  Requirements: Python 3.10+ AND Node.js 18+ (or Bun) installed
REM  Optional    : set GROQ_API_KEY to enable the real Groq agent
REM                (model: openai/gpt-oss-120b)
REM ---------------------------------------------------------------

cd /d "%~dp0"

REM ---------- 1) Backend: FastAPI on port 8000 -------------------
echo  [1/3] Preparing the FastAPI backend (port 8000)...
if not exist "mini-services\urpay-backend\venv" (
    echo        Creating Python virtual environment...
    python -m venv mini-services\urpay-backend\venv
)

call mini-services\urpay-backend\venv\Scripts\activate.bat
pip install -q -r mini-services\urpay-backend\requirements.txt

if not exist "db" mkdir "db"

echo        Seeding database (100 Iraqi users) if empty...
python -c "import sys; sys.path.insert(0, 'mini-services/urpay-backend'); from app.seed import seed_if_empty; import asyncio; from app.db import init_db, session_factory; asyncio.run(init_db()); asyncio.run(seed_if_empty(session_factory().__enter__()()))" 2>nul

echo        Starting uvicorn (backend)...
start "UrPay Backend :8000" cmd /k "cd /d %~dp0mini-services\urpay-backend && call venv\Scripts\activate.bat && set URPAY_DB=%~dp0db\urpay.db && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

REM ---------- 2) Frontend: Next.js on port 3000 ------------------
echo  [2/3] Preparing the Next.js frontend (port 3000)...

where bun >nul 2>nul
if %errorlevel%==0 (
    echo        Using Bun...
    if not exist "node_modules" bun install
    start "UrPay Frontend :3000" cmd /k "cd /d %~dp0 && set URPAY_BACKEND_URL=http://127.0.0.1:8000 && bun run dev"
) else (
    where npm >nul 2>nul
    if %errorlevel%==0 (
        echo        Using npm...
        if not exist "node_modules" npm install
        start "UrPay Frontend :3000" cmd /k "cd /d %~dp0 && set URPAY_BACKEND_URL=http://127.0.0.1:8000 && npm run dev -- -p 3000"
    ) else (
        echo  [ERROR] Neither Bun nor Node.js was found!
        echo          Install Node.js 18+ from https://nodejs.org then re-run.
        pause
        exit /b 1
    )
)

REM ---------- 3) Open the browser --------------------------------
echo  [3/3] Waiting for services to boot...
timeout /t 8 /nobreak >nul

echo.
echo  ============================================================
echo   UrPay is running!
echo.
echo    Frontend :  http://localhost:3000
echo    Backend  :  http://localhost:8000/docs   (FastAPI docs)
echo.
echo    Demo login:
echo      Card : 4539 1234 1234 1234
echo      PIN  : 1234
echo.
echo    (any of the 100 seeded users works with PIN 1234)
echo.
echo    To enable the real Groq agent, stop the backend and
echo    re-run this file after:
echo       set GROQ_API_KEY=your_key_here
echo  ============================================================
echo.

start http://localhost:3000

echo  Press any key to close this launcher (services keep running)...
pause >nul
