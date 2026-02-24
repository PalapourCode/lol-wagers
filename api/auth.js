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
  await sql`
    CREATE TABLE IF NOT EXISTS email_logs (
      id SERIAL PRIMARY KEY,
      username TEXT,
      recipient TEXT,
      type TEXT,
      status TEXT,
      resend_id TEXT,
      error TEXT,
      sent_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000
    )
  `;
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
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<style>
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap');
@keyframes shimmer { 0% { background-position: -400% center; } 100% { background-position: 400% center; } }
@keyframes glow { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }
@keyframes pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.04); } }
@keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }

body { margin:0; padding:0; background:#0f1a0f; }
.wrap { background:#0f1a0f; padding:0; }
</style>
</head>
<body>
<div class="wrap">

<!--[if mso]><table width="600" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f1a0f;overflow:hidden">

  <!-- TOP GOLD BAR - animated shimmer -->
  <div style="height:6px;background:linear-gradient(90deg,#5a3e00,#C8AA6E,#ffe8a0,#C8AA6E,#5a3e00,#C8AA6E,#ffe8a0);background-size:400% 100%;animation:shimmer 4s linear infinite"></div>

  <!-- HERO SECTION - casino felt green -->
  <div style="background:linear-gradient(160deg,#0a1f0a 0%,#112211 40%,#0d1a18 100%);padding:52px 40px 44px;text-align:center;position:relative;overflow:hidden">

    <!-- felt texture dots overlay -->
    <div style="position:absolute;inset:0;background-image:radial-gradient(circle,#ffffff04 1px,transparent 1px);background-size:18px 18px;pointer-events:none"></div>

    <!-- corner ornaments -->
    <div style="position:absolute;top:16px;left:20px;width:40px;height:40px;border-top:2px solid #C8AA6E44;border-left:2px solid #C8AA6E44;border-radius:3px 0 0 0"></div>
    <div style="position:absolute;top:16px;right:20px;width:40px;height:40px;border-top:2px solid #C8AA6E44;border-right:2px solid #C8AA6E44;border-radius:0 3px 0 0"></div>
    <div style="position:absolute;bottom:16px;left:20px;width:40px;height:40px;border-bottom:2px solid #C8AA6E44;border-left:2px solid #C8AA6E44;border-radius:0 0 0 3px"></div>
    <div style="position:absolute;bottom:16px;right:20px;width:40px;height:40px;border-bottom:2px solid #C8AA6E44;border-right:2px solid #C8AA6E44;border-radius:0 0 3px 0"></div>

    <!-- logo -->
    <img src="https://runeterra-wagers.online/logo.png" alt="Runeterra Wagers" width="200" style="display:block;margin:0 auto 20px;filter:drop-shadow(0 0 24px #C8AA6E66)">

    <!-- headline -->
    <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:48px;color:#C8AA6E;letter-spacing:6px;line-height:1;margin:0 0 6px;text-shadow:0 0 40px #C8AA6E66">WELCOME TO THE TABLE</div>
    <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:22px;color:#F0F0F0;letter-spacing:4px;margin:0 0 18px;opacity:0.7">${name}</div>

    <!-- divider with diamond -->
    <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin:0 auto 20px;max-width:300px">
      <div style="flex:1;height:1px;background:linear-gradient(90deg,transparent,#C8AA6E55)"></div>
      <div style="width:8px;height:8px;background:#C8AA6E;transform:rotate(45deg)"></div>
      <div style="flex:1;height:1px;background:linear-gradient(90deg,#C8AA6E55,transparent)"></div>
    </div>

    <div style="font-family:'DM Sans',Arial,sans-serif;font-size:16px;color:#86efac;font-weight:600;letter-spacing:1px">Let's get winning.</div>
  </div>

  <!-- STATS BAR -->
  <div style="background:#0a150a;border-top:1px solid #C8AA6E22;border-bottom:1px solid #C8AA6E22;padding:0">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
      <tr>
        <td width="33%" style="text-align:center;padding:16px 8px;border-right:1px solid #C8AA6E14">
          <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:28px;color:#C8AA6E;letter-spacing:2px;line-height:1">1,847</div>
          <div style="font-family:'DM Sans',Arial,sans-serif;font-size:10px;color:#555;letter-spacing:3px;text-transform:uppercase;margin-top:3px">Bets Placed</div>
        </td>
        <td width="33%" style="text-align:center;padding:16px 8px;border-right:1px solid #C8AA6E14">
          <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:28px;color:#C8AA6E;letter-spacing:2px;line-height:1">$24,390</div>
          <div style="font-family:'DM Sans',Arial,sans-serif;font-size:10px;color:#555;letter-spacing:3px;text-transform:uppercase;margin-top:3px">Gold Wagered</div>
        </td>
        <td width="33%" style="text-align:center;padding:16px 8px">
          <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:28px;color:#3FB950;letter-spacing:2px;line-height:1">LIVE</div>
          <div style="font-family:'DM Sans',Arial,sans-serif;font-size:10px;color:#555;letter-spacing:3px;text-transform:uppercase;margin-top:3px">Season 1 Active</div>
        </td>
      </tr>
    </table>
  </div>

  <!-- BODY -->
  <div style="background:#0d1a0d;padding:40px">

    <!-- intro line -->
    <p style="font-family:'DM Sans',Arial,sans-serif;font-size:16px;color:#b0c8b0;line-height:1.8;margin:0 0 32px;text-align:center">
      You just took a seat at the table. Bet on your next ranked game, win real rewards, cash out for RP cards. The Riot API handles everything automatically.
    </p>

    <!-- 4 steps as cards -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:32px">
      <tr>
        <td style="padding:0 0 12px 0">

          <!-- step 1 -->
          <div style="background:#0a1a0a;border:1px solid #C8AA6E22;border-left:3px solid #C8AA6E;border-radius:6px;padding:16px 20px;margin-bottom:10px">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td width="44" style="vertical-align:top">
                <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:36px;color:#C8AA6E33;letter-spacing:2px;line-height:1">01</div>
              </td>
              <td style="vertical-align:top;padding-left:12px">
                <div style="font-family:'DM Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#E8E8E8;margin-bottom:4px">Link your LoL account</div>
                <div style="font-family:'DM Sans',Arial,sans-serif;font-size:13px;color:#6a8a6a;line-height:1.6">Change your profile icon in-game to the one we show you. Takes 30 seconds to verify.</div>
              </td>
            </tr></table>
          </div>

          <!-- step 2 -->
          <div style="background:#0a1a0a;border:1px solid #C8AA6E22;border-left:3px solid #C8AA6E99;border-radius:6px;padding:16px 20px;margin-bottom:10px">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td width="44" style="vertical-align:top">
                <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:36px;color:#C8AA6E28;letter-spacing:2px;line-height:1">02</div>
              </td>
              <td style="vertical-align:top;padding-left:12px">
                <div style="font-family:'DM Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#E8E8E8;margin-bottom:4px">Stake before you queue</div>
                <div style="font-family:'DM Sans',Arial,sans-serif;font-size:13px;color:#6a8a6a;line-height:1.6">Set your bet amount, then hit ranked. From $1 all the way up to $30.</div>
              </td>
            </tr></table>
          </div>

          <!-- step 3 -->
          <div style="background:#0a1a0a;border:1px solid #C8AA6E22;border-left:3px solid #C8AA6E55;border-radius:6px;padding:16px 20px;margin-bottom:10px">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td width="44" style="vertical-align:top">
                <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:36px;color:#C8AA6E1e;letter-spacing:2px;line-height:1">03</div>
              </td>
              <td style="vertical-align:top;padding-left:12px">
                <div style="font-family:'DM Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#E8E8E8;margin-bottom:4px">Play your game normally</div>
                <div style="font-family:'DM Sans',Arial,sans-serif;font-size:13px;color:#6a8a6a;line-height:1.6">No restrictions. Queue into ranked and play like you always do.</div>
              </td>
            </tr></table>
          </div>

          <!-- step 4 -->
          <div style="background:#0a1a0a;border:1px solid #3FB95033;border-left:3px solid #3FB950;border-radius:6px;padding:16px 20px">
            <table width="100%" cellpadding="0" cellspacing="0"><tr>
              <td width="44" style="vertical-align:top">
                <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:36px;color:#3FB95033;letter-spacing:2px;line-height:1">04</div>
              </td>
              <td style="vertical-align:top;padding-left:12px">
                <div style="font-family:'DM Sans',Arial,sans-serif;font-size:15px;font-weight:700;color:#E8E8E8;margin-bottom:4px">Get paid when you win</div>
                <div style="font-family:'DM Sans',Arial,sans-serif;font-size:13px;color:#6a8a6a;line-height:1.6">Riot API verifies your result automatically. Credits hit your balance instantly.</div>
              </td>
            </tr></table>
          </div>

        </td>
      </tr>
    </table>

    <!-- your balance box -->
    <div style="background:linear-gradient(135deg,#0a2010,#081a08);border:1px solid #3FB95033;border-radius:8px;padding:24px;margin-bottom:28px;text-align:center">
      <div style="font-family:'DM Sans',Arial,sans-serif;font-size:11px;color:#3FB95077;letter-spacing:4px;text-transform:uppercase;margin-bottom:8px">Your Starting Balance</div>
      <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:52px;color:#3FB950;letter-spacing:4px;line-height:1;text-shadow:0 0 30px #3FB95055">$500</div>
      <div style="font-family:'DM Sans',Arial,sans-serif;font-size:13px;color:#3FB95077;margin-top:6px">Virtual gold, ready to wager right now</div>
    </div>

    <!-- CTA button -->
    <div style="text-align:center;margin-bottom:8px">
      <a href="https://runeterra-wagers.online" style="display:inline-block;background:linear-gradient(135deg,#C8AA6E,#8a6820,#C8AA6E);background-size:300% 100%;color:#0a0a0c;text-decoration:none;padding:18px 60px;border-radius:6px;font-family:'Bebas Neue',Arial,sans-serif;font-size:20px;letter-spacing:4px;animation:shimmer 3s linear infinite">
        ENTER THE RIFT
      </a>
    </div>

  </div>

  <!-- BOTTOM GOLD BAR -->
  <div style="height:1px;background:linear-gradient(90deg,transparent,#C8AA6E44,transparent)"></div>
  <div style="background:#080f08;padding:20px 40px;text-align:center">
    <p style="font-family:'DM Sans',Arial,sans-serif;font-size:12px;color:#2a3a2a;margin:0;line-height:1.8">
      <a href="https://runeterra-wagers.online" style="color:#C8AA6E33;text-decoration:none;font-weight:600">runeterra-wagers.online</a>
      &nbsp;&nbsp;·&nbsp;&nbsp;You received this because you just signed up
    </p>
  </div>
  <div style="height:6px;background:linear-gradient(90deg,#5a3e00,#C8AA6E,#ffe8a0,#C8AA6E,#5a3e00,#C8AA6E,#ffe8a0);background-size:400% 100%;animation:shimmer 4s linear infinite"></div>

</div>
<!--[if mso]></td></tr></table><![endif]-->

</div>
</body>
</html>`;
          const resendRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.RESEND_API_KEY}` },
            body: JSON.stringify({
              from: "Runeterra Wagers <onboarding@resend.dev>",
              to: cleanEmail,
              subject: `Welcome to Runeterra Wagers, ${name}!`,
              html: welcomeHtml
            })
          });
          const resendData = await resendRes.json();
          console.log("[EMAIL] Resend response:", resendRes.status, JSON.stringify(resendData));
          const emailStatus = resendRes.status === 200 ? "sent" : "failed";
          const resendId = resendData.id || null;
          const emailError = resendData.message || null;
          await sql`INSERT INTO email_logs (username, recipient, type, status, resend_id, error) VALUES (${name}, ${cleanEmail}, ${"welcome"}, ${emailStatus}, ${resendId}, ${emailError})`;
        } else {
          console.log("[EMAIL] No RESEND_API_KEY found");
          await sql`INSERT INTO email_logs (username, recipient, type, status, error) VALUES (${name}, ${cleanEmail}, ${"welcome"}, ${"failed"}, ${"No RESEND_API_KEY"})`;
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

    } else if (action === "updateEmail") {
      const { username, newEmail } = req.body;
      if (!username || !newEmail) return res.status(400).json({ error: "Missing fields" });
      if (!newEmail.includes("@")) return res.status(400).json({ error: "Invalid email" });
      const clean = newEmail.trim().toLowerCase();
      await sql`UPDATE users SET email = ${clean} WHERE username = ${username}`;
      const user = await getUser(username);
      return res.status(200).json({ user });

    } else if (action === "updatePassword") {
      const { username, currentPassword, newPassword } = req.body;
      if (!username || !currentPassword || !newPassword) return res.status(400).json({ error: "Missing fields" });
      if (newPassword.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
      const rows = await sql`SELECT * FROM users WHERE username = ${username}`;
      if (!rows.length) return res.status(404).json({ error: "User not found" });
      if (rows[0].password !== currentPassword) return res.status(401).json({ error: "Current password is incorrect" });
      await sql`UPDATE users SET password = ${newPassword} WHERE username = ${username}`;
      return res.status(200).json({ success: true });

    } else {
      return res.status(400).json({ error: "Unknown action — fallthrough" });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
