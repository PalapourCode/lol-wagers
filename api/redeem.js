// api/redeem.js
// Players submit a skin redemption request. You fulfill it manually via League gifting.
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

  const { action, username, skinName, rpCost, creditCost } = req.body || {};

  try {
    if (action === "submitRedemption") {
      if (!username || !skinName || !rpCost || !creditCost) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const rows = await sql`SELECT skin_credits FROM users WHERE username = ${username}`;
      if (!rows.length) return res.status(404).json({ error: "User not found" });

      const available = Number(rows[0].skin_credits || 0);
      if (Number(creditCost) > available) {
        return res.status(400).json({ error: "Insufficient skin credits" });
      }

      // Deduct credits immediately, mark redemption as pending
      await sql`UPDATE users SET skin_credits = skin_credits - ${Number(creditCost)} WHERE username = ${username}`;
      const now = Date.now();
      await sql`INSERT INTO skin_redemptions (id, username, skin_name, rp_cost, credit_cost, status, created_at)
                VALUES (${now}, ${username}, ${skinName}, ${rpCost}, ${Number(creditCost)}, 'pending', ${now})`;

      const user = await getUser(username);
      return res.status(200).json({ success: true, user });

    } else if (action === "getRedemptions") {
      // Get this user's redemption history
      const redemptions = await sql`
        SELECT * FROM skin_redemptions WHERE username = ${username} ORDER BY created_at DESC
      `;
      return res.status(200).json({
        redemptions: redemptions.map(r => ({
          id: Number(r.id),
          skinName: r.skin_name,
          rpCost: Number(r.rp_cost),
          creditCost: Number(r.credit_cost),
          status: r.status,
          createdAt: Number(r.created_at)
        }))
      });

    } else if (action === "adminGetAll") {
      // For you to review pending redemptions (only accessible if needed)
      const all = await sql`
        SELECT r.*, u.lol_account FROM skin_redemptions r
        JOIN users u ON u.username = r.username
        WHERE r.status = 'pending'
        ORDER BY r.created_at ASC
      `;
      return res.status(200).json({ redemptions: all });

    } else if (action === "adminFulfill") {
      // Mark a redemption as fulfilled after you've sent the gift
      const { redemptionId } = req.body;
      await sql`UPDATE skin_redemptions SET status = 'fulfilled' WHERE id = ${redemptionId}`;
      return res.status(200).json({ success: true });

    } else {
      return res.status(400).json({ error: "Unknown action" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
