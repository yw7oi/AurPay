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
REM  Backend port: 8000 by default. To use another port, set
REM                URPAY_BACKEND_URL before running, e.g.:
REM                  set URPAY_BACKEND_URL=http://localhost:9000
REM                (uvicorn below must be started on the same port)
REM ---------------------------------------------------------------

cd /d "%~dp0"

REM ---------- 1) Backend: FastAPI on port 8000 -------------------
echo  [1/3] Preparing the FastAPI backend (port 8000)...
if not exist "mini-services\urpay-backend\venv" (
    echo        Creating Python virtual environment...
    python -m venv mini-services\urpay-backend\venv
)

call mini-services\urpay-backend\venv\Scripts\activate.bat

echo        Installing backend dependencies (greenlet, multipart, ...)...
python -m pip install -q -r mini-services\urpay-backend\requirements.txt

if not exist "db" mkdir "db"

REM NOTE: no manual seeding needed — the backend creates and seeds the
REM database (100 Iraqi users + demo fixtures) automatically on startup.

echo        Starting uvicorn (backend)...
start "UrPay Backend :8000" cmd /k "cd /d %~dp0mini-services\urpay-backend && call venv\Scripts\activate.bat && set URPAY_DB=%~dp0db\urpay.db && python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

REM ---------- 2) Frontend: Next.js on port 3000 ------------------
echo  [2/3] Preparing the Next.js frontend (port 3000)...

where bun >nul 2>nul
if %errorlevel%==0 (
    echo        Using Bun...
    if not exist "node_modules" (
        echo        Installing frontend packages - first run may take a few minutes...
        bun install
    )
    start "UrPay Frontend :3000" cmd /k "cd /d %~dp0 && set URPAY_BACKEND_URL=http://127.0.0.1:8000 && bun scripts/dev.mjs"
) else (
    where npm >nul 2>nul
    if %errorlevel%==0 (
        echo        Using npm...
        if not exist "node_modules" (
            echo        Installing frontend packages - first run may take a few minutes...
            npm install
        )
        start "UrPay Frontend :3000" cmd /k "cd /d %~dp0 && set URPAY_BACKEND_URL=http://127.0.0.1:8000 && node scripts/dev.mjs"
    ) else (
        echo  [ERROR] Neither Bun nor Node.js was found!
        echo          Install Node.js 18+ from https://nodejs.org then re-run.
        pause
        exit /b 1
    )
)

REM ---------- 3) Wait for both services, then open browser -------
echo  [3/3] Waiting for both services to come up...

powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(90); $ok=$false; while((Get-Date) -lt $deadline -and -not $ok){ $f=$false; $b=$false; try{ (Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000' -TimeoutSec 2).StatusCode | Out-Null; $f=$true }catch{}; try{ (Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:8000/api/health' -TimeoutSec 2).StatusCode | Out-Null; $b=$true }catch{}; if($f -and $b){ $ok=$true } else { Start-Sleep -Seconds 1 } }; if($ok){ exit 0 } else { exit 1 }" >nul 2>nul
if errorlevel 1 (
    echo        Still warming up - giving it a few more seconds...
    timeout /t 10 /nobreak >nul
)

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
echo.
echo    Custom backend port? set URPAY_BACKEND_URL first
echo    (and start uvicorn on that port).
echo  ============================================================
echo.

start http://localhost:3000

echo  Press any key to close this launcher (services keep running)...
pause >nul
