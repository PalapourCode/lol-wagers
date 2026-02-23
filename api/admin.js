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

  if (!verifyAdmin(adminToken)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // Ensure notes column exists
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_note TEXT DEFAULT NULL`;

  try {

    // ── GET ALL PLAYERS ──────────────────────────────────────────────────────
    if (action === "getPlayers") {
      const users = await sql`SELECT * FROM users ORDER BY created_at DESC`;
      const bets = await sql`SELECT username, status, amount, potential_win, mode, odds FROM bets`;
      const deposits = await sql`SELECT username, SUM(amount) as total, COUNT(*) as count FROM deposits GROUP BY username`;

      const depositMap = {};
      for (const d of deposits) depositMap[d.username] = { total: Number(d.total), count: Number(d.count) };

      const betMap = {};
      for (const b of bets) {
        if (!betMap[b.username]) betMap[b.username] = { total: 0, wins: 0, losses: 0, pending: 0, cancelled: 0, totalWagered: 0, totalWon: 0 };
        betMap[b.username].total++;
        betMap[b.username].totalWagered += Number(b.amount);
        if (b.status === "won") { betMap[b.username].wins++; betMap[b.username].totalWon += Number(b.potential_win); }
        else if (b.status === "lost") betMap[b.username].losses++;
        else if (b.status === "pending") betMap[b.username].pending++;
        else if (b.status === "cancelled") betMap[b.username].cancelled++;
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
          adminNote: u.admin_note || "",
          deposit: depositMap[u.username] || { total: 0, count: 0 },
          bets: betMap[u.username] || { total: 0, wins: 0, losses: 0, pending: 0, cancelled: 0, totalWagered: 0, totalWon: 0 },
        }))
      });

    // ── GET PLAYER DETAIL (bets + deposits) ──────────────────────────────────
    } else if (action === "getPlayerDetail") {
      const { username } = params;
      const bets = await sql`SELECT * FROM bets WHERE username = ${username} ORDER BY placed_at DESC LIMIT 50`;
      const deposits = await sql`SELECT * FROM deposits WHERE username = ${username} ORDER BY created_at DESC LIMIT 50`;
      const redemptions = await sql`SELECT * FROM skin_redemptions WHERE username = ${username} ORDER BY created_at DESC LIMIT 20`;
      return res.status(200).json({
        bets: bets.map(b => ({
          id: Number(b.id),
          amount: Number(b.amount),
          odds: Number(b.odds),
          potentialWin: Number(b.potential_win),
          status: b.status,
          mode: b.mode || "virtual",
          placedAt: Number(b.placed_at),
          resolvedAt: b.resolved_at ? Number(b.resolved_at) : null,
          result: b.result,
        })),
        deposits: deposits.map(d => ({
          id: Number(d.id),
          amount: Number(d.amount),
          status: d.status,
          createdAt: Number(d.created_at),
        })),
        redemptions: redemptions.map(r => ({
          id: Number(r.id),
          skinName: r.skin_name,
          rpCost: Number(r.rp_cost),
          creditCost: Number(r.credit_cost || 0),
          realCost: Number(r.real_cost || 0),
          status: r.status,
          createdAt: Number(r.created_at),
        })),
      });

    // ── GET ALL REDEMPTIONS ──────────────────────────────────────────────────
    } else if (action === "getRedemptions") {
      const rows = await sql`
        SELECT r.*, u.lol_account
        FROM skin_redemptions r
        JOIN users u ON u.username = r.username
        ORDER BY r.status ASC, r.created_at ASC
        LIMIT 200
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

    // ── GET ALL PENDING BETS ─────────────────────────────────────────────────
    } else if (action === "getPendingBets") {
      const rows = await sql`
        SELECT b.*, u.lol_account, u.rank
        FROM bets b
        JOIN users u ON u.username = b.username
        WHERE b.status = 'pending'
        ORDER BY b.placed_at ASC
      `;
      return res.status(200).json({
        bets: rows.map(b => ({
          id: Number(b.id),
          username: b.username,
          lolAccount: b.lol_account,
          rank: b.rank,
          amount: Number(b.amount),
          odds: Number(b.odds),
          potentialWin: Number(b.potential_win),
          mode: b.mode || "virtual",
          placedAt: Number(b.placed_at),
        }))
      });

    // ── GET FINANCIALS ───────────────────────────────────────────────────────
    } else if (action === "getFinancials") {
      const [deps] = await sql`SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM deposits WHERE status = 'completed'`;
      const [realOwed] = await sql`SELECT COALESCE(SUM(real_balance), 0) as total FROM users`;
      const [creditsOwed] = await sql`SELECT COALESCE(SUM(skin_credits), 0) as total FROM users`;
      const [redeemed] = await sql`SELECT COALESCE(SUM(credit_cost + COALESCE(real_cost, 0)), 0) as total, COUNT(*) as count FROM skin_redemptions WHERE status = 'fulfilled'`;
      const [pendingRedeemed] = await sql`SELECT COALESCE(SUM(credit_cost + COALESCE(real_cost, 0)), 0) as total, COUNT(*) as count FROM skin_redemptions WHERE status = 'pending'`;
      const [playerCount] = await sql`SELECT COUNT(*) as total FROM users`;

      // Real bets stats
      const [realBets] = await sql`
        SELECT
          COUNT(*) as total,
          COALESCE(SUM(CASE WHEN status='won' THEN 1 ELSE 0 END), 0) as wins,
          COALESCE(SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END), 0) as losses,
          COALESCE(SUM(amount), 0) as wagered,
          COALESCE(SUM(CASE WHEN status='won' THEN potential_win - amount ELSE 0 END), 0) as credits_paid_out
        FROM bets WHERE mode = 'real' AND status NOT IN ('pending', 'cancelled')
      `;

      // Virtual bets stats
      const [virtualBets] = await sql`
        SELECT
          COUNT(*) as total,
          COALESCE(SUM(CASE WHEN status='won' THEN 1 ELSE 0 END), 0) as wins,
          COALESCE(SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END), 0) as losses,
          COALESCE(SUM(amount), 0) as wagered
        FROM bets WHERE mode = 'virtual' AND status NOT IN ('pending', 'cancelled')
      `;

      // Pending bets
      const [pendingBets] = await sql`
        SELECT COUNT(*) as total,
          COALESCE(SUM(CASE WHEN mode='real' THEN amount ELSE 0 END), 0) as real_at_stake,
          COALESCE(SUM(CASE WHEN mode='virtual' THEN amount ELSE 0 END), 0) as virtual_at_stake
        FROM bets WHERE status = 'pending'
      `;

      const totalDeposited = Number(deps.total);
      const totalRealOwed = Number(realOwed.total);
      const totalCreditsOwed = Number(creditsOwed.total);
      const totalFulfilled = Number(redeemed.total);
      const totalPendingRedeem = Number(pendingRedeemed.total);

      const real = {
        totalBets: Number(realBets.total),
        wins: Number(realBets.wins),
        losses: Number(realBets.losses),
        wagered: Number(realBets.wagered),       // real € wagered by players
        creditsPaidOut: Number(realBets.credits_paid_out), // credits created from wins
        winRate: Number(realBets.total) > 0 ? Math.round(Number(realBets.wins) / Number(realBets.total) * 100) : 0,
      };

      const virtual = {
        totalBets: Number(virtualBets.total),
        wins: Number(virtualBets.wins),
        losses: Number(virtualBets.losses),
        wagered: Number(virtualBets.wagered),    // fake $ wagered (for info only)
        winRate: Number(virtualBets.total) > 0 ? Math.round(Number(virtualBets.wins) / Number(virtualBets.total) * 100) : 0,
      };

      return res.status(200).json({
        // Real money
        totalDeposited,
        totalRealOwed,
        totalFulfilled,
        totalPendingRedeem,
        netMargin: totalDeposited - totalRealOwed - totalFulfilled - totalPendingRedeem,
        // Credits
        totalCreditsOwed,
        totalCreditsPaidOut: real.creditsPaidOut,
        // Bet stats split
        real,
        virtual,
        // Pending
        pendingBetsCount: Number(pendingBets.total),
        pendingRealAtStake: Number(pendingBets.real_at_stake),
        pendingVirtualAtStake: Number(pendingBets.virtual_at_stake),
        // Counts
        totalPlayers: Number(playerCount.total),
        totalDeposits: Number(deps.count),
        totalRedemptionsFulfilled: Number(redeemed.count),
        totalRedemptionsPending: Number(pendingRedeemed.count),
      });
      });

    // ── GET RECENT ACTIVITY LOG ──────────────────────────────────────────────
    } else if (action === "getActivity") {
      const bets = await sql`SELECT 'bet' as type, username, amount, status, placed_at as ts, mode FROM bets ORDER BY placed_at DESC LIMIT 40`;
      const deposits = await sql`SELECT 'deposit' as type, username, amount, 'completed' as status, created_at as ts FROM deposits ORDER BY created_at DESC LIMIT 30`;
      const redemptions = await sql`SELECT 'redemption' as type, username, (credit_cost + COALESCE(real_cost,0)) as amount, status, created_at as ts, skin_name FROM skin_redemptions ORDER BY created_at DESC LIMIT 30`;

      const all = [
        ...bets.map(b => ({ type: "bet", username: b.username, amount: Number(b.amount), status: b.status, ts: Number(b.ts), mode: b.mode })),
        ...deposits.map(d => ({ type: "deposit", username: d.username, amount: Number(d.amount), status: "completed", ts: Number(d.ts) })),
        ...redemptions.map(r => ({ type: "redemption", username: r.username, amount: Number(r.amount), status: r.status, ts: Number(r.ts), skinName: r.skin_name })),
      ].sort((a, b) => b.ts - a.ts).slice(0, 80);

      return res.status(200).json({ activity: all });

    // ── SAVE ADMIN NOTE ──────────────────────────────────────────────────────
    } else if (action === "saveNote") {
      const { username, note } = params;
      await sql`UPDATE users SET admin_note = ${note} WHERE username = ${username}`;
      return res.status(200).json({ success: true });

    // ── QUICK ACTIONS ────────────────────────────────────────────────────────
    } else if (action === "resetVirtualBalance") {
      const { username } = params;
      await sql`UPDATE users SET balance = 500 WHERE username = ${username}`;
      return res.status(200).json({ success: true });

    } else if (action === "adjustBalance") {
      const { username, field, amount } = params;
      const amt = Number(amount);
      if (field === "balance") {
        await sql`UPDATE users SET balance = GREATEST(0, balance + ${amt}) WHERE username = ${username}`;
      } else if (field === "real_balance") {
        await sql`UPDATE users SET real_balance = GREATEST(0, real_balance + ${amt}) WHERE username = ${username}`;
      } else if (field === "skin_credits") {
        await sql`UPDATE users SET skin_credits = GREATEST(0, skin_credits + ${amt}) WHERE username = ${username}`;
      } else {
        return res.status(400).json({ error: "Invalid field" });
      }
      const rows = await sql`SELECT balance, real_balance, skin_credits FROM users WHERE username = ${username}`;
      return res.status(200).json({ success: true, updated: rows[0] });

    } else if (action === "cancelPendingBet") {
      const { username } = params;
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

    } else {
      return res.status(400).json({ error: "Unknown action" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
