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
          email: u.email || null,
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

      // Send email notification to player
      try {
        const rows = await sql`
          SELECT r.skin_name, r.rp_cost, r.credit_cost, r.real_cost, r.username,
                 u.email, u.lol_account
          FROM skin_redemptions r
          JOIN users u ON u.username = r.username
          WHERE r.id = ${redemptionId}
        `;
        const r = rows[0];
        if (r?.email && process.env.RESEND_API_KEY) {
          const totalPaid = (Number(r.credit_cost || 0) + Number(r.real_cost || 0)).toFixed(2);
          const cardHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark">
<style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
@keyframes shimmerBar{0%{background-position:-200% center}100%{background-position:200% center}}
@keyframes logoGlow{0%,100%{filter:drop-shadow(0 0 8px #C8AA6E44)}50%{filter:drop-shadow(0 0 24px #C8AA6Eaa) drop-shadow(0 0 48px #C8AA6E44)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes cardShine{0%{background-position:-150% center}100%{background-position:250% center}}
@keyframes rpFlash{0%,100%{color:#F0F0F0;text-shadow:none}50%{color:#C8AA6E;text-shadow:0 0 30px #C8AA6E88,0 0 60px #C8AA6E44}}
@keyframes greenPulse{0%,100%{box-shadow:0 0 0 0 #4ade8033}50%{box-shadow:0 0 0 8px #4ade8000}}
@keyframes float{0%,100%{transform:translateY(0px)}50%{transform:translateY(-6px)}}
@keyframes stepIn{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:translateX(0)}}
@keyframes btnGlow{0%,100%{box-shadow:0 4px 20px #C8AA6E33}50%{box-shadow:0 4px 40px #C8AA6E66,0 0 80px #C8AA6E22}}
@keyframes holo{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
body{margin:0;padding:0;background:#060a10}
.w{background:#060a10;padding:32px 16px}
.e{font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#0d1117;border-radius:14px;border:1px solid #4ade8033;overflow:hidden}
.bar{height:5px;background:linear-gradient(90deg,#14532d,#4ade80,#0BC4AA,#86efac,#4ade80,#14532d);background-size:300% 100%;animation:shimmerBar 4s linear infinite}
.hd{background:linear-gradient(175deg,#050e1a 0%,#071a0f 60%,#050e1a 100%);padding:52px 40px 44px;text-align:center}
.logo{display:block;margin:0 auto 32px;width:280px;animation:float 5s ease-in-out infinite,logoGlow 3s ease-in-out infinite}
.hd h1{color:#4ade80;font-size:30px;font-weight:800;margin:0 0 10px;animation:fadeUp 0.8s ease 0.2s both}
.hd p{color:#86efac;font-size:17px;margin:0;font-weight:600;animation:fadeUp 0.8s ease 0.4s both}
.dv{height:1px;background:linear-gradient(90deg,transparent,#4ade8033,transparent)}
.bd{padding:44px 40px}
.rpc{border-radius:16px;padding:36px 32px;margin-bottom:28px;text-align:center;position:relative;overflow:hidden;background:linear-gradient(135deg,#1a0f2e 0%,#0f1a3e 25%,#0a1a1a 50%,#1a1a0f 75%,#1a0f2e 100%);background-size:400% 400%;animation:holo 6s ease infinite;box-shadow:0 0 0 1px #C8AA6E33,0 20px 60px #00000088,inset 0 1px 0 #ffffff11}
.rpc::before{content:'';position:absolute;inset:0;background:linear-gradient(105deg,transparent 20%,#C8AA6E08 30%,#a78bfa08 40%,#0BC4AA08 50%,transparent 60%);background-size:200% 100%;animation:cardShine 4s linear infinite;pointer-events:none}
.riot-logo{width:72px;height:72px;border-radius:10px;display:block;margin:0 auto 20px}
.rpl{color:#C8AA6E;font-size:11px;letter-spacing:5px;font-weight:700;text-transform:uppercase;margin:0 0 10px}
.rpn{color:#F0F0F0;font-size:64px;font-weight:900;margin:0 0 4px;line-height:1;letter-spacing:-2px;animation:rpFlash 3s ease-in-out infinite}
.rps{color:#7a7a8a;font-size:15px;margin:0;font-weight:500}
.cb{background:#071a0f;border-radius:12px;padding:24px 28px;margin-bottom:28px;border:1px solid #4ade8044;animation:greenPulse 2.5s ease-in-out infinite}
.ci{display:flex;align-items:center;gap:18px}
.ck{width:46px;height:46px;background:#4ade8018;border-radius:50%;border:2px solid #4ade80;flex-shrink:0;line-height:46px;text-align:center;color:#4ade80;font-size:22px;font-weight:700}
.ct-t{color:#4ade80;font-size:17px;font-weight:700;margin:0 0 6px}
.ct-a{color:#86efac;font-size:15px;margin:0;font-weight:500}
.sum{background:#0d1520;border-radius:12px;padding:24px 28px;margin-bottom:28px;border:1px solid #C8AA6E1a}
.suml{color:#C8AA6E;font-size:11px;letter-spacing:3px;margin:0 0 18px;font-weight:700;text-transform:uppercase}
.sumr{display:flex;justify-content:space-between;align-items:center}
.sumr+.sumr{padding-top:12px;margin-top:12px;border-top:1px solid #1a1a2e}
.sumk{color:#8a8a9a;font-size:15px}
.sumv{color:#f0f0f0;font-size:15px;font-weight:600}
.sumvp{color:#a78bfa;font-size:18px;font-weight:800}
.note{color:#7a7a8a;font-size:14px;line-height:1.8;margin:0 0 36px}
.note strong{color:#d0d0d8;font-weight:600}
.cw{text-align:center}
.cta{display:inline-block;background:linear-gradient(135deg,#C8AA6E 0%,#a07030 50%,#C8AA6E 100%);background-size:200% 100%;color:#010A13;text-decoration:none;padding:18px 56px;border-radius:8px;font-weight:800;font-size:15px;letter-spacing:2px;text-transform:uppercase;animation:btnGlow 2.5s ease-in-out infinite,shimmerBar 3s linear infinite}
.ft{padding:24px 40px;text-align:center;border-top:1px solid #151520}
.ft p{color:#444;font-size:13px;margin:0;line-height:1.8}
.ft a{color:#4ade8055;text-decoration:none;font-weight:500}
</style></head>
<body><div class="w"><div class="e">
<div class="bar"></div>
<div class="hd">
  <img class="logo" src="https://lol-wagers.vercel.app/logo.png" alt="LoL Wagers">
  <h1>Your card is on its way.</h1>
  <p>Check your League client in a few minutes.</p>
</div>
<div class="dv"></div>
<div class="bd">
  <div class="rpc">
    <img class="riot-logo" src="data:image/png;base64,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" alt="Riot Games">
    <p class="rpl">Riot Points</p>
    <p class="rpn">${r.rp_cost}</p>
    <p class="rps">RP Card</p>
  </div>
  <div class="cb">
    <div class="ci">
      <div class="ck">✓</div>
      <div><p class="ct-t">Sent to your account</p><p class="ct-a">${r.lol_account || r.username}</p></div>
    </div>
  </div>
  <div class="sum">
    <p class="suml">Summary</p>
    <div class="sumr"><span class="sumk">Card value</span><span class="sumv">${r.rp_cost} RP</span></div>
    <div class="sumr"><span class="sumk">Credits spent</span><span class="sumvp">${totalPaid} credits</span></div>
  </div>
  <p class="note">It can take a few minutes to show up in your client. If nothing arrives within <strong>24 hours</strong>, just reply to this email and we will fix it.</p>
  <div class="cw"><a href="https://lol-wagers.vercel.app" class="cta">Place Another Bet</a></div>
</div>
<div class="ft"><p><a href="https://lol-wagers.vercel.app">lol-wagers.vercel.app</a> &nbsp; Good luck out there.</p></div>
</div></div></body></html>`;
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.RESEND_API_KEY}` },
            body: JSON.stringify({
              from: "LoL Wagers <noreply@lol-wagers.vercel.app>",
              to: r.email,
              subject: `Your ${r.skin_name} card has been sent!`,
              html: cardHtml
            })
          });
        }
            } catch(emailErr) {
        console.error("Email send failed:", emailErr.message);
        // Don't fail the fulfillment if email fails
      }
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

    } else if (action === "deletePlayer") {
      const { username } = params;
      if (!username) return res.status(400).json({ error: "Username required" });
      // Delete in order to respect foreign keys
      await sql`DELETE FROM skin_redemptions WHERE username = ${username}`;
      await sql`DELETE FROM deposits WHERE username = ${username}`;
      await sql`DELETE FROM bets WHERE username = ${username}`;
      await sql`DELETE FROM users WHERE username = ${username}`;
      return res.status(200).json({ success: true });

    } else {
      return res.status(400).json({ error: "Unknown action" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
