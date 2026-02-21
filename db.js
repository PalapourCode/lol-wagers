import { neon } from "@neondatabase/serverless";

export const sql = neon(process.env.STORAGE_URL);

export async function initDB() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      balance NUMERIC DEFAULT 500,
      lol_account TEXT DEFAULT NULL,
      puuid TEXT DEFAULT NULL,
      rank TEXT DEFAULT NULL,
      created_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS bets (
      id BIGINT PRIMARY KEY,
      username TEXT REFERENCES users(username),
      amount NUMERIC NOT NULL,
      odds NUMERIC NOT NULL,
      potential_win NUMERIC NOT NULL,
      status TEXT DEFAULT 'pending',
      placed_at BIGINT NOT NULL,
      resolved_at BIGINT DEFAULT NULL,
      match_id TEXT DEFAULT NULL,
      result JSONB DEFAULT NULL
    )
  `;
}
