import { createHmac, createHash, timingSafeEqual } from "node:crypto";

const TOKEN_HOURS = 8;

function secret() {
  const value = process.env.TOKEN_SECRET;
  if (!value || value.length < 32) throw new Error("TOKEN_SECRET must be set to at least 32 characters.");
  return value;
}

const sign = payload => createHmac("sha256", secret()).update(payload).digest("base64url");

// Hashing both sides first gives equal-length buffers, so the comparison takes the same time
// whatever the guess is.
export function passwordMatches(candidate) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof candidate !== "string" || candidate.length > 200) return false;
  const a = createHash("sha256").update(candidate).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function issueToken() {
  const expires = Date.now() + TOKEN_HOURS * 3600_000;
  const payload = Buffer.from(JSON.stringify({ role: "editor", exp: expires })).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, expires };
}

export function verifyToken(token) {
  if (typeof token !== "string") return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}

export function requireEditor(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!verifyToken(token)) {
    return res.status(401).json({ error: "Sign in as an editor to change records." });
  }
  next();
}

// A small in-memory limiter. On Vercel each function copy keeps its own count, which is
// still enough to slow down guessing from one address.
const attempts = new Map();
export function loginLimiter(req, res, next) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter(time => now - time < 15 * 60_000);
  if (recent.length >= 10) {
    return res.status(429).json({ error: "Too many sign-in attempts. Try again in 15 minutes." });
  }
  recent.push(now);
  attempts.set(key, recent);
  next();
}
