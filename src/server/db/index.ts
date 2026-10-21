import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Singleton Drizzle client. Uses postgres-js (TCP, no native deps).
 * DATABASE_URL is required; see .env.example / README.
 */

const globalForDb = globalThis as unknown as {
  __argusSql?: ReturnType<typeof postgres>;
  __argusDb?: ReturnType<typeof drizzle<typeof schema>>;
};

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.local from .env.example and configure it.",
    );
  }
  return postgres(url, {
    max: 10,
    connect_timeout: 10,
    // Never log query parameters — they may contain ciphertext or hashes.
    debug: false,
    onnotice: () => {},
  });
}

export const sql = globalForDb.__argusSql ?? createClient();
export const db =
  globalForDb.__argusDb ?? drizzle(sql, { schema });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__argusSql = sql;
  globalForDb.__argusDb = db;
}
