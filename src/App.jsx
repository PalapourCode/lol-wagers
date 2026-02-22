import { useState, useEffect, useCallback } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const STARTING_BALANCE = 500;
const MAX_BET = 30;
const RAKE = 0.05; // 5%
// API key is handled server-side via /api/riot

// Rank multipliers for odds (lower rank = higher payout potential)
const RANK_ODDS = {
  IRON: 1.6, BRONZE: 1.55, SILVER: 1.5, GOLD: 1.45,
  PLATINUM: 1.4, EMERALD: 1.38, DIAMOND: 1.35,
  MASTER: 1.25, GRANDMASTER: 1.2, CHALLENGER: 1.15, UNRANKED: 1.5
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const getRankTier = (rankStr) => {
  if (!rankStr) return "UNRANKED";
  return rankStr.split(" ")[0].toUpperCase();
};

const getOdds = (rankStr) => {
  const tier = getRankTier(rankStr);
  return RANK_ODDS[tier] || 1.5;
};

const formatMoney = (n) => `$${Number(n).toFixed(2)}`;

const timeAgo = (ts) => {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

// ─── STORAGE HELPERS ─────────────────────────────────────────────────────────
const apiCall = async (endpoint, body) => {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
};

// ─── RIOT API ────────────────────────────────────────────────────────────────
const riotAPI = async (params) => {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/riot?${qs}`);
  if (!res.ok) throw new Error(`Riot API error (${res.status})`);
  return res.json();
};

const riot = {
  async getSummonerByName(gameName, tagLine) {
    return riotAPI({ action: "account", gameName, tagLine });
  },
  async getRankedInfo(puuid, region) {
    // Use puuid directly - no summoner id needed
    const rankData = await riotAPI({ action: "rank", puuid, region });
    if (!Array.isArray(rankData)) return "UNRANKED";
    const soloQ = rankData.find(e => e.queueType === "RANKED_SOLO_5x5");
    return soloQ ? `${soloQ.tier} ${soloQ.rank}` : "UNRANKED";
  },
  async getLastMatchResult(puuid, region) {
    const matchIds = await riotAPI({ action: "matchlist", puuid, region });
    if (!Array.isArray(matchIds) || !matchIds.length) throw new Error("No ranked matches found");
    const match = await riotAPI({ action: "match", matchId: matchIds[0], region });
    const participant = match.info.participants.find(p => p.puuid === puuid);
    if (!participant) throw new Error("Could not find your data in the match");
    return {
      matchId: matchIds[0],
      win: participant.win,
      champion: participant.championName,
      kills: participant.kills,
      deaths: participant.deaths,
      assists: participant.assists,
      gameEndTimestamp: match.info.gameEndTimestamp
    };
  }
}

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

function Loader({ text = "Loading..." }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 40 }}>
      <div style={{
        width: 36, height: 36, border: "3px solid #C8AA6E33",
        borderTop: "3px solid #C8AA6E", borderRadius: "50%",
        animation: "spin 0.8s linear infinite"
      }} />
      <span style={{ color: "#785A28", fontSize: 13, fontFamily: "Cinzel, serif" }}>{text}</span>
    </div>
  );
}

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  const colors = { success: "#0BC4AA", error: "#C8464A", info: "#C8AA6E" };
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 9999,
      background: "#010A13", border: `1px solid ${colors[type] || colors.info}`,
      color: "#F0E6D3", padding: "14px 20px", borderRadius: 4,
      fontFamily: "Cinzel, serif", fontSize: 13, maxWidth: 320,
      boxShadow: `0 4px 24px ${colors[type] || colors.info}44`,
      animation: "slideUp 0.3s ease"
    }}>
      {message}
    </div>
  );
}


// ─── AUTH DYNAMIC COMPONENTS ─────────────────────────────────────────────────
const TICKER_EVENTS = [
  "palapourheal won $18.50 on Jinx — GOLD IV",
  "xXSlayerXx lost $10.00 on Yasuo — SILVER II",
  "MidOrFeed won $25.65 on Ahri — PLATINUM I",
  "TopLaner99 won $12.35 on Darius — BRONZE III",
  "JungleKing lost $20.00 on Vi — GOLD II",
  "ADCarry won $28.50 on Caitlyn — DIAMOND IV",
  "SupportMain won $9.50 on Thresh — SILVER I",
  "CarryDiff won $14.25 on Akali — EMERALD II",
  "OnetrICK lost $15.00 on Zed — PLATINUM III",
  "RiftWalker won $22.80 on Orianna — MASTER",
];

function LiveTicker() {
  const [offset, setOffset] = useState(0);
  const text = TICKER_EVENTS.join("   ·   ");

  useEffect(() => {
    const interval = setInterval(() => {
      setOffset(prev => (prev + 1) % (text.length * 8));
    }, 30);
    return () => clearInterval(interval);
  }, [text]);

  return (
    <div style={{ overflow: "hidden", background: "#0A1628", borderTop: "1px solid #785A2818", borderBottom: "1px solid #785A2818", padding: "8px 0", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 0, whiteSpace: "nowrap", transform: `translateX(-${offset}px)`, transition: "none" }}>
        {[...TICKER_EVENTS, ...TICKER_EVENTS].map((e, i) => (
          <span key={i} style={{ fontSize: 11, color: e.includes("won") ? "#0BC4AA" : "#C8464A", fontFamily: "Crimson Text, serif", padding: "0 24px", flexShrink: 0 }}>
            <span style={{ color: "#785A28", marginRight: 8 }}>◆</span>{e}
          </span>
        ))}
      </div>
    </div>
  );
}

function FloatingParticles() {
  const particles = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: 1 + Math.random() * 3,
    duration: 6 + Math.random() * 10,
    delay: Math.random() * 8,
    opacity: 0.1 + Math.random() * 0.25,
  }));
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
      {particles.map(p => (
        <div key={p.id} style={{
          position: "absolute", left: `${p.x}%`, top: `${p.y}%`,
          width: p.size, height: p.size, borderRadius: "50%",
          background: "#C8AA6E", opacity: p.opacity,
          animation: `particleFloat ${p.duration}s ${p.delay}s ease-in-out infinite`
        }} />
      ))}
    </div>
  );
}

function AnimatedCounter({ target, duration = 2000, prefix = "", suffix = "" }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let start = null;
    const step = (ts) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      setVal(Math.floor(progress * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return <span>{prefix}{val.toLocaleString()}{suffix}</span>;
}

function AuthStatsBar() {
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: 0, padding: "16px 48px", borderBottom: "1px solid #785A2811" }}>
      {[
        { label: "TOTAL BETS PLACED", value: 1847, suffix: "" },
        { label: "GOLD WAGERED", value: 24390, prefix: "$" },
        { label: "ACTIVE PLAYERS", value: 312, suffix: "" },
        { label: "BIGGEST WIN TODAY", value: 47.25, prefix: "$", isFloat: true },
      ].map((s, i) => (
        <div key={i} style={{ flex: 1, textAlign: "center", padding: "0 16px", borderRight: i < 3 ? "1px solid #785A2818" : "none" }}>
          <div style={{ color: "#C8AA6E", fontSize: 20, fontWeight: 900, fontFamily: "Cinzel, serif" }}>
            {s.isFloat ? `$${s.value.toFixed(2)}` : <AnimatedCounter target={s.value} prefix={s.prefix || ""} suffix={s.suffix || ""} />}
          </div>
          <div style={{ color: "#785A28", fontSize: 9, letterSpacing: 3, marginTop: 4 }}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

function RecentWinsScroll() {
  const wins = [
    { player: "xXSlayerXx", champ: "Yasuo", rank: "GOLD II", amount: "$18.50", won: true },
    { player: "MidOrFeed", champ: "Ahri", rank: "PLAT I", amount: "$25.65", won: true },
    { player: "TopLaner99", champ: "Darius", rank: "SILVER III", amount: "$12.00", won: false },
    { player: "CarryDiff", champ: "Akali", rank: "EMERALD II", amount: "$14.25", won: true },
    { player: "JungleKing", champ: "Vi", rank: "GOLD II", amount: "$20.00", won: false },
    { player: "ADCarry", champ: "Caitlyn", rank: "DIAMOND IV", amount: "$28.50", won: true },
  ];
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setVisible(v => (v + 1) % wins.length), 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ background: "#010A13", border: "1px solid #785A2822", borderRadius: 6, overflow: "hidden", marginTop: 16 }}>
      <div style={{ padding: "8px 14px", borderBottom: "1px solid #785A2811", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, letterSpacing: 3, color: "#785A28" }}>RECENT ACTIVITY</span>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#C8464A", animation: "pulse 1.5s ease-in-out infinite" }} />
          <span style={{ fontSize: 9, color: "#C8464A", letterSpacing: 2 }}>LIVE</span>
        </div>
      </div>
      {wins.map((w, i) => (
        <div key={i} style={{
          padding: "10px 14px", borderBottom: "1px solid #785A2811",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          opacity: i === visible ? 1 : i === (visible - 1 + wins.length) % wins.length ? 0.5 : 0.2,
          transition: "opacity 0.5s ease",
          background: i === visible ? (w.won ? "#0BC4AA06" : "#C8464A06") : "transparent"
        }}>
          <div>
            <div style={{ fontSize: 12, color: "#F0E6D3", fontWeight: 600 }}>{w.player}</div>
            <div style={{ fontSize: 11, color: "#785A28", fontFamily: "Crimson Text, serif" }}>{w.champ} · {w.rank}</div>
          </div>
          <div style={{ fontSize: 14, fontWeight: 900, color: w.won ? "#0BC4AA" : "#C8464A" }}>
            {w.won ? "+" : "-"}{w.amount}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── AUTH PAGE ───────────────────────────────────────────────────────────────
function AuthPage({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handle = async () => {
    if (!username.trim() || !password.trim()) return setError("Fill all fields");
    setLoading(true); setError("");
    try {
      const data = await apiCall("/api/auth", { action: mode === "register" ? "register" : "login", username: username.trim(), password });
      onLogin(data.user);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const features = [
    { icon: "⚔️", title: "Bet on Your Own Games", desc: "Wager on your next ranked Solo/Duo match. Only wins count — no match fixing possible." },
    { icon: "🏆", title: "Earn Virtual Gold", desc: "Win games, stack gold. Your rank determines your odds — Iron players earn up to 1.6x." },
    { icon: "🎁", title: "Redeem for Rewards", desc: "Use your gold balance to claim RP, skins, or champion bundles. Coming soon." },
    { icon: "📊", title: "Compete on Leaderboards", desc: "See where you rank among your friends. Who's the best at backing themselves?" },
  ];

  const howItWorks = [
    { step: "01", text: "Create an account & link your LoL profile via icon verification" },
    { step: "02", text: "Place a bet ($1–$30) before queuing into ranked" },
    { step: "03", text: "Play your game. Win = earn gold. Lose = lose your stake." },
    { step: "04", text: "Check your result — Riot API verifies it automatically" },
  ];

  return (
    <div style={{
      minHeight: "100vh", background: "#010A13", fontFamily: "Cinzel, serif",
      backgroundImage: "radial-gradient(ellipse at 20% 50%, #0d1f3c 0%, #010A13 60%), radial-gradient(ellipse at 80% 20%, #1a0d05 0%, transparent 50%)"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
        * { box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeInLeft { from { opacity: 0; transform: translateX(-30px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes fadeInRight { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes glow { 0%,100% { text-shadow: 0 0 20px #C8AA6E44; } 50% { text-shadow: 0 0 60px #C8AA6E99; } }
        @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes particleFloat { 0%,100% { transform: translateY(0) scale(1); opacity: 0.15; } 50% { transform: translateY(-40px) scale(1.5); opacity: 0.3; } }
        input::placeholder { color: #785A2844; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #010A13; } ::-webkit-scrollbar-thumb { background: #785A28; border-radius: 3px; }
        .auth-feature-card:hover { border-color: #C8AA6E44 !important; background: #0d1f3c !important; }
        .auth-input:focus { border-color: #C8AA6E !important; }
      `}</style>

      {/* Top brand bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 48px", borderBottom: "1px solid #785A2811" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, background: "linear-gradient(135deg, #C8AA6E, #785A28)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⚔</div>
          <div>
            <div style={{ fontSize: 9, letterSpacing: 5, color: "#785A28" }}>RUNETERRA</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#C8AA6E", lineHeight: 1 }}>WAGERS</div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#785A2888", fontFamily: "Crimson Text, serif", fontStyle: "italic" }}>
          Stake your gold. Prove your rank.
        </div>
      </div>

      <FloatingParticles />
      <LiveTicker />
      <AuthStatsBar />
      {/* Main split layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 420px 1fr", gap: 0, minHeight: "calc(100vh - 73px)", alignItems: "start" }}>

        {/* LEFT PANEL — How it works */}
        <div style={{ padding: "60px 40px 60px 48px", animation: "fadeInLeft 0.7s ease" }}>
          <div style={{ fontSize: 9, letterSpacing: 5, color: "#785A28", marginBottom: 8 }}>HOW IT WORKS</div>
          <h2 style={{ fontSize: 28, fontWeight: 900, color: "#F0E6D3", marginBottom: 32, lineHeight: 1.2 }}>
            Bet on yourself.<br/><span style={{ color: "#C8AA6E" }}>Win real rewards.</span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {howItWorks.map((item, i) => (
              <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start", animation: `fadeInLeft 0.7s ease ${0.1 * i}s both` }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 6, flexShrink: 0,
                  background: "linear-gradient(135deg, #C8AA6E22, #785A2811)",
                  border: "1px solid #C8AA6E33",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#C8AA6E", fontSize: 11, fontWeight: 700, letterSpacing: 1
                }}>{item.step}</div>
                <div style={{ color: "#785A28", fontSize: 13, fontFamily: "Crimson Text, serif", lineHeight: 1.6, paddingTop: 8 }}>
                  {item.text}
                </div>
              </div>
            ))}
          </div>

          {/* Rank odds table */}
          <div style={{ marginTop: 40, background: "#0A162888", border: "1px solid #785A2822", borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: 9, letterSpacing: 4, color: "#785A28", marginBottom: 16 }}>PAYOUT MULTIPLIERS BY RANK</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px" }}>
              {[
                ["Iron", "1.60x"], ["Bronze", "1.55x"], ["Silver", "1.50x"], ["Gold", "1.45x"],
                ["Platinum", "1.40x"], ["Emerald", "1.38x"], ["Diamond", "1.35x"], ["Master+", "1.15–1.25x"]
              ].map(([rank, odds]) => (
                <div key={rank} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid #785A2811" }}>
                  <span style={{ fontSize: 11, color: "#785A2888", fontFamily: "Crimson Text, serif" }}>{rank}</span>
                  <span style={{ fontSize: 12, color: "#C8AA6E", fontWeight: 700 }}>{odds}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CENTER — Login form */}
        <div style={{ padding: "60px 0", borderLeft: "1px solid #785A2818", borderRight: "1px solid #785A2818" }}>
          <div style={{ padding: "0 36px" }}>
            {/* Hero */}
            <div style={{ textAlign: "center", marginBottom: 36 }}>
              <div style={{ fontSize: 64, marginBottom: 8, animation: "float 4s ease-in-out infinite" }}>⚔️</div>
              <h1 style={{ fontSize: 36, fontWeight: 900, color: "#C8AA6E", margin: "0 0 4px", animation: "glow 3s ease-in-out infinite", lineHeight: 1 }}>
                BET ON<br /><span style={{ color: "#F0E6D3" }}>YOURSELF</span>
              </h1>
              <div style={{ width: 60, height: 1, background: "linear-gradient(90deg, transparent, #C8AA6E, transparent)", margin: "12px auto" }} />
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", marginBottom: 24, border: "1px solid #785A2833", borderRadius: 4, overflow: "hidden" }}>
              {["login", "register"].map(m => (
                <button key={m} onClick={() => { setMode(m); setError(""); }} style={{
                  flex: 1, padding: "11px", border: "none", cursor: "pointer",
                  background: mode === m ? "#C8AA6E" : "transparent",
                  color: mode === m ? "#010A13" : "#785A28",
                  fontFamily: "Cinzel, serif", fontSize: 11, fontWeight: 700,
                  textTransform: "uppercase", letterSpacing: 2, transition: "all 0.2s"
                }}>{m}</button>
              ))}
            </div>

            {/* Fields */}
            {[
              { label: "Username", value: username, set: setUsername, type: "text", placeholder: "your summoner name" },
              { label: "Password", value: password, set: setPassword, type: "password", placeholder: "••••••••" }
            ].map(f => (
              <div key={f.label} style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 9, letterSpacing: 3, color: "#785A28", marginBottom: 6 }}>
                  {f.label.toUpperCase()}
                </label>
                <input
                  className="auth-input"
                  type={f.type} value={f.value} placeholder={f.placeholder}
                  onChange={e => f.set(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handle()}
                  style={{
                    width: "100%", background: "#010A13", border: "1px solid #785A2833",
                    color: "#F0E6D3", padding: "11px 14px", borderRadius: 4,
                    fontFamily: "Cinzel, serif", fontSize: 13, outline: "none",
                    transition: "border-color 0.2s"
                  }}
                />
              </div>
            ))}

            {error && (
              <div style={{ background: "#C8464A11", border: "1px solid #C8464A33", borderRadius: 3, padding: "10px 14px", marginBottom: 14 }}>
                <p style={{ color: "#C8464A", fontSize: 12, margin: 0, fontFamily: "Crimson Text, serif" }}>⚠ {error}</p>
              </div>
            )}

            {loading ? <Loader text="Authenticating..." /> : (
              <button onClick={handle} style={{
                width: "100%", background: "linear-gradient(135deg, #C8AA6E, #785A28)",
                border: "none", color: "#010A13", padding: "13px", borderRadius: 4,
                fontFamily: "Cinzel, serif", fontSize: 13, fontWeight: 700,
                letterSpacing: 2, cursor: "pointer", textTransform: "uppercase",
                transition: "opacity 0.2s", marginBottom: 12
              }}
                onMouseEnter={e => e.target.style.opacity = "0.85"}
                onMouseLeave={e => e.target.style.opacity = "1"}
              >
                {mode === "login" ? "Enter the Rift" : "Create Account"}
              </button>
            )}

            {mode === "register" && (
              <div style={{ background: "#C8AA6E11", border: "1px solid #C8AA6E22", borderRadius: 4, padding: "12px 16px", textAlign: "center" }}>
                <p style={{ color: "#C8AA6E", fontSize: 12, margin: 0, fontFamily: "Crimson Text, serif" }}>
                  🎁 You start with <strong>$500 in virtual gold</strong> — no real money needed
                </p>
              </div>
            )}

            <div style={{ marginTop: 24, padding: "16px", background: "#0A162866", borderRadius: 4, border: "1px solid #785A2811" }}>
              <div style={{ fontSize: 9, letterSpacing: 3, color: "#785A2866", marginBottom: 8 }}>PLATFORM INFO</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {["Virtual currency only — no real money", "Solo/Duo ranked games only", "$30 max bet per game", "5% platform rake on winnings"].map(t => (
                  <div key={t} style={{ fontSize: 11, color: "#785A2888", fontFamily: "Crimson Text, serif", display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ color: "#C8AA6E44" }}>◆</span> {t}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL — Features / rewards */}
        <div style={{ padding: "60px 48px 60px 40px", animation: "fadeInRight 0.7s ease" }}>
          <div style={{ fontSize: 9, letterSpacing: 5, color: "#785A28", marginBottom: 8 }}>FEATURES</div>
          <h2 style={{ fontSize: 28, fontWeight: 900, color: "#F0E6D3", marginBottom: 32, lineHeight: 1.2 }}>
            What you can<br/><span style={{ color: "#C8AA6E" }}>win & earn.</span>
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {features.map((f, i) => (
              <div key={i} className="auth-feature-card" style={{
                background: "#0A162866", border: "1px solid #785A2822", borderRadius: 8,
                padding: "16px 20px", transition: "all 0.2s", cursor: "default",
                animation: `fadeInRight 0.7s ease ${0.1 * i}s both`
              }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>{f.icon}</span>
                  <div>
                    <div style={{ color: "#C8AA6E", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{f.title}</div>
                    <div style={{ color: "#785A28", fontSize: 12, fontFamily: "Crimson Text, serif", lineHeight: 1.5 }}>{f.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Coming soon rewards */}
          <div style={{ marginTop: 28, background: "linear-gradient(135deg, #C8AA6E11, #785A2811)", border: "1px solid #C8AA6E22", borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: 9, letterSpacing: 4, color: "#C8AA6E88", marginBottom: 12 }}>COMING SOON — REWARDS SHOP</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { item: "Champion Skin", price: "$1,250 gold", emoji: "🎨" },
                { item: "Riot Points Pack (650 RP)", price: "$500 gold", emoji: "💎" },
                { item: "Champion Bundle", price: "$800 gold", emoji: "⚔️" },
              ].map(r => (
                <div key={r.item} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #785A2811" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span>{r.emoji}</span>
                    <span style={{ fontSize: 12, color: "#F0E6D388", fontFamily: "Crimson Text, serif" }}>{r.item}</span>
                  </div>
                  <span style={{ fontSize: 11, color: "#C8AA6E", fontWeight: 700 }}>{r.price}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 10, color: "#785A2855", fontFamily: "Crimson Text, serif", fontStyle: "italic" }}>
              * Rewards are virtual and for demonstration purposes
            </div>
          </div>
          <RecentWinsScroll />
        </div>
      </div>
    </div>
  );
}

// ─── LINK LOL ACCOUNT ────────────────────────────────────────────────────────
// Default starter icon IDs every LoL account owns (0-28)
const STARTER_ICONS = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28];
const getIconUrl = (id) => `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${id}.jpg`;

function LinkAccount({ user, setUser, region, setRegion, toast }) {
  const [gameName, setGameName] = useState("");
  const [tagLine, setTagLine] = useState("");
  const [loading, setLoading] = useState(false);
  // Verification state
  const [step, setStep] = useState("input"); // input | verify
  const [pendingAccount, setPendingAccount] = useState(null);
  const [requiredIconId, setRequiredIconId] = useState(null);

  const startLink = async () => {
    if (!gameName || !tagLine) return toast("Enter your Riot ID and tag", "error");
    setLoading(true);
    try {
      const account = await riot.getSummonerByName(gameName, tagLine);
      if (!account || !account.puuid) throw new Error("Account not found. Check your Riot ID and Tag.");
      
      // Check if this LoL account is already linked to another user
      // Duplicate check handled server-side in /api/user

      // Pick a random starter icon for verification
      const iconId = STARTER_ICONS[Math.floor(Math.random() * STARTER_ICONS.length)];
      setPendingAccount({ ...account, gameName, tagLine });
      setRequiredIconId(iconId);
      setStep("verify");
    } catch (e) {
      toast(`Error: ${e.message}`, "error");
    }
    setLoading(false);
  };

  const verifyAndLink = async () => {
    setLoading(true);
    try {
      // Fetch current profile icon via summoner endpoint
      const summoner = await riotAPI({ action: "summoner", puuid: pendingAccount.puuid, region });
      if (!summoner || summoner.profileIconId === undefined) throw new Error("Could not fetch your profile. Try again.");
      
      if (summoner.profileIconId !== requiredIconId) {
        throw new Error(`Wrong icon! You currently have icon #${summoner.profileIconId} equipped. Please equip icon #${requiredIconId} in the League client first.`);
      }

      // Icon matches — link the account
      const rank = await riot.getRankedInfo(pendingAccount.puuid, region);
      const data = await apiCall("/api/user", {
        action: "linkAccount",
        username: user.username,
        lolAccount: `${pendingAccount.gameName}#${pendingAccount.tagLine}`,
        puuid: pendingAccount.puuid,
        rank
      });
      setUser(data.user);
      toast(`Verified! Account linked. Rank: ${rank}`, "success");
      setStep("input");
    } catch (e) {
      toast(`Verification failed: ${e.message}`, "error");
    }
    setLoading(false);
  };

  if (user.lolAccount) return (
    <div style={{ background: "#0A1628", border: "1px solid #C8AA6E44", borderRadius: 4, padding: 24 }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: "#785A28", marginBottom: 12 }}>LINKED ACCOUNT</div>
      <div style={{ fontSize: 20, color: "#C8AA6E", fontWeight: 700 }}>{user.lolAccount}</div>
      <div style={{ color: "#785A28", fontSize: 13, marginTop: 4, fontFamily: "Crimson Text, serif" }}>
        Rank: <span style={{ color: "#F0E6D3" }}>{user.rank || "UNRANKED"}</span>
      </div>
      <div style={{ color: "#785A28", fontSize: 13 }}>
        Odds multiplier: <span style={{ color: "#0BC4AA" }}>{getOdds(user.rank)}x</span>
      </div>
      <button onClick={async () => { const data = await apiCall("/api/user", { action: "unlinkAccount", username: user.username }); setUser(data.user); setStep("input"); }}
        style={{ marginTop: 12, background: "none", border: "1px solid #785A2855", color: "#785A28", padding: "6px 14px", borderRadius: 3, cursor: "pointer", fontFamily: "Cinzel, serif", fontSize: 11 }}>
        Unlink Account
      </button>
    </div>
  );

  if (step === "verify" && pendingAccount && requiredIconId !== null) return (
    <div style={{ background: "#0A1628", border: "1px solid #C8AA6E44", borderRadius: 4, padding: 24 }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: "#C8AA6E", marginBottom: 16 }}>VERIFY ACCOUNT OWNERSHIP</div>
      <p style={{ color: "#F0E6D388", fontSize: 13, fontFamily: "Crimson Text, serif", marginBottom: 20 }}>
        To prove you own <strong style={{color:"#C8AA6E"}}>{pendingAccount.gameName}#{pendingAccount.tagLine}</strong>, 
        set this icon as your profile picture in the League client, then click Verify:
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 24, background: "#010A13", padding: 16, borderRadius: 4, border: "1px solid #C8AA6E33" }}>
        <img 
          src={getIconUrl(requiredIconId)} 
          alt={`Icon ${requiredIconId}`}
          style={{ width: 80, height: 80, borderRadius: 4, border: "2px solid #C8AA6E", imageRendering: "auto" }}
          onError={e => { e.target.src = getIconUrl(0); }}
        />
        <div>
          <div style={{ color: "#C8AA6E", fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Icon #{requiredIconId}</div>
          <div style={{ color: "#785A28", fontSize: 12, fontFamily: "Crimson Text, serif" }}>
            1. Open League of Legends client<br/>
            2. Click your profile icon (top right)<br/>
            3. Select "Customize Identity"<br/>
            4. Find and equip this icon<br/>
            5. Come back here and click Verify
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={verifyAndLink} disabled={loading} style={{
          flex: 1, background: "linear-gradient(135deg, #C8AA6E, #785A28)", border: "none",
          color: "#010A13", padding: "12px", borderRadius: 3, fontFamily: "Cinzel, serif",
          fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: 1
        }}>
          {loading ? "Verifying..." : "✓ Verify & Link"}
        </button>
        <button onClick={() => { setStep("input"); setPendingAccount(null); setRequiredIconId(null); }} style={{
          background: "none", border: "1px solid #785A2855", color: "#785A28",
          padding: "12px 20px", borderRadius: 3, fontFamily: "Cinzel, serif", fontSize: 12, cursor: "pointer"
        }}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div style={{ background: "#0A1628", border: "1px solid #785A2844", borderRadius: 4, padding: 24 }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: "#785A28", marginBottom: 16 }}>LINK YOUR LOL ACCOUNT</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          placeholder="Game Name (e.g. Faker)"
          value={gameName} onChange={e => setGameName(e.target.value)}
          style={{ flex: 2, minWidth: 150, background: "#010A13", border: "1px solid #785A2855", color: "#F0E6D3", padding: "10px 12px", borderRadius: 3, fontFamily: "Cinzel, serif", fontSize: 13 }}
        />
        <input
          placeholder="Tag (e.g. EUW, NA1, 1234)"
          value={tagLine} onChange={e => setTagLine(e.target.value)}
          style={{ flex: 1, minWidth: 80, background: "#010A13", border: "1px solid #785A2855", color: "#F0E6D3", padding: "10px 12px", borderRadius: 3, fontFamily: "Cinzel, serif", fontSize: 13 }}
        />
        <select value={region} onChange={e => setRegion(e.target.value)}
          style={{ background: "#010A13", border: "1px solid #785A2855", color: "#F0E6D3", padding: "10px 12px", borderRadius: 3, fontFamily: "Cinzel, serif", fontSize: 13 }}>
          <option value="euw1">EUW</option>
          <option value="na1">NA</option>
          <option value="kr">KR</option>
          <option value="br1">BR</option>
        </select>
        <button onClick={startLink} disabled={loading} style={{
          background: "#C8AA6E", color: "#010A13", border: "none", padding: "10px 20px",
          borderRadius: 3, fontFamily: "Cinzel, serif", fontSize: 12, fontWeight: 700,
          cursor: "pointer", whiteSpace: "nowrap"
        }}>
          {loading ? "..." : "Link Account"}
        </button>
      </div>
    </div>
  );
}

// ─── PLACE BET ───────────────────────────────────────────────────────────────
function PlaceBet({ user, setUser, toast }) {
  const [amount, setAmount] = useState(10);
  const [loading, setLoading] = useState(false);

  const activeBet = user.bets?.find(b => b.status === "pending");
  const odds = getOdds(user.rank);
  const potentialWin = ((amount * odds) * (1 - RAKE)).toFixed(2);

  const place = async () => {
    if (!user.lolAccount) return toast("Link your LoL account first", "error");
    if (activeBet) return toast("You already have an active bet!", "error");
    if (amount > MAX_BET) return toast(`Max bet is $${MAX_BET}`, "error");
    if (amount > user.balance) return toast("Insufficient balance", "error");
    if (amount < 1) return toast("Minimum bet is $1", "error");

    setLoading(true);
    try {
      const data = await apiCall("/api/bet", {
        action: "placeBet",
        username: user.username,
        amount: Number(amount),
        odds,
        potentialWin: Number(potentialWin)
      });
      setUser(data.user);
      toast(`Bet placed! Win your next ranked game to earn ${formatMoney(potentialWin)}`, "success");
    } catch(e) {
      toast(e.message, "error");
    }
    setLoading(false);
  };

  return (
    <div style={{ background: "#0A1628", border: "1px solid #785A2844", borderRadius: 4, padding: 24 }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: "#785A28", marginBottom: 20 }}>PLACE BET — NEXT RANKED GAME</div>

      {activeBet ? (
        <div style={{ background: "#010A13", border: "1px solid #C8AA6E44", borderRadius: 3, padding: 20 }}>
          <div style={{ color: "#C8AA6E", fontSize: 13, marginBottom: 8 }}>⏳ Active Bet</div>
          <div style={{ color: "#F0E6D3", fontSize: 24, fontWeight: 700 }}>{formatMoney(activeBet.amount)}</div>
          <div style={{ color: "#785A28", fontSize: 13, marginTop: 4 }}>
            Win to earn <span style={{ color: "#0BC4AA" }}>{formatMoney(activeBet.potentialWin)}</span>
          </div>
          <div style={{ color: "#785A2888", fontSize: 11, marginTop: 8 }}>Placed {timeAgo(activeBet.placedAt)}</div>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <label style={{ fontSize: 10, letterSpacing: 2, color: "#785A28" }}>BET AMOUNT</label>
              <span style={{ fontSize: 12, color: "#C8AA6E" }}>Max: ${MAX_BET}</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "#C8AA6E", fontSize: 18 }}>$</span>
              <input
                type="number" min={1} max={MAX_BET} value={amount}
                onChange={e => setAmount(Math.min(MAX_BET, Math.max(1, Number(e.target.value))))}
                style={{
                  flex: 1, background: "#010A13", border: "1px solid #C8AA6E44", color: "#F0E6D3",
                  padding: "12px", borderRadius: 3, fontFamily: "Cinzel, serif", fontSize: 20,
                  fontWeight: 700, textAlign: "center", outline: "none"
                }}
              />
            </div>
            <input
              type="range" min={1} max={MAX_BET} value={amount}
              onChange={e => setAmount(Number(e.target.value))}
              style={{ width: "100%", marginTop: 12, accentColor: "#C8AA6E" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#785A28" }}>
              <span>$1</span><span>${MAX_BET}</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {[5, 10, 20, 30].map(v => (
              <button key={v} onClick={() => setAmount(v)} style={{
                flex: 1, background: amount === v ? "#C8AA6E" : "#010A13",
                color: amount === v ? "#010A13" : "#785A28",
                border: "1px solid #785A2855", borderRadius: 3, padding: "6px",
                fontFamily: "Cinzel, serif", fontSize: 12, cursor: "pointer"
              }}>${v}</button>
            ))}
          </div>

          <div style={{ background: "#010A13", borderRadius: 3, padding: 16, marginBottom: 20, display: "flex", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: 2, color: "#785A28" }}>YOUR ODDS</div>
              <div style={{ color: "#C8AA6E", fontSize: 18, fontWeight: 700 }}>{odds}x</div>
              <div style={{ color: "#785A28", fontSize: 10 }}>{user.rank || "UNRANKED"}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: "#785A28" }}>IF YOU WIN</div>
              <div style={{ color: "#0BC4AA", fontSize: 24, fontWeight: 700 }}>{formatMoney(potentialWin)}</div>
              <div style={{ color: "#785A28", fontSize: 10 }}>{RAKE * 100}% rake applied</div>
            </div>
          </div>

          <button onClick={place} disabled={loading || !user.lolAccount} style={{
            width: "100%", background: user.lolAccount ? "linear-gradient(135deg, #C8AA6E, #785A28)" : "#785A2844",
            border: "none", color: "#010A13", padding: "14px",
            borderRadius: 3, fontFamily: "Cinzel, serif", fontSize: 14,
            fontWeight: 700, letterSpacing: 2, cursor: user.lolAccount ? "pointer" : "not-allowed",
            textTransform: "uppercase"
          }}>
            {loading ? "Placing..." : user.lolAccount ? "Place Bet" : "Link LoL Account First"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── RESOLVE BET ─────────────────────────────────────────────────────────────
function ResolveBet({ user, setUser, region, toast, showResult }) {
  const [loading, setLoading] = useState(false);
  const activeBet = user.bets?.find(b => b.status === "pending");

  const resolve = async () => {
    if (!activeBet) return;
    setLoading(true);
    try {
      const match = await riot.getLastMatchResult(user.puuid, region);

      // Check if this match was played after bet was placed
      if (match.gameEndTimestamp < activeBet.placedAt) {
        toast("No new ranked game found since your bet was placed. Play a game first!", "info");
        setLoading(false);
        return;
      }

      const won = match.win;
      const data = await apiCall("/api/bet", {
        action: "resolveBet",
        username: user.username,
        won,
        matchId: match.matchId,
        result: match
      });
      setUser(data.user);

      showResult({ result: match, bet: activeBet });
    } catch (e) {
      toast(`Error: ${e.message}`, "error");
    }
    setLoading(false);
  };

  if (!activeBet) return null;

  return (
    <div style={{ background: "#0A1628", border: "1px solid #C8AA6E44", borderRadius: 4, padding: 24 }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: "#785A28", marginBottom: 12 }}>RESOLVE YOUR BET</div>
      <p style={{ color: "#F0E6D388", fontSize: 13, fontFamily: "Crimson Text, serif", marginBottom: 16 }}>
        After finishing a ranked game, click below to check the result automatically via Riot's API.
      </p>
      <button onClick={resolve} disabled={loading} style={{
        background: "transparent", border: "1px solid #C8AA6E", color: "#C8AA6E",
        padding: "12px 24px", borderRadius: 3, fontFamily: "Cinzel, serif",
        fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: 1,
        transition: "all 0.2s", width: "100%"
      }}
        onMouseEnter={e => { e.target.style.background = "#C8AA6E22"; }}
        onMouseLeave={e => { e.target.style.background = "transparent"; }}
      >
        {loading ? "Checking Riot API..." : "🔍 Check My Last Game"}
      </button>
    </div>
  );
}

// ─── BET HISTORY ─────────────────────────────────────────────────────────────
function BetHistory({ bets }) {
  if (!bets?.length) return (
    <div style={{ background: "#0A1628", border: "1px solid #785A2844", borderRadius: 4, padding: 24, textAlign: "center" }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: "#785A28", marginBottom: 12 }}>BET HISTORY</div>
      <p style={{ color: "#785A2888", fontFamily: "Crimson Text, serif", fontStyle: "italic" }}>No bets yet. Place your first wager.</p>
    </div>
  );

  return (
    <div style={{ background: "#0A1628", border: "1px solid #785A2844", borderRadius: 4, padding: 24 }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: "#785A28", marginBottom: 16 }}>BET HISTORY</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[...bets].reverse().map(bet => (
          <div key={bet.id} style={{
            background: "#010A13", border: `1px solid ${bet.status === "won" ? "#0BC4AA33" : bet.status === "lost" ? "#C8464A33" : "#785A2833"}`,
            borderRadius: 3, padding: "14px 16px",
            display: "flex", justifyContent: "space-between", alignItems: "center"
          }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  fontSize: 10, letterSpacing: 1,
                  color: bet.status === "won" ? "#0BC4AA" : bet.status === "lost" ? "#C8464A" : "#C8AA6E",
                  border: `1px solid ${bet.status === "won" ? "#0BC4AA" : bet.status === "lost" ? "#C8464A" : "#C8AA6E"}`,
                  padding: "2px 8px", borderRadius: 2
                }}>
                  {bet.status.toUpperCase()}
                </span>
                {bet.result && <span style={{ color: "#785A28", fontSize: 12, fontFamily: "Crimson Text, serif" }}>
                  {bet.result.champion} — {bet.result.kills}/{bet.result.deaths}/{bet.result.assists}
                </span>}
              </div>
              <div style={{ color: "#785A2888", fontSize: 11, marginTop: 4 }}>{timeAgo(bet.placedAt)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#F0E6D3", fontSize: 16, fontWeight: 700 }}>
                {bet.status === "won" ? "+" : bet.status === "pending" ? "" : "-"}{formatMoney(bet.status === "won" ? bet.potentialWin : bet.amount)}
              </div>
              <div style={{ color: "#785A28", fontSize: 11 }}>bet: {formatMoney(bet.amount)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────
function Leaderboard() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leaderboard")
      .then(r => r.json())
      .then(data => { setUsers(data.users || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div style={{ background: "#0A1628", border: "1px solid #785A2844", borderRadius: 4, padding: 24 }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: "#785A28", marginBottom: 20 }}>LEADERBOARD</div>
      {loading ? <Loader /> : (
        <div>
          {users.map((u, i) => (
            <div key={u.username} style={{
              display: "flex", alignItems: "center", gap: 16,
              padding: "12px 0", borderBottom: "1px solid #785A2822"
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: i === 0 ? "#C8AA6E" : i === 1 ? "#A0A0A0" : i === 2 ? "#CD7F32" : "#785A2833",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700, color: i < 3 ? "#010A13" : "#785A28", flexShrink: 0
              }}>{i + 1}</div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#F0E6D3", fontSize: 14, fontWeight: 600 }}>{u.username}</div>
                <div style={{ color: "#785A28", fontSize: 11, fontFamily: "Crimson Text, serif" }}>
                  {u.lolAccount || "No LoL account"} {u.rank && `• ${u.rank}`}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#C8AA6E", fontSize: 16, fontWeight: 700 }}>{formatMoney(u.balance)}</div>
                <div style={{ color: "#785A28", fontSize: 11 }}>{u.wins}W / {u.total - u.wins}L</div>
              </div>
            </div>
          ))}
          {!users.length && <p style={{ color: "#785A2888", textAlign: "center", fontFamily: "Crimson Text, serif" }}>No players yet</p>}
        </div>
      )}
    </div>
  );
}



// ─── LIVE FEED ───────────────────────────────────────────────────────────────
const LIVE_CHAMPIONS = ["Jinx","Yasuo","Zed","Lux","Thresh","Ahri","Vi","Camille","Ezreal","Caitlyn","Jhin","Syndra","Akali","Yone","Vex","Garen","Darius","Nasus","Renekton","Orianna","Viktor","Azir","Katarina","LeBlanc","Twisted Fate"];
const LIVE_RANKS = ["IRON","BRONZE","SILVER","GOLD","PLATINUM","EMERALD","DIAMOND","MASTER"];
const LIVE_DIVS = ["IV","III","II","I"];
const RANK_COLORS = { IRON:"#9d9d9d", BRONZE:"#b87333", SILVER:"#a8b2c0", GOLD:"#C8AA6E", PLATINUM:"#4cc9b0", EMERALD:"#22c55e", DIAMOND:"#6ab0f5", MASTER:"#c084fc" };

function randomGame() {
  const rank = LIVE_RANKS[Math.floor(Math.random() * LIVE_RANKS.length)];
  const div = ["MASTER"].includes(rank) ? "" : " " + LIVE_DIVS[Math.floor(Math.random() * 4)];
  const champ = LIVE_CHAMPIONS[Math.floor(Math.random() * LIVE_CHAMPIONS.length)];
  const bet = [5, 10, 15, 20, 25, 30][Math.floor(Math.random() * 6)];
  const mins = Math.floor(Math.random() * 35) + 15;
  const k = Math.floor(Math.random() * 15);
  const d = Math.floor(Math.random() * 8);
  const a = Math.floor(Math.random() * 12);
  return { rank, div, champ, bet, mins, k, d, a, id: Math.random() };
}

function LiveFeed() {
  const [games, setGames] = useState(() => Array.from({ length: 4 }, randomGame));
  const [flash, setFlash] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const idx = Math.floor(Math.random() * 4);
      const newGame = randomGame();
      setFlash(idx);
      setTimeout(() => setFlash(null), 600);
      setGames(prev => prev.map((g, i) => i === idx ? newGame : g));
    }, 2800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ background: "#0A1628", border: "1px solid #785A2833", borderRadius: 8, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #785A2818", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 10, letterSpacing: 4, color: "#C8AA6E99" }}>LIVE GAMES</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#C8464A", boxShadow: "0 0 6px #C8464A", animation: "pulse 1.5s ease-in-out infinite" }} />
          <span style={{ fontSize: 10, color: "#C8464A", letterSpacing: 2, fontWeight: 700 }}>LIVE</span>
        </div>
      </div>

      {/* Game rows */}
      <div>
        {games.map((g, i) => (
          <div key={g.id} style={{
            padding: "10px 16px",
            borderBottom: i < 3 ? "1px solid #785A2811" : "none",
            background: flash === i ? "#C8AA6E06" : "transparent",
            transition: "background 0.3s ease"
          }}>
            {/* Top row: champion + bet */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#F0E6D3", letterSpacing: 0.5 }}>{g.champ}</span>
              <span style={{ fontSize: 13, fontWeight: 900, color: "#C8AA6E" }}>${g.bet}</span>
            </div>
            {/* Bottom row: rank + game time + kda */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: RANK_COLORS[g.rank] || "#785A28", letterSpacing: 1, fontWeight: 600 }}>
                {g.rank}{g.div}
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#F0E6D355", fontFamily: "Crimson Text, serif" }}>{g.mins}m</span>
                <span style={{ fontSize: 11, color: "#F0E6D344" }}>{g.k}/{g.d}/{g.a}</span>
              </div>
            </div>
            {/* Progress bar showing game time */}
            <div style={{ marginTop: 6, height: 2, background: "#785A2811", borderRadius: 1 }}>
              <div style={{ height: "100%", width: `${(g.mins / 50) * 100}%`, background: `linear-gradient(90deg, #785A28, ${RANK_COLORS[g.rank] || "#C8AA6E"})`, borderRadius: 1, transition: "width 0.5s ease" }} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: "8px 16px", borderTop: "1px solid #785A2811", textAlign: "center" }}>
        <span style={{ fontSize: 10, color: "#785A28", letterSpacing: 2 }}>UPDATES EVERY FEW SECONDS</span>
      </div>
    </div>
  );
}

// ─── VICTORY / DEFEAT SCREEN ─────────────────────────────────────────────────
function ResultScreen({ result, bet, onClose }) {
  const won = result?.win;

  useEffect(() => {
    const t = setTimeout(onClose, 12000);
    return () => clearTimeout(t);
  }, [onClose]);

  // Confetti particles
  const confetti = won ? Array.from({length: 80}, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 2,
    duration: 2 + Math.random() * 3,
    color: ["#C8AA6E","#0BC4AA","#F0E6D3","#C8464A","#785A28","#FFD700","#FF6B6B","#4ECDC4"][Math.floor(Math.random() * 8)],
    size: 6 + Math.random() * 10,
    rotation: Math.random() * 360
  })) : [];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: won ? "rgba(0,0,0,0.92)" : "rgba(0,0,0,0.95)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.4s ease",
      overflow: "hidden"
    }}>
      <style>{`
        @keyframes confettiFall {
          0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
        }
        @keyframes victoryPulse {
          0%, 100% { transform: scale(1); text-shadow: 0 0 40px #C8AA6E88; }
          50% { transform: scale(1.05); text-shadow: 0 0 80px #C8AA6Ecc; }
        }
        @keyframes slideUpBig {
          from { transform: translateY(60px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes floatIcon {
          0%, 100% { transform: translateY(0px) scale(1); }
          50% { transform: translateY(-10px) scale(1.05); }
        }
      `}</style>

      {/* Confetti */}
      {confetti.map(p => (
        <div key={p.id} style={{
          position: "absolute",
          left: `${p.x}%`,
          top: -20,
          width: p.size,
          height: p.size,
          background: p.color,
          borderRadius: Math.random() > 0.5 ? "50%" : "2px",
          animation: `confettiFall ${p.duration}s ${p.delay}s linear infinite`,
          transform: `rotate(${p.rotation}deg)`,
          pointerEvents: "none"
        }} />
      ))}

      {/* Main card */}
      <div style={{
        background: won
          ? "linear-gradient(145deg, #0A1628 0%, #0d1f3c 50%, #0A1628 100%)"
          : "linear-gradient(145deg, #1a0505 0%, #0A1628 50%, #1a0505 100%)",
        border: `2px solid ${won ? "#C8AA6E" : "#C8464A"}`,
        borderRadius: 12,
        padding: "48px 56px",
        maxWidth: 480,
        width: "90%",
        textAlign: "center",
        animation: "slideUpBig 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
        position: "relative",
        boxShadow: won ? "0 0 80px #C8AA6E33, 0 0 160px #C8AA6E11" : "0 0 80px #C8464A22"
      }}>

        {/* Big icon */}
        <div style={{
          fontSize: 80, marginBottom: 16, lineHeight: 1,
          animation: "floatIcon 3s ease-in-out infinite"
        }}>
          {won ? "🏆" : "💀"}
        </div>

        {/* Win/Loss title */}
        <div style={{
          fontFamily: "Cinzel, serif",
          fontSize: 42, fontWeight: 900,
          color: won ? "transparent" : "#C8464A",
          background: won ? "linear-gradient(90deg, #C8AA6E, #FFD700, #C8AA6E, #785A28, #C8AA6E)" : "none",
          backgroundSize: won ? "200% auto" : "auto",
          WebkitBackgroundClip: won ? "text" : "unset",
          WebkitTextFillColor: won ? "transparent" : "#C8464A",
          animation: won ? "shimmer 3s linear infinite, victoryPulse 2s ease-in-out infinite" : "none",
          marginBottom: 8, letterSpacing: 4
        }}>
          {won ? "VICTORY" : "DEFEAT"}
        </div>

        <div style={{
          width: 80, height: 2,
          background: `linear-gradient(90deg, transparent, ${won ? "#C8AA6E" : "#C8464A"}, transparent)`,
          margin: "0 auto 28px"
        }} />

        {/* Game stats card */}
        {result && (
          <div style={{
            background: "#010A13",
            border: `1px solid ${won ? "#C8AA6E33" : "#C8464A33"}`,
            borderRadius: 8, padding: "20px 24px", marginBottom: 24
          }}>
            <div style={{ color: "#785A28", fontSize: 10, letterSpacing: 3, marginBottom: 12 }}>MATCH RESULT</div>
            <div style={{ color: "#C8AA6E", fontSize: 22, fontWeight: 700, fontFamily: "Cinzel, serif", marginBottom: 16 }}>
              {result.champion}
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 0, marginBottom: 16 }}>
              {[
                { label: "KILLS", value: result.kills, color: "#0BC4AA" },
                { label: "DEATHS", value: result.deaths, color: "#C8464A" },
                { label: "ASSISTS", value: result.assists, color: "#C8AA6E" }
              ].map((s, i) => (
                <div key={s.label} style={{
                  flex: 1,
                  borderRight: i < 2 ? "1px solid #785A2833" : "none",
                  padding: "0 16px"
                }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: s.color, fontFamily: "Cinzel, serif" }}>{s.value}</div>
                  <div style={{ fontSize: 9, letterSpacing: 2, color: "#785A28", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "#785A28", fontFamily: "Crimson Text, serif" }}>
              KDA: <span style={{ color: "#F0E6D3" }}>
                {result.deaths === 0 ? "Perfect" : ((result.kills + result.assists) / result.deaths).toFixed(2)}
              </span>
            </div>
          </div>
        )}

        {/* Payout info */}
        <div style={{
          background: won ? "#C8AA6E11" : "#C8464A11",
          border: `1px solid ${won ? "#C8AA6E33" : "#C8464A33"}`,
          borderRadius: 6, padding: "16px 20px", marginBottom: 28
        }}>
          {won ? (
            <>
              <div style={{ color: "#785A28", fontSize: 11, letterSpacing: 2, marginBottom: 4 }}>WINNINGS</div>
              <div style={{ color: "#0BC4AA", fontSize: 32, fontWeight: 900, fontFamily: "Cinzel, serif" }}>
                +${Number(bet?.potentialWin || 0).toFixed(2)}
              </div>
              <div style={{ color: "#785A28", fontSize: 11, marginTop: 4 }}>added to your balance</div>
            </>
          ) : (
            <>
              <div style={{ color: "#785A28", fontSize: 11, letterSpacing: 2, marginBottom: 4 }}>LOST</div>
              <div style={{ color: "#C8464A", fontSize: 32, fontWeight: 900, fontFamily: "Cinzel, serif" }}>
                -${Number(bet?.amount || 0).toFixed(2)}
              </div>
              <div style={{ color: "#785A28", fontSize: 11, marginTop: 4 }}>better luck next time, summoner</div>
            </>
          )}
        </div>

        <button onClick={onClose} style={{
          background: won ? "linear-gradient(135deg, #C8AA6E, #785A28)" : "transparent",
          border: won ? "none" : "1px solid #C8464A55",
          color: won ? "#010A13" : "#C8464A",
          padding: "12px 40px", borderRadius: 4,
          fontFamily: "Cinzel, serif", fontSize: 13, fontWeight: 700,
          cursor: "pointer", letterSpacing: 2, textTransform: "uppercase"
        }}>
          {won ? "Claim Victory" : "Try Again"}
        </button>

        <div style={{ color: "#785A2855", fontSize: 10, marginTop: 12, fontFamily: "Crimson Text, serif" }}>
          closes automatically in 12 seconds
        </div>
      </div>
    </div>
  );
}

