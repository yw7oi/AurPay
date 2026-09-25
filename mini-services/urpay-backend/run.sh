#!/usr/bin/env bash
# Run the UrPay FastAPI backend on port 8000 (sandbox / linux / mac)
cd "$(dirname "$0")"
export URPAY_DB="${URPAY_DB:-$(cd ../.. && pwd)/db/urpay.db}"
mkdir -p "$(dirname "$URPAY_DB")"
exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
