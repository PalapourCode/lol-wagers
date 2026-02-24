const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.POSTGRES_URL);

async function initDB() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      username      TEXT PRIMARY KEY,
      password      TEXT NOT NULL,
      balance       NUMERIC DEFAULT 500,
      real_balance  NUMERIC DEFAULT 0,
      skin_credits  NUMERIC DEFAULT 0,
      lol_account   TEXT DEFAULT NULL,
      puuid         TEXT DEFAULT NULL,
      rank          TEXT DEFAULT NULL,
      created_at    BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    )
  `;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS real_balance NUMERIC DEFAULT 0`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS skin_credits NUMERIC DEFAULT 0`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS region TEXT DEFAULT 'euw1'`;
  await sql`
    CREATE TABLE IF NOT EXISTS bets (
      id            BIGINT PRIMARY KEY,
      username      TEXT REFERENCES users(username),
      amount        NUMERIC NOT NULL,
      odds          NUMERIC NOT NULL,
      potential_win NUMERIC NOT NULL,
      status        TEXT DEFAULT 'pending',
      placed_at     BIGINT NOT NULL,
      resolved_at   BIGINT DEFAULT NULL,
      match_id      TEXT DEFAULT NULL,
      result        JSONB DEFAULT NULL,
      mode          TEXT DEFAULT 'virtual'
    )
  `;
  await sql`ALTER TABLE bets ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'virtual'`;
  await sql`
    CREATE TABLE IF NOT EXISTS deposits (
      id              BIGINT PRIMARY KEY,
      username        TEXT REFERENCES users(username),
      amount          NUMERIC NOT NULL,
      paypal_order_id TEXT NOT NULL,
      status          TEXT DEFAULT 'completed',
      created_at      BIGINT NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS skin_redemptions (
      id          BIGINT PRIMARY KEY,
      username    TEXT REFERENCES users(username),
      skin_name   TEXT NOT NULL,
      rp_cost     INTEGER NOT NULL,
      credit_cost NUMERIC DEFAULT 0,
      real_cost   NUMERIC DEFAULT 0,
      status      TEXT DEFAULT 'pending',
      created_at  BIGINT NOT NULL
    )
  `;
  await sql`ALTER TABLE skin_redemptions ADD COLUMN IF NOT EXISTS real_cost NUMERIC DEFAULT 0`;
}

