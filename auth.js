import { sql, initDB } from "./db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  await initDB();

  const { action, username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });

  const name = username.trim().toLowerCase();

  try {
    if (action === "register") {
      const existing = await sql`SELECT username FROM users WHERE username = ${name}`;
      if (existing.length > 0) return res.status(409).json({ error: "Username already taken" });
      await sql`INSERT INTO users (username, password) VALUES (${name}, ${password})`;
      const user = await getUser(name);
      return res.status(200).json({ user });

    } else if (action === "login") {
      const rows = await sql`SELECT * FROM users WHERE username = ${name}`;
      if (rows.length === 0) return res.status(404).json({ error: "User not found" });
      const user = rows[0];
      if (user.password !== password) return res.status(401).json({ error: "Wrong password" });
      const full = await getUser(name);
      return res.status(200).json({ user: full });

    } else {
      return res.status(400).json({ error: "Unknown action" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function getUser(username) {
  const rows = await sql`SELECT * FROM users WHERE username = ${username}`;
  if (!rows.length) return null;
  const u = rows[0];
  const bets = await sql`SELECT * FROM bets WHERE username = ${username} ORDER BY placed_at ASC`;
  return {
    username: u.username,
    balance: Number(u.balance),
    lolAccount: u.lol_account,
    puuid: u.puuid,
    rank: u.rank,
    createdAt: Number(u.created_at),
    bets: bets.map(b => ({
      id: Number(b.id),
      amount: Number(b.amount),
      odds: Number(b.odds),
      potentialWin: Number(b.potential_win),
      status: b.status,
      placedAt: Number(b.placed_at),
      resolvedAt: b.resolved_at ? Number(b.resolved_at) : null,
      matchId: b.match_id,
      result: b.result
    }))
  };
}
