import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
}
// TLS is configured below, so the sslmode in Neon's URL is dropped to avoid the two settings disagreeing.
const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete("sslmode");
const connectionString = url.toString();

// Hosted databases (Neon on Vercel) need TLS; the local PostgreSQL server does not.
const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(connectionString);

// Serverless functions run many short-lived copies, so each one keeps a small pool.
export const pool = new pg.Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: true },
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 8_000
});

export const query = (text, params) => pool.query(text, params);
