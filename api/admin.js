// api/admin.js — all admin actions, every request verified server-side
const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.POSTGRES_URL);

function verifyAdmin(adminToken) {
  return adminToken === process.env.ADMIN_PASSWORD;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { action, adminToken, ...params } = req.body || {};

  // Every single request must pass the admin token check
  if (!verifyAdmin(adminToken)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    // ── GET ALL PLAYERS ──────────────────────────────────────────────────────
    if (action === "getPlayers") {
      const users = await sql`SELECT * FROM users ORDER BY created_at DESC`;
      const bets = await sql`SELECT username, status, amount, potential_win, mode FROM bets`;
      const deposits = await sql`SELECT username, SUM(amount) as total FROM deposits GROUP BY username`;

      const depositMap = {};
      for (const d of deposits) depositMap[d.username] = Number(d.total);

      const betMap = {};
      for (const b of bets) {
        if (!betMap[b.username]) betMap[b.username] = { total: 0, wins: 0, losses: 0, pending: 0 };
        betMap[b.username].total++;
        if (b.status === "won") betMap[b.username].wins++;
        else if (b.status === "lost") betMap[b.username].losses++;
        else if (b.status === "pending") betMap[b.username].pending++;
      }

      return res.status(200).json({
        players: users.map(u => ({
          username: u.username,
          balance: Number(u.balance),
          realBalance: Number(u.real_balance || 0),
          skinCredits: Number(u.skin_credits || 0),
          lolAccount: u.lol_account,
          rank: u.rank,
          createdAt: Number(u.created_at),
          totalDeposited: depositMap[u.username] || 0,
          bets: betMap[u.username] || { total: 0, wins: 0, losses: 0, pending: 0 },
        }))
      });

    // ── GET ALL REDEMPTIONS ──────────────────────────────────────────────────
    } else if (action === "getRedemptions") {
      const rows = await sql`
        SELECT r.*, u.lol_account
        FROM skin_redemptions r
        JOIN users u ON u.username = r.username
        ORDER BY r.created_at DESC
        LIMIT 100
      `;
      return res.status(200).json({
        redemptions: rows.map(r => ({
          id: Number(r.id),
          username: r.username,
          lolAccount: r.lol_account,
          skinName: r.skin_name,
          rpCost: Number(r.rp_cost),
          creditCost: Number(r.credit_cost || 0),
          realCost: Number(r.real_cost || 0),
          status: r.status,
          createdAt: Number(r.created_at)
        }))
      });

    // ── FULFILL REDEMPTION ───────────────────────────────────────────────────
    } else if (action === "fulfillRedemption") {
      const { redemptionId } = params;
      await sql`UPDATE skin_redemptions SET status = 'fulfilled' WHERE id = ${redemptionId}`;
      return res.status(200).json({ success: true });

    // ── GET FINANCIALS ───────────────────────────────────────────────────────
    } else if (action === "getFinancials") {
      const [deps] = await sql`SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE status = 'completed'`;
      const [realOwed] = await sql`SELECT COALESCE(SUM(real_balance), 0) as total FROM users`;
      const [creditsOwed] = await sql`SELECT COALESCE(SUM(skin_credits), 0) as total FROM users`;
      const [redeemed] = await sql`SELECT COALESCE(SUM(credit_cost + COALESCE(real_cost, 0)), 0) as total FROM skin_redemptions WHERE status = 'fulfilled'`;
      const [pendingRedeemed] = await sql`SELECT COALESCE(SUM(credit_cost + COALESCE(real_cost, 0)), 0) as total FROM skin_redemptions WHERE status = 'pending'`;
      const [betCount] = await sql`SELECT COUNT(*) as total FROM bets`;
      const [playerCount] = await sql`SELECT COUNT(*) as total FROM users`;
      const [depositCount] = await sql`SELECT COUNT(*) as total FROM deposits`;

      const totalDeposited = Number(deps.total);
      const totalRealOwed = Number(realOwed.total);
      const totalCreditsOwed = Number(creditsOwed.total);
      const totalFulfilled = Number(redeemed.total);
      const totalPendingRedeem = Number(pendingRedeemed.total);

      return res.status(200).json({
        totalDeposited,
        totalRealOwed,        // real money you owe players (they can withdraw this)
        totalCreditsOwed,     // skin credits outstanding
        totalFulfilled,       // total spent on fulfilled redemptions
        totalPendingRedeem,   // redemptions submitted but not yet sent
        netMargin: totalDeposited - totalRealOwed - totalFulfilled - totalPendingRedeem,
        totalBets: Number(betCount.total),
        totalPlayers: Number(playerCount.total),
        totalDeposits: Number(depositCount.total),
      });

    // ── GET RECENT ACTIVITY LOG ──────────────────────────────────────────────
    } else if (action === "getActivity") {
      const bets = await sql`
        SELECT 'bet' as type, username, amount, status, placed_at as ts, mode FROM bets
        ORDER BY placed_at DESC LIMIT 30
      `;
      const deposits = await sql`
        SELECT 'deposit' as type, username, amount, 'completed' as status, created_at as ts FROM deposits
        ORDER BY created_at DESC LIMIT 20
      `;
      const redemptions = await sql`
        SELECT 'redemption' as type, username, (credit_cost + COALESCE(real_cost,0)) as amount, status, created_at as ts, skin_name
        FROM skin_redemptions
        ORDER BY created_at DESC LIMIT 20
      `;

      const all = [
        ...bets.map(b => ({ type: "bet", username: b.username, amount: Number(b.amount), status: b.status, ts: Number(b.ts), mode: b.mode })),
        ...deposits.map(d => ({ type: "deposit", username: d.username, amount: Number(d.amount), status: "completed", ts: Number(d.ts) })),
        ...redemptions.map(r => ({ type: "redemption", username: r.username, amount: Number(r.amount), status: r.status, ts: Number(r.ts), skinName: r.skin_name })),
      ].sort((a, b) => b.ts - a.ts).slice(0, 50);

      return res.status(200).json({ activity: all });

    // ── QUICK ACTIONS ────────────────────────────────────────────────────────
    } else if (action === "resetVirtualBalance") {
      const { username } = params;
      await sql`UPDATE users SET balance = 500 WHERE username = ${username}`;
      return res.status(200).json({ success: true });

    } else if (action === "adjustBalance") {
      const { username, field, amount } = params;
      const allowed = ["balance", "real_balance", "skin_credits"];
      if (!allowed.includes(field)) return res.status(400).json({ error: "Invalid field" });
      await sql`UPDATE users SET ${sql(field)} = ${sql(field)} + ${Number(amount)} WHERE username = ${username}`;
      return res.status(200).json({ success: true });

    } else if (action === "cancelPendingBet") {
      const { username } = params;
      // Refund the stake back to the appropriate balance
      const bets = await sql`SELECT * FROM bets WHERE username = ${username} AND status = 'pending'`;
      if (!bets.length) return res.status(404).json({ error: "No pending bet found" });
      const bet = bets[0];
      await sql`UPDATE bets SET status = 'cancelled' WHERE id = ${bet.id}`;
      if (bet.mode === "real") {
        await sql`UPDATE users SET real_balance = real_balance + ${Number(bet.amount)} WHERE username = ${username}`;
      } else {
        await sql`UPDATE users SET balance = balance + ${Number(bet.amount)} WHERE username = ${username}`;
      }
      return res.status(200).json({ success: true });

    } else if (action === "setBalance") {
      // Set balance to exact amount (not add — replace)
      const { username, field, amount } = params;
      const allowed = ["balance", "real_balance", "skin_credits"];
      if (!allowed.includes(field)) return res.status(400).json({ error: "Invalid field" });
      await sql`UPDATE users SET ${sql(field)} = ${Number(amount)} WHERE username = ${username}`;
      return res.status(200).json({ success: true });

    } else {
      return res.status(400).json({ error: "Unknown action" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
