# UrPay — Worklog

Project: UrPay (أور پاي) — Iraqi agentic payments platform for Zain Hackathon (Section 4).

Architecture:
- Frontend: Next.js 16 (port 3000) — SPA at `/` with client-side views (landing → auth → dashboard).
- Backend: FastAPI Python service at `mini-services/urpay-backend/` (port 8000), SQLite at `db/urpay.db`.
- Next.js `/api/[...path]` proxies to FastAPI (server-side fetch to localhost:8000) — works in sandbox and locally.
- Bill Pay Agent: Groq `openai/gpt-oss-120b` (native function calling) → fallback z-ai bridge (`/api/internal/llm` Node route using z-ai-web-dev-sdk) → deterministic Arabic intent engine (always works offline).
- Design: Inter Tight 700 (display) + IBM Plex Sans Arabic (body), emerald/gold/ink palette, RTL-first Arabic UI.
- Local run: `start.bat` (Windows) starts uvicorn :8000 + next dev :3000.

Status: initialized — starting backend build.

---
Task ID: 12
Agent: pptx-slides-agent
Task: Create 2 English competition slides (UrPay-Slides.pptx)

Work Log:
- Loaded pptx skill and read worklog.md for project context (UrPay brand, palette, stack).
- Wrote /home/z/my-project/build_urpay_slides.py — a native python-pptx build script (no HTML route) producing a real 16:9 (13.333×7.5 in) deck in the emerald/gold/paper brand palette (no blue/purple), Arial grotesk typography, matching gold edge bar + hairline footer style on both slides.
- Slide 1 (title): emerald rounded-square logo w/ gold "U" + gold sun-dot, UrPay wordmark ("Ur" emerald / "Pay" gold), Arabic "أور پاي" top-right, bronze caps eyebrow "IRAQ'S AGENTIC PAYMENT PLATFORM", hero tagline "Every bill. / One conversation." (48pt, ink + emerald), gold rule, Ur-origin subtitle, white PROBLEM card + solid-emerald SOLUTION card (right column), 4 gold-bordered pill stat chips, footer "Zain Hackathon · Section 4 — Bill Pay Agent · 2026" + page 01.
- Slide 2 (content): eyebrow "HOW UR WORKS" + 30pt title "The Agentic Payment Loop" + mini logo/wordmark top-right; 4-step agent loop as white cards (01 Understand / 02 Verify / 03 Authorize / 04 Execute & Receipt) with emerald number chips and gold chevron arrows; TECH STACK row of 5 dark ink pills (FastAPI, SQLite, Next.js 16, Groq gpt-oss-120b, Function Calling); gold-tint SECURITY & DATA box (PBKDF2/JWT/masked PIN/100 seeded users); dark ink chat mockup card with USER/UR tags and 3 lines (Arabic bill request → PIN prompt → ✅ paid + receipt UR-8XK2F3); footer with demo card/PIN/urpay.iq + page 02.
- Saved to /home/z/my-project/public/UrPay-Slides.pptx; validated by reopening with python-pptx (slide count = 2, all shapes in bounds, verbatim text dump OK) and by LibreOffice PDF conversion (renders cleanly as exactly 2 pages).

Stage Summary:
- File created: /home/z/my-project/public/UrPay-Slides.pptx (33 KB, 2 slides, 16:9 widescreen, real .pptx built with python-pptx).
- Key design decisions: single strong emerald color block per slide (solution card / loop number chips) on warm paper background; gold reserved for accents (edge bar, rules, chevrons, chip borders, chat highlights); deep-bronze gold variant for small text to keep AA contrast; dark ink reserved for tech pills + chat mockup; identical footer system (hairline + muted caption + bronze page number) across both slides for cohesion.

---
Task ID: 1-11, 13-14 (main build)
Agent: Z.ai Code (main orchestrator)
Task: Build the complete UrPay platform — FastAPI backend + Next.js frontend + Bill Pay Agent + start.bat + full QA

