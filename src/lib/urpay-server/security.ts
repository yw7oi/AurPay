/* Security helpers: PIN hashing + JWT tokens — port of app/security.py.
 * HS256 JWT is implemented manually with node:crypto (no dependencies). */

import { createHmac, pbkdf2Sync, randomBytes, randomInt, timingSafeEqual } from "crypto";

const JWT_SECRET =
  process.env.URPAY_JWT_SECRET ?? "urpay-demo-secret-change-me";
const JWT_EXPIRE_DAYS = 7;

/* ------------------------------------------------------------------ PIN --- */

export function hashPin(pin: string, salt: string): string {
  return pbkdf2Sync(pin, salt, 60_000, 32, "sha256").toString("hex");
}

export function makePinSecret(pin: string): { salt: string; hash: string } {
  const salt = randomBytes(16).toString("hex"); // 32 hex chars
  return { salt, hash: hashPin(pin, salt) };
}

export function verifyPin(pin: string, salt: string, expected: string): boolean {
  const actual = hashPin(pin, salt);
  if (actual.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ JWT --- */

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function hmacSign(data: string): string {
  return createHmac("sha256", JWT_SECRET).update(data).digest("base64url");
}

/** Returns [token, expiresAtEpochMs] */
export function createToken(userId: number): { token: string; expMs: number } {
  const expMs = Date.now() + JWT_EXPIRE_DAYS * 86_400_000;
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ sub: String(userId), exp: Math.floor(expMs / 1000) }),
  );
  const signature = hmacSign(`${header}.${payload}`);
  return { token: `${header}.${payload}.${signature}`, expMs };
}

/** Verify signature + expiry; return the user id or null. */
export function decodeToken(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  if (hmacSign(`${header}.${payload}`) !== signature) return null;
  let claims: { sub?: string; exp?: number };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims.sub !== "string") return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return null;
  const id = Number(claims.sub);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Random uppercase-alphanumeric transaction reference — port of _ref()
 * (Python: secrets.choice over A-Z0-9, 8 chars). */
export function newRef(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += alphabet[randomInt(0, alphabet.length)];
  }
  return `UR-${out}`;
}

/** Random n-digit decimal string (crypto-backed). */
export function randomDigits(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += String(randomInt(0, 10));
  return out;
}
