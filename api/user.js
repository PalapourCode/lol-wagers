const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.POSTGRES_URL);

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

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action, username, lolAccount, puuid, rank } = req.body || {};

  try {
    if (action === "linkAccount") {
      const existing = await sql`SELECT username FROM users WHERE puuid = ${puuid} AND username != ${username}`;
      if (existing.length > 0) return res.status(409).json({ error: "This LoL account is already linked to another account" });
      await sql`UPDATE users SET lol_account = ${lolAccount}, puuid = ${puuid}, rank = ${rank} WHERE username = ${username}`;
      const user = await getUser(username);
      return res.status(200).json({ user });
    } else if (action === "unlinkAccount") {
      await sql`UPDATE users SET lol_account = NULL, puuid = NULL, rank = NULL WHERE username = ${username}`;
      const user = await getUser(username);
      return res.status(200).json({ user });
    } else {
      return res.status(400).json({ error: "Unknown action" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
