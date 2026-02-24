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
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.RESEND_API_KEY}`
            },
            body: JSON.stringify({
              from: "LoL Wagers <noreply@lol-wagers.vercel.app>",
              to: cleanEmail,
              subject: "⚔️ Welcome to LoL Wagers, Summoner!",
              html: `
                <div style="background:#010A13;padding:40px;font-family:'Segoe UI',sans-serif;max-width:560px;margin:0 auto;border:1px solid #C8AA6E33;border-radius:12px">
                  <div style="text-align:center;margin-bottom:32px">
                    <div style="font-size:40px;margin-bottom:12px">⚔️</div>
                    <h1 style="color:#C8AA6E;font-size:26px;margin:0;letter-spacing:3px;text-transform:uppercase">Welcome, ${name}</h1>
                    <p style="color:#7A7A82;font-size:13px;margin-top:8px;letter-spacing:1px">Your account is ready</p>
                  </div>

                  <div style="background:#1A1A1E;border-radius:8px;padding:24px;margin-bottom:20px;border:1px solid #C8AA6E22">
                    <p style="color:#A0A0A8;font-size:11px;letter-spacing:2px;margin:0 0 16px">HOW IT WORKS</p>
                    <div style="display:flex;flex-direction:column;gap:12px">
                      <div style="display:flex;align-items:flex-start;gap:12px">
                        <span style="color:#C8AA6E;font-weight:700;font-size:16px;min-width:24px">01</span>
                        <span style="color:#C0C0C8;font-size:13px;line-height:1.5">Link your LoL account via profile icon verification</span>
                      </div>
                      <div style="display:flex;align-items:flex-start;gap:12px">
                        <span style="color:#C8AA6E;font-weight:700;font-size:16px;min-width:24px">02</span>
                        <span style="color:#C0C0C8;font-size:13px;line-height:1.5">Place a bet before queuing into ranked</span>
                      </div>
                      <div style="display:flex;align-items:flex-start;gap:12px">
                        <span style="color:#C8AA6E;font-weight:700;font-size:16px;min-width:24px">03</span>
                        <span style="color:#C0C0C8;font-size:13px;line-height:1.5">Win your game — earn gold and skin credits</span>
                      </div>
                      <div style="display:flex;align-items:flex-start;gap:12px">
                        <span style="color:#C8AA6E;font-weight:700;font-size:16px;min-width:24px">04</span>
                        <span style="color:#C0C0C8;font-size:13px;line-height:1.5">Redeem your credits for RP cards — sent directly to your account</span>
                      </div>
                    </div>
                  </div>

                  <div style="text-align:center;margin-bottom:24px">
                    <a href="https://lol-wagers.vercel.app" style="display:inline-block;background:linear-gradient(135deg,#C8AA6E,#785A28);color:#010A13;text-decoration:none;padding:14px 40px;border-radius:4px;font-weight:700;font-size:14px;letter-spacing:2px;text-transform:uppercase">
                      Start Playing →
                    </a>
                  </div>

                  <p style="color:#3A3A42;font-size:11px;text-align:center;margin:0">
                    lol-wagers.vercel.app · You're receiving this because you just registered
                  </p>
                </div>
              `
            })
          });
        }
      } catch(emailErr) {
        console.error("Welcome email failed:", emailErr.message);
        // Don't fail registration if email fails
      }

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