// ─── DEBUG PANEL (admin only) ────────────────────────────────────────────────
function DebugPanel({ user, setUser, toast, showResult }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const activeBet = user.bets?.find(b => b.status === "pending");

  const simulate = async (won) => {
    if (!activeBet) return toast("Place a bet first", "error");
    setLoading(true);
    try {
      const fakeMatch = {
        matchId: `DEBUG_${Date.now()}`,
        win: won,
        champion: "Teemo",
        kills: won ? 10 : 0,
        deaths: won ? 1 : 10,
        assists: 5,
        gameEndTimestamp: Date.now()
      };
      const data = await apiCall("/api/bet", {
        action: "resolveBet",
        username: user.username,
        won,
        matchId: fakeMatch.matchId,
        result: fakeMatch
      });
      setUser(data.user);
      showResult({ result: fakeMatch, bet: activeBet });
    } catch(e) {
      toast(e.message, "error");
    }
    setLoading(false);
  };

  const resetBalance = async () => {
    setLoading(true);
    try {
      const data = await apiCall("/api/debug", { action: "resetBalance", username: user.username });
      setUser(data.user);
      toast("Balance reset to $500", "success");
    } catch(e) {
      toast(e.message, "error");
    }
    setLoading(false);
  };

  return (
    <div style={{ position: "fixed", bottom: 80, right: 24, zIndex: 9998 }}>
      <button onClick={() => setOpen(!open)} style={{
        background: "#1a1a2e", border: "1px solid #444", color: "#888",
        padding: "6px 12px", borderRadius: 3, cursor: "pointer",
        fontFamily: "monospace", fontSize: 11
      }}>🛠 debug</button>
      {open && (
        <div style={{
          position: "absolute", bottom: 36, right: 0, background: "#1a1a2e",
          border: "1px solid #444", borderRadius: 4, padding: 16, width: 220,
          display: "flex", flexDirection: "column", gap: 8
        }}>
          <div style={{ color: "#888", fontSize: 10, letterSpacing: 2, marginBottom: 4 }}>DEBUG TOOLS</div>
          <div style={{ color: "#555", fontSize: 11, fontFamily: "monospace" }}>
            Active bet: {activeBet ? `$${activeBet.amount}` : "none"}
          </div>
          <button onClick={() => simulate(true)} disabled={loading || !activeBet} style={{
            background: "#0BC4AA22", border: "1px solid #0BC4AA55", color: "#0BC4AA",
            padding: "8px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", fontSize: 12
          }}>✓ Simulate WIN</button>
          <button onClick={() => simulate(false)} disabled={loading || !activeBet} style={{
            background: "#C8464A22", border: "1px solid #C8464A55", color: "#C8464A",
            padding: "8px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", fontSize: 12
          }}>✗ Simulate LOSS</button>
          <button onClick={resetBalance} disabled={loading} style={{
            background: "#C8AA6E22", border: "1px solid #C8AA6E55", color: "#C8AA6E",
            padding: "8px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace", fontSize: 12
          }}>↺ Reset Balance $500</button>
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [region, setRegion] = useState("euw1");
  const [resultScreen, setResultScreen] = useState(null); // { result, bet }

  const showToast = useCallback((message, type = "info") => {
    setToast({ message, type, id: Date.now() });
  }, []);

  const updateUser = useCallback((updated) => {
    setUser(updated);
  }, []);

  if (!user) return <AuthPage onLogin={setUser} />;

  const stats = {
    wins: user.bets?.filter(b => b.status === "won").length || 0,
    losses: user.bets?.filter(b => b.status === "lost").length || 0,
    totalWagered: user.bets?.reduce((s, b) => s + (b.status !== "pending" ? b.amount : 0), 0) || 0,
    totalEarned: user.bets?.filter(b => b.status === "won").reduce((s, b) => s + b.potentialWin, 0) || 0
  };

  const tabs = ["dashboard", "bet", "history", "leaderboard"];

  return (
    <div style={{ minHeight: "100vh", background: "#010A13", fontFamily: "Cinzel, serif", color: "#F0E6D3" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes shimmerBar { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        input, select { outline: none; }
        input::placeholder { color: #785A2888; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #010A13; } ::-webkit-scrollbar-thumb { background: #785A28; border-radius: 3px; }
      `}</style>

      {/* Top bar */}
      <div style={{ borderBottom: "1px solid #785A2833", background: "#0A1628" }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 10, letterSpacing: 4, color: "#785A28" }}>RUNETERRA</span>
            <span style={{ color: "#785A2844" }}>|</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#C8AA6E" }}>WAGERS</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, letterSpacing: 2, color: "#785A28" }}>BALANCE</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#C8AA6E" }}>{formatMoney(user.balance)}</div>
            </div>
            <div style={{ width: 1, height: 32, background: "#785A2833" }} />
            <div style={{ fontSize: 12, color: "#785A28" }}>{user.username}</div>
            <button onClick={() => setUser(null)} style={{
              background: "none", border: "1px solid #785A2855", color: "#785A28",
              padding: "4px 10px", borderRadius: 3, cursor: "pointer",
              fontFamily: "Cinzel, serif", fontSize: 10, letterSpacing: 1
            }}>LOGOUT</button>
          </div>
        </div>

        {/* Nav tabs */}
        <div style={{ display: "flex", padding: "0 24px", gap: 4 }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "10px 16px", fontFamily: "Cinzel, serif", fontSize: 11,
              letterSpacing: 2, textTransform: "uppercase",
              color: tab === t ? "#C8AA6E" : "#785A28",
              borderBottom: `2px solid ${tab === t ? "#C8AA6E" : "transparent"}`,
              transition: "all 0.2s"
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Content — wide 3-col layout */}
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 220px", gap: 0, minHeight: "calc(100vh - 100px)", animation: "fadeIn 0.3s ease" }}>

        {/* LEFT SIDEBAR */}
        <div style={{ padding: "24px 16px 24px 24px", borderRight: "1px solid #785A2818", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Player card */}
          <div style={{ background: "#0A1628", border: "1px solid #785A2833", borderRadius: 8, padding: "18px 16px" }}>
            <div style={{ fontSize: 10, letterSpacing: 4, color: "#C8AA6E99", marginBottom: 10 }}>SUMMONER</div>
            <div style={{ color: "#F0E6D3", fontSize: 18, fontWeight: 900, letterSpacing: 1, marginBottom: 4 }}>{user.username}</div>
            {user.lolAccount ? (
              <>
                <div style={{ color: "#C8AA6E", fontSize: 13, fontFamily: "Crimson Text, serif", marginBottom: 10 }}>{user.lolAccount}</div>
                <div style={{
                  display: "inline-block", background: "linear-gradient(135deg, #C8AA6E22, #785A2811)",
                  border: "1px solid #C8AA6E55", borderRadius: 3, padding: "4px 12px",
                  fontSize: 11, color: "#C8AA6E", letterSpacing: 2, fontWeight: 700
                }}>
                  {user.rank || "UNRANKED"}
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <div style={{ flex: 1, textAlign: "center", background: "#010A13", borderRadius: 4, padding: "8px 4px" }}>
                    <div style={{ color: "#0BC4AA", fontSize: 18, fontWeight: 900 }}>{stats.wins}</div>
                    <div style={{ color: "#785A2877", fontSize: 9, letterSpacing: 2, marginTop: 2 }}>WINS</div>
                  </div>
                  <div style={{ flex: 1, textAlign: "center", background: "#010A13", borderRadius: 4, padding: "8px 4px" }}>
                    <div style={{ color: "#C8464A", fontSize: 18, fontWeight: 900 }}>{stats.losses}</div>
                    <div style={{ color: "#785A2877", fontSize: 9, letterSpacing: 2, marginTop: 2 }}>LOSSES</div>
                  </div>
                  <div style={{ flex: 1, textAlign: "center", background: "#010A13", borderRadius: 4, padding: "8px 4px" }}>
                    <div style={{ color: "#C8AA6E", fontSize: 18, fontWeight: 900 }}>
                      {stats.wins + stats.losses > 0 ? `${Math.round(stats.wins / (stats.wins + stats.losses) * 100)}%` : "--"}
                    </div>
                    <div style={{ color: "#785A2877", fontSize: 9, letterSpacing: 2, marginTop: 2 }}>W/R</div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ color: "#785A28", fontSize: 13, fontFamily: "Crimson Text, serif", fontStyle: "italic", marginTop: 4 }}>No account linked</div>
            )}
          </div>

          {/* Balance card */}
          <div style={{ background: "linear-gradient(135deg, #0d1f3c, #0A1628)", border: "1px solid #C8AA6E22", borderRadius: 8, padding: "18px 16px" }}>
            <div style={{ fontSize: 10, letterSpacing: 4, color: "#C8AA6E99", marginBottom: 6 }}>BALANCE</div>
            <div style={{ color: "#C8AA6E", fontSize: 28, fontWeight: 900, letterSpacing: 1 }}>{formatMoney(user.balance)}</div>
            <div style={{ marginTop: 10, height: 2, background: "#785A2818", borderRadius: 2 }}>
              <div style={{ height: "100%", width: `${Math.min(100, (user.balance / 500) * 100)}%`, background: "linear-gradient(90deg, #785A28, #C8AA6E)", borderRadius: 2, transition: "width 0.5s ease" }} />
            </div>
            <div style={{ color: "#785A28", fontSize: 12, marginTop: 6, fontFamily: "Crimson Text, serif" }}>of $500.00 starting gold</div>
          </div>

          {/* Active bet */}
          {(() => {
            const activeBet = user.bets?.find(b => b.status === "pending");
            return activeBet ? (
              <div style={{ background: "#0A1628", border: "1px solid #C8AA6E44", borderRadius: 8, padding: "18px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 10, letterSpacing: 4, color: "#C8AA6E" }}>ACTIVE BET</div>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#C8AA6E", boxShadow: "0 0 8px #C8AA6E", animation: "pulse 1.5s ease-in-out infinite" }} />
                </div>
                <div style={{ color: "#C8AA6E", fontSize: 26, fontWeight: 900 }}>{formatMoney(activeBet.amount)}</div>
                <div style={{ color: "#F0E6D3", fontSize: 13, marginTop: 4, fontFamily: "Crimson Text, serif" }}>
                  Potential win: <span style={{ color: "#0BC4AA", fontWeight: 700 }}>{formatMoney(activeBet.potentialWin)}</span>
                </div>
                <div style={{ color: "#785A28", fontSize: 12, marginTop: 4, fontFamily: "Crimson Text, serif" }}>{timeAgo(activeBet.placedAt)}</div>
              </div>
            ) : (
              <div style={{ background: "#0A162844", border: "1px solid #785A2818", borderRadius: 8, padding: "18px 16px", textAlign: "center" }}>
                <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2px dashed #785A2833", margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ width: 10, height: 10, background: "#785A2833", borderRadius: "50%" }} />
                </div>
                <div style={{ color: "#785A2866", fontSize: 13, fontFamily: "Crimson Text, serif" }}>No active bet</div>
              </div>
            );
          })()}

          {/* Odds table */}
          <div style={{ background: "#0A1628", border: "1px solid #785A2833", borderRadius: 8, padding: "18px 16px" }}>
            <div style={{ fontSize: 10, letterSpacing: 4, color: "#C8AA6E99", marginBottom: 14 }}>MULTIPLIERS</div>
            {[["IRON","1.60x"],["BRONZE","1.55x"],["SILVER","1.50x"],["GOLD","1.45x"],["PLATINUM","1.40x"],["EMERALD","1.38x"],["DIAMOND","1.35x"],["MASTER+","1.15x"]].map(([r,o]) => {
              const isMyRank = user.rank?.toUpperCase().startsWith(r.split("+")[0]);
              return (
                <div key={r} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", marginBottom: 2, borderRadius: 3, background: isMyRank ? "#C8AA6E11" : "transparent", border: isMyRank ? "1px solid #C8AA6E22" : "1px solid transparent" }}>
                  <span style={{ fontSize: 11, color: isMyRank ? "#C8AA6E" : "#785A2866", fontWeight: isMyRank ? 700 : 400 }}>{r}</span>
                  <span style={{ fontSize: 12, color: isMyRank ? "#C8AA6E" : "#785A2844", fontWeight: 700 }}>{o}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* CENTER CONTENT */}
        <div style={{ padding: "24px 24px" }}>
          {tab === "dashboard" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <LinkAccount user={user} setUser={updateUser} region={region} setRegion={setRegion} toast={showToast} />
              <PlaceBet user={user} setUser={updateUser} toast={showToast} />
              <ResolveBet user={user} setUser={updateUser} region={region} toast={showToast} showResult={setResultScreen} />
            </div>
          )}
          {tab === "bet" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <LinkAccount user={user} setUser={updateUser} region={region} setRegion={setRegion} toast={showToast} />
              <PlaceBet user={user} setUser={updateUser} toast={showToast} />
              <ResolveBet user={user} setUser={updateUser} region={region} toast={showToast} showResult={setResultScreen} />
            </div>
          )}
          {tab === "history" && <BetHistory bets={user.bets} />}
          {tab === "leaderboard" && <Leaderboard />}
        </div>

        {/* RIGHT SIDEBAR */}
        <div style={{ padding: "24px 24px 24px 16px", borderLeft: "1px solid #785A2818", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Live Games Feed */}
          <LiveFeed />

          {/* Recent bets */}
          <div style={{ background: "#0A1628", border: "1px solid #785A2833", borderRadius: 8, padding: "18px 16px" }}>
            <div style={{ fontSize: 10, letterSpacing: 4, color: "#C8AA6E99", marginBottom: 14 }}>YOUR RECENT BETS</div>
            {user.bets?.filter(b => b.status !== "pending").length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[...user.bets].reverse().filter(b => b.status !== "pending").slice(0, 4).map(bet => (
                  <div key={bet.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 4, background: bet.status === "won" ? "#0BC4AA08" : "#C8464A08", border: `1px solid ${bet.status === "won" ? "#0BC4AA22" : "#C8464A22"}` }}>
                    <div>
                      <div style={{ fontSize: 12, color: bet.status === "won" ? "#0BC4AA" : "#C8464A", fontWeight: 700, letterSpacing: 1 }}>
                        {bet.status === "won" ? "WIN" : "LOSS"}
                      </div>
                      {bet.result?.champion && <div style={{ fontSize: 11, color: "#785A28", fontFamily: "Crimson Text, serif", marginTop: 1 }}>{bet.result.champion} · {bet.result.kills}/{bet.result.deaths}/{bet.result.assists}</div>}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: bet.status === "won" ? "#0BC4AA" : "#C8464A" }}>
                      {bet.status === "won" ? "+" : "-"}{formatMoney(bet.status === "won" ? bet.potentialWin : bet.amount)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "#785A28", fontSize: 13, fontFamily: "Crimson Text, serif", fontStyle: "italic", textAlign: "center", padding: "16px 0" }}>
                No completed bets yet
              </div>
            )}
          </div>

          {/* Rules card */}
          <div style={{ background: "#0A1628", border: "1px solid #785A2833", borderRadius: 8, padding: "18px 16px" }}>
            <div style={{ fontSize: 10, letterSpacing: 4, color: "#C8AA6E99", marginBottom: 14 }}>HOUSE RULES</div>
            {[
              ["Solo/Duo ranked only", "Flex & normals don't count"],
              ["$1 — $30 per bet", "One active bet at a time"],
              ["5% rake on winnings", "Losses return nothing"],
              ["Results via Riot API", "No disputes possible"],
            ].map(([rule, sub], i) => (
              <div key={i} style={{ paddingBottom: 10, marginBottom: 10, borderBottom: i < 3 ? "1px solid #785A2811" : "none" }}>
                <div style={{ fontSize: 13, color: "#F0E6D3", fontWeight: 600 }}>{rule}</div>
                <div style={{ fontSize: 12, color: "#785A28", fontFamily: "Crimson Text, serif", marginTop: 2 }}>{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      {user.username === "palapourheal" && <DebugPanel user={user} setUser={updateUser} toast={showToast} showResult={setResultScreen} />}
      {resultScreen && <ResultScreen result={resultScreen.result} bet={resultScreen.bet} onClose={() => setResultScreen(null)} />}
    </div>
  );
}
