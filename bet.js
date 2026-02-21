import { sql, initDB } from "./db.js";
import { getUser } from "./user.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  await initDB();

  const { action, username, amount, odds, potentialWin, matchId, result, won } = req.body;

  try {
    if (action === "placeBet") {
      // Check no active bet
      const active = await sql`SELECT id FROM bets WHERE username = ${username} AND status = 'pending'`;
      if (active.length > 0) return res.status(400).json({ error: "You already have an active bet" });

      // Check balance
      const rows = await sql`SELECT balance FROM users WHERE username = ${username}`;
      if (!rows.length) return res.status(404).json({ error: "User not found" });
      const balance = Number(rows[0].balance);
      if (amount > balance) return res.status(400).json({ error: "Insufficient balance" });

      const id = Date.now();
      const placedAt = Date.now();

      await sql`INSERT INTO bets (id, username, amount, odds, potential_win, status, placed_at) 
                VALUES (${id}, ${username}, ${amount}, ${odds}, ${potentialWin}, 'pending', ${placedAt})`;
      await sql`UPDATE users SET balance = balance - ${amount} WHERE username = ${username}`;

      const user = await getUser(username);
      return res.status(200).json({ user });

    } else if (action === "resolveBet") {
      const active = await sql`SELECT * FROM bets WHERE username = ${username} AND status = 'pending'`;
      if (!active.length) return res.status(404).json({ error: "No active bet found" });
      const bet = active[0];

      const status = won ? "won" : "lost";
      const resolvedAt = Date.now();

      await sql`UPDATE bets SET status = ${status}, match_id = ${matchId}, result = ${JSON.stringify(result)}, resolved_at = ${resolvedAt} WHERE id = ${bet.id}`;

      if (won) {
        await sql`UPDATE users SET balance = balance + ${Number(bet.potential_win)} WHERE username = ${username}`;
      }

      const user = await getUser(username);
      return res.status(200).json({ user });

    } else {
      return res.status(400).json({ error: "Unknown action" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
