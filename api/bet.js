const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.POSTGRES_URL);

const MAX_REAL_BET = 1.00; // $1 max for real money bets

async function getUser(username) {
  const rows = await sql`SELECT * FROM users WHERE username = ${username}`;
  if (!rows.length) return null;
  const u = rows[0];
  const bets = await sql`SELECT * FROM bets WHERE username = ${username} ORDER BY placed_at ASC`;
  return {
    username: u.username,
    balance: Number(u.balance),
    realBalance: Number(u.real_balance || 0),
    skinCredits: Number(u.skin_credits || 0),
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
      result: b.result,
      mode: b.mode || "virtual"
    }))
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action, username, amount, odds, potentialWin, matchId, result, won, mode } = req.body || {};
  // mode = "virtual" (default) or "real"
  const betMode = mode === "real" ? "real" : "virtual";

  try {
    if (action === "placeBet") {
      const active = await sql`SELECT id FROM bets WHERE username = ${username} AND status = 'pending'`;
      if (active.length > 0) return res.status(400).json({ error: "You already have an active bet" });

      const rows = await sql`SELECT balance, real_balance FROM users WHERE username = ${username}`;
      if (!rows.length) return res.status(404).json({ error: "User not found" });

      const parsedAmount = Number(amount);

      if (betMode === "real") {
        // Real money bet validations
        if (parsedAmount > MAX_REAL_BET) return res.status(400).json({ error: `Max real money bet is $${MAX_REAL_BET.toFixed(2)}` });
        if (parsedAmount < 0.10) return res.status(400).json({ error: "Minimum real bet is $0.10" });
        if (parsedAmount > Number(rows[0].real_balance)) return res.status(400).json({ error: "Insufficient real balance" });

        const id = Date.now();
        await sql`INSERT INTO bets (id, username, amount, odds, potential_win, status, placed_at, mode)
                  VALUES (${id}, ${username}, ${parsedAmount}, ${odds}, ${potentialWin}, 'pending', ${id}, 'real')`;
        await sql`UPDATE users SET real_balance = real_balance - ${parsedAmount} WHERE username = ${username}`;
      } else {
        // Virtual bet validations
        if (parsedAmount > 30) return res.status(400).json({ error: "Max virtual bet is $30" });
        if (parsedAmount < 1) return res.status(400).json({ error: "Minimum bet is $1" });
        if (parsedAmount > Number(rows[0].balance)) return res.status(400).json({ error: "Insufficient virtual balance" });

        const id = Date.now();
        await sql`INSERT INTO bets (id, username, amount, odds, potential_win, status, placed_at, mode)
                  VALUES (${id}, ${username}, ${parsedAmount}, ${odds}, ${potentialWin}, 'pending', ${id}, 'virtual')`;
        await sql`UPDATE users SET balance = balance - ${parsedAmount} WHERE username = ${username}`;
      }

      const user = await getUser(username);
      return res.status(200).json({ user });

    } else if (action === "resolveBet") {
      const active = await sql`SELECT * FROM bets WHERE username = ${username} AND status = 'pending'`;
      if (!active.length) return res.status(404).json({ error: "No active bet found" });

      const bet = active[0];
      const isRealBet = bet.mode === "real";
      const status = won ? "won" : "lost";
      const resolvedAt = Date.now();

      await sql`UPDATE bets SET status = ${status}, match_id = ${matchId}, result = ${JSON.stringify(result)}, resolved_at = ${resolvedAt} WHERE id = ${bet.id}`;

      if (won) {
        const stake = Number(bet.amount);
        const totalPayout = Number(bet.potential_win);
        const profit = totalPayout - stake;

        if (isRealBet) {
          // Real money win:
          // - Stake goes back to real_balance (they get their money back)
          // - Profit (the winnings) goes to skin_credits
          await sql`UPDATE users SET
            real_balance = real_balance + ${stake},
            skin_credits = skin_credits + ${profit}
          WHERE username = ${username}`;
        } else {
          // Virtual win: all goes back to virtual balance as before
          await sql`UPDATE users SET balance = balance + ${totalPayout} WHERE username = ${username}`;
        }
      }
      // On loss: money is already deducted when bet was placed, nothing to do

      const user = await getUser(username);
      return res.status(200).json({ user });

    } else {
      return res.status(400).json({ error: "Unknown action" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