Work Log:
- Studied the reference repo (github.com/Eyad-Jawad/Zain-Hackathon-Entry): FastAPI + SQLAlchemy + JWT + two-step transfer confirmation pattern adopted.
- Backend (mini-services/urpay-backend, port 8000):
  - models.py: users (triple name, age, city, district, phone, Luhn-valid card, PBKDF2 PIN), bills (6 categories, overdue logic), transactions (shared reference for transfer pairs), transfer_requests, agent_messages.
  - seed.py: 100 realistic Iraqi users (weighted governorates, correct Arabic triple-name convention — grandfather name is male, tribal family names 38%, Luhn-valid cards 4539/5512/5210, real carrier prefixes Zain/Asiacell/Korek), 646 bills (302 paid, 344 unpaid incl. overdue), 814 transactions with consistent running balances (overdraft guard + rescue topups). Demo user: أحمد علي حسين / 4539 1234 1234 1234 / PIN 1234. All seeded PINs = 1234.
  - routers/: auth (register/login/me, welcome balance 250k + 3 starter bills), wallet (bills, pay-with-PIN, simulate bill, transactions, user search, transfer request→confirm with PIN), agent (chat/history/clear with PIN masking in stored messages), public (stats/billers/cities/health).
  - agent/: engine.py — agentic loop (max 6 rounds) with tool execution; providers.py — Groq (openai/gpt-oss-120b, native function calling) → z-ai bridge (http://127.0.0.1:3000/api/internal/llm) → deterministic Arabic intent engine; tools.py — get_balance, list_bills, pay_bill, search_users, transfer_money, recent_transactions, get_profile.
  - SECURITY FIX: pay_bill now takes a `hint` param (category/biller words from user's message) and REJECTS wrong-bill payments (wrong_bill guard) — added after observing the LLM pay the wrong bill during E2E testing.
- Frontend (Next.js 16, port 3000, SPA at /):
  - Fonts: Inter Tight (400-700) + IBM Plex Sans Arabic (300-700) via next/font, RTL-first, lang=ar.
  - globals.css: Mesopotamian palette (paper oklch .984/.004/95, emerald primary #0E7A5C-family, gold #CBA135, night #1B211E), custom utilities: .font-display, .num (tabular), .grain, .pattern-ur (cuneiform wedge/dot SVG pattern), .text-gold-gradient, .scrollbar-slim, .shadow-lift, marquee/float/pulse-dot animations.
  - Brand: SVG UrPayMark (emerald rounded square + gold U + sun-dot), favicon at src/app/icon.svg.
  - Views: Landing (nav, hero with animated agent-chat phone mockup, live stats from API, billers marquee, features, 6 categories, dark agent section with tool-call flow card, how-it-works, security, CTA, footer with slides download), Auth (login + register with triple name/age/city select/phone/card/PIN+confirm, demo autofill), Dashboard (sidebar desktop + bottom nav mobile, 6 tabs: overview/bills/transfer/agent/transactions/profile), Overview (dark balance hero, overdue alert, quick-pay PIN dialog with receipt, recent txns, agent teaser), Bills (tabs, PIN OTP dialog, simulate-bill generator), Transfer (debounced live user search, quick amounts, PIN confirm), Agent chat (bubbles, typing indicator, provider badge, receipt cards for executed payments, suggestion chips), Transactions (filters + totals), Profile.
  - API layer: src/lib/urpay.ts typed client with auto-logout on 401; zustand session store (persisted).
  - Next.js routes: /api/[...path] catch-all proxy → FastAPI :8000 (single-origin, works locally + sandbox); /api/internal/llm z-ai bridge (secret header) + /api/internal/health.
- start.bat (Windows one-click): venv + pip install + seed + uvicorn :8000 + next dev :3000 + browser open + demo credentials printed. README.md with full docs.
- QA via agent-browser + VLM (multiple passes):
  - Landing rated 9/10 by VLM, RTL flawless, no glitches.
  - FIXED: Turbopack stale CSS cache (old globals.css served after edits → killed server, wiped .next, restarted; palette then rendered correctly everywhere).
  - FIXED: proxy was dropping the /api prefix (404s).
  - FIXED: transactions.reference UNIQUE constraint broke transfers (out+in share one ref) → dropped unique, reseeded, verified E2E.
  - FIXED: agent paid wrong bill → hint validation + prompt rule 8; verified correct water/electricity payments E2E.
  - FIXED: react-hooks/set-state-in-effect lint errors (derived-during-render patterns).
  - Verified E2E in browser: demo login → dashboard → PIN bill payment + receipt → agent chat (Z-AI Bridge) pays overdue electricity bill with correct matching → user search + transfer with PIN → registration of new user (مصطفى جاسم العاني) with welcome balance + starter bills → 401 auto-logout → mobile 390px (no horizontal overflow, dark hero renders, bottom nav) → sticky footer (mt-auto, pushed naturally on long content).

Stage Summary:
- Fully working platform: FastAPI :8000 + Next.js :3000 + agent (z-ai bridge active in sandbox; Groq gpt-oss-120b when GROQ_API_KEY set locally; local Arabic engine as final fallback).
- 100 realistic Iraqi users seeded; all flows (register/login/bills/pay/transfer/agent/history) verified in browser.
- Lint clean; dev.log clean (200s across all endpoints).
- public/UrPay-Slides.pptx (2 English slides) + footer download link.
- start.bat + README.md for local Windows run.

Unresolved / next-phase recommendations:
- PinDialog onComplete double-fire guard (minor UX: submitting via auto-complete + button click).
- Transfer pending requests have no TTL cleanup (reference repo used 24h expiry).
- Could add: agent streaming responses, spend analytics chart, dark mode toggle, Arabic-English UI toggle.
- When user runs locally with GROQ_API_KEY, verify native tool-calling loop once with a real key (sandbox has no Groq key — z-ai bridge is the active provider here).