async function getUser(username) {
  const rows = await sql`SELECT * FROM users WHERE username = ${username}`;
  if (!rows.length) return null;
  const u = rows[0];
  const bets = await sql`SELECT * FROM bets WHERE username = ${username} ORDER BY placed_at ASC`;
  return {
    username: u.username,
    email: u.email || null,
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

  await initDB();

  const { action, username, password, email } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Missing fields" });
  const name = username.trim().toLowerCase();

  try {
    if (action === "register") {
      const existing = await sql`SELECT username FROM users WHERE username = ${name}`;
      if (existing.length > 0) return res.status(409).json({ error: "Username already taken" });
      const cleanEmail = email ? email.trim().toLowerCase() : null;
      if (!cleanEmail || !cleanEmail.includes("@")) return res.status(400).json({ error: "A valid email is required" });
      await sql`INSERT INTO users (username, password, email) VALUES (${name}, ${password}, ${cleanEmail})`;

      // Send welcome email
      try {
        if (process.env.RESEND_API_KEY) {
          console.log("[EMAIL] Attempting welcome email to:", cleanEmail);
          const welcomeHtml = `<!DOCTYPE html>
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
.e{font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;background:#0d1117;border-radius:14px;border:1px solid #C8AA6E44;overflow:hidden}
.bar{height:5px;background:linear-gradient(90deg,#785A28,#C8AA6E,#fff8e7,#0BC4AA,#C8AA6E,#785A28);background-size:300% 100%;animation:shimmerBar 4s linear infinite}
.hd{background:linear-gradient(175deg,#050e1a 0%,#071a0f 60%,#050e1a 100%);padding:52px 40px 44px;text-align:center}
.logo{display:block;margin:0 auto 32px;width:280px;animation:float 5s ease-in-out infinite,logoGlow 3s ease-in-out infinite}
.hd h1{color:#C8AA6E;font-size:30px;font-weight:800;margin:0 0 10px;letter-spacing:0.5px;line-height:1.2;animation:fadeUp 0.8s ease 0.2s both}
.hd p{color:#86efac;font-size:17px;margin:0;font-weight:600;animation:fadeUp 0.8s ease 0.4s both}
.dv{height:1px;background:linear-gradient(90deg,transparent,#C8AA6E44,transparent)}
.bd{padding:44px 40px;animation:fadeUp 0.8s ease 0.5s both}
.intro{color:#d4d4dc;font-size:16px;line-height:1.8;margin:0 0 36px}
.intro strong{color:#C8AA6E;font-weight:700}
.sb{background:#0d1520;border-radius:12px;padding:30px;margin-bottom:36px;border:1px solid #C8AA6E18}
.sl{color:#C8AA6E;font-size:11px;letter-spacing:4px;margin:0 0 26px;font-weight:700;text-transform:uppercase}
.st{display:flex;gap:16px;align-items:flex-start;margin-bottom:22px;animation:stepIn 0.6s ease both}
.st:last-child{margin-bottom:0}
.st:nth-child(2){animation-delay:0.1s}.st:nth-child(3){animation-delay:0.2s}.st:nth-child(4){animation-delay:0.3s}.st:nth-child(5){animation-delay:0.4s}
.sn{background:#C8AA6E;color:#010A13;font-size:13px;font-weight:800;width:30px;height:30px;border-radius:50%;flex-shrink:0;line-height:30px;text-align:center}
.st-t{color:#f0f0f0;font-size:16px;font-weight:700;margin:0 0 6px}
.st-d{color:#8a8a9a;font-size:14px;margin:0;line-height:1.65}
.cw{text-align:center;margin-bottom:10px}
.ct{display:inline-block;background:linear-gradient(135deg,#C8AA6E 0%,#a07030 50%,#C8AA6E 100%);background-size:200% 100%;color:#010A13;text-decoration:none;padding:18px 56px;border-radius:8px;font-weight:800;font-size:15px;letter-spacing:2px;text-transform:uppercase;animation:btnGlow 2.5s ease-in-out infinite,shimmerBar 3s linear infinite}
.ft{padding:24px 40px;text-align:center;border-top:1px solid #151520}
.ft p{color:#444;font-size:13px;margin:0;line-height:1.8}
.ft a{color:#C8AA6E66;text-decoration:none;font-weight:500}
</style></head>
<body><div class="w"><div class="e">
<div class="bar"></div>
<div class="hd">
  <img class="logo" src="https://lol-wagers.vercel.app/logo.png" alt="LoL Wagers">
  <h1>Welcome, ${name}</h1>
  <p>Let's get winning.</p>
</div>
<div class="dv"></div>
<div class="bd">
  <p class="intro">You just joined <strong>LoL Wagers</strong>. Bet on yourself in ranked, win games, and cash out your credits for real RP cards sent straight to your account.</p>
  <div class="sb">
    <p class="sl">Getting started</p>
    <div class="st"><div class="sn">1</div><div><p class="st-t">Link your LoL account</p><p class="st-d">Change your profile icon in-game to the one we show you. Takes 30 seconds to verify.</p></div></div>
    <div class="st"><div class="sn">2</div><div><p class="st-t">Choose your stake</p><p class="st-d">Use your free virtual gold to start, or deposit real money to earn skin credits.</p></div></div>
    <div class="st"><div class="sn">3</div><div><p class="st-t">Queue up and play</p><p class="st-d">Place your bet before you hit ranked. Play your game as you normally would.</p></div></div>
    <div class="st"><div class="sn">4</div><div><p class="st-t">Get paid when you win</p><p class="st-d">We check your result through the Riot API. No screenshots, no waiting around.</p></div></div>
  </div>
  <div class="cw"><a href="https://lol-wagers.vercel.app" class="ct">Start Playing</a></div>
</div>
<div class="ft"><p><a href="https://lol-wagers.vercel.app">lol-wagers.vercel.app</a> &nbsp; You got this email because you signed up.</p></div>
</div></div></body></html>`;
          const resendRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.RESEND_API_KEY}` },
            body: JSON.stringify({
              from: "LoL Wagers <onboarding@resend.dev>",
              to: cleanEmail,
              subject: `Welcome to LoL Wagers, ${name}!`,
              html: welcomeHtml
            })
          });
          const resendData = await resendRes.json();
          console.log("[EMAIL] Resend response:", resendRes.status, JSON.stringify(resendData));
        } else {
          console.log("[EMAIL] No RESEND_API_KEY found");
        }
      } catch(emailErr) { console.error("[EMAIL] Exception:", emailErr.message); }

            const user = await getUser(name);
      return res.status(200).json({ user });
    } else if (action === "login") {
      // Admin shortcut — special password grants admin access without needing a user account
      if (password === process.env.ADMIN_PASSWORD) {
        return res.status(200).json({ user: { username: name, isAdmin: true, adminToken: password } });
      }
      const rows = await sql`SELECT * FROM users WHERE username = ${name}`;
      if (rows.length === 0) return res.status(404).json({ error: "User not found" });
      const u = rows[0];
      if (u.password !== password) return res.status(401).json({ error: "Wrong password" });
      const full = await getUser(name);
      return res.status(200).json({ user: full });
    } else {
      return res.status(400).json({ error: "Unknown action" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
