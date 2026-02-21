import { sql, initDB } from "./db.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  await initDB();

  try {
    const users = await sql`
      SELECT 
        u.username,
        u.balance,
        u.lol_account,
        u.rank,
        COUNT(CASE WHEN b.status = 'won' THEN 1 END) as wins,
        COUNT(CASE WHEN b.status IN ('won','lost') THEN 1 END) as total
      FROM users u
      LEFT JOIN bets b ON b.username = u.username
      GROUP BY u.username, u.balance, u.lol_account, u.rank
      ORDER BY u.balance DESC
    `;

    return res.status(200).json({
      users: users.map(u => ({
        username: u.username,
        balance: Number(u.balance),
        lolAccount: u.lol_account,
        rank: u.rank,
        wins: Number(u.wins),
        total: Number(u.total)
      }))
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
