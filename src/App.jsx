import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const STARTING_BALANCE = 500;
const spendableBalance = (balance) => Math.max(0, balance - STARTING_BALANCE);
const MAX_BET = 30; // virtual only
const MAX_REAL_BET = 1.00; // $1 max for real money
const RAKE = 0.05; // 5%
// API key is handled server-side via /api/riot

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const getRankTier = (rankStr) => {
  if (!rankStr) return "UNRANKED";
  return rankStr.split(" ")[0].toUpperCase();
};

// ─── WINRATE → MULTIPLIER FORMULA ────────────────────────────────────────────
// Mathematical basis: fair odds for a win = 1 / win_probability
// A 50% WR player has 0.50 win prob → fair odds = 2.00x
// We apply a 10% house edge: multiplier = (1 / win_prob) * 0.90
// Then clamp between 1.20x (dominant player) and 3.50x (struggling player)
// No winrate data → 1.80x default (slightly below fair coin flip, house favoured)
const getOdds = (winrate) => {
  if (winrate == null) return 1.80;
  const winProb = Math.max(0.20, Math.min(0.80, winrate / 100));
  const raw = (1 / winProb) * 0.90;
  return Math.round(Math.max(1.20, Math.min(3.50, raw)) * 100) / 100;
};

// Winrate label for UI — describes the tier in plain english
const getOddsLabel = (winrate) => {
  if (winrate == null) return "No data";
  if (winrate >= 65) return "Dominant";
  if (winrate >= 55) return "Favoured";
  if (winrate >= 48) return "Balanced";
  if (winrate >= 40) return "Underdog";
  return "High Risk";
};

// Winrate bracket description for the multiplier table
const WR_BRACKETS = [
  { label: "65%+ WR", range: "65%+", odds: getOdds(67), desc: "Dominant" },
  { label: "58–64% WR", range: "58–64%", odds: getOdds(61), desc: "Favoured" },
  { label: "52–57% WR", range: "52–57%", odds: getOdds(54), desc: "Above average" },
  { label: "48–51% WR", range: "48–51%", odds: getOdds(50), desc: "Balanced" },
  { label: "42–47% WR", range: "42–47%", odds: getOdds(44), desc: "Underdog" },
  { label: "< 42% WR", range: "<42%", odds: getOdds(38), desc: "High Risk" },
];

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
      <span style={{ color: "#A0A0A8", fontSize: 13, fontFamily: "Barlow Condensed, sans-serif" }}>{text}</span>
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
      background: "#1A1A1E", border: `1px solid ${colors[type] || colors.info}`,
      color: "#F0F0F0", padding: "14px 20px", borderRadius: 4,
      fontFamily: "Barlow Condensed, sans-serif", fontSize: 13, maxWidth: 320,
      boxShadow: `0 4px 24px ${colors[type] || colors.info}44`,
      animation: "slideUp 0.3s ease"
    }}>
      {message}
    </div>
  );
}


// ─── SVG ICON COMPONENTS ─────────────────────────────────────────────────────
function FeatureIcon({ type }) {
  const s = { width: 28, height: 28, flexShrink: 0 };
  const icons = {
    target: (
      <svg {...s} viewBox="0 0 28 28" fill="none">
        <circle cx="14" cy="14" r="12" stroke="#C8AA6E" strokeWidth="1.5"/>
        <circle cx="14" cy="14" r="7" stroke="#C8AA6E" strokeWidth="1.5" strokeDasharray="3 2"/>
        <circle cx="14" cy="14" r="3" fill="#C8AA6E"/>
        <line x1="14" y1="2" x2="14" y2="6" stroke="#C8AA6E" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="14" y1="22" x2="14" y2="26" stroke="#C8AA6E" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="2" y1="14" x2="6" y2="14" stroke="#C8AA6E" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="22" y1="14" x2="26" y2="14" stroke="#C8AA6E" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
    coin: (
      <svg {...s} viewBox="0 0 28 28" fill="none">
        <circle cx="14" cy="14" r="11" stroke="#C8AA6E" strokeWidth="1.5"/>
        <circle cx="14" cy="14" r="7" fill="#C8AA6E22" stroke="#C8AA6E" strokeWidth="1"/>
        <text x="14" y="18" textAnchor="middle" fill="#C8AA6E" fontSize="10" fontWeight="700" fontFamily="sans-serif">$</text>
      </svg>
    ),
    gift: (
      <svg {...s} viewBox="0 0 28 28" fill="none">
        <rect x="4" y="13" width="20" height="12" rx="1.5" stroke="#C8AA6E" strokeWidth="1.5"/>
        <rect x="6" y="10" width="16" height="5" rx="1" stroke="#C8AA6E" strokeWidth="1.5"/>
        <line x1="14" y1="10" x2="14" y2="25" stroke="#C8AA6E" strokeWidth="1.5"/>
        <path d="M14 10 C14 10 10 10 10 7 C10 4 14 4 14 7" stroke="#C8AA6E" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        <path d="M14 10 C14 10 18 10 18 7 C18 4 14 4 14 7" stroke="#C8AA6E" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      </svg>
    ),
    chart: (
      <svg {...s} viewBox="0 0 28 28" fill="none">
        <line x1="4" y1="24" x2="24" y2="24" stroke="#C8AA6E" strokeWidth="1.5" strokeLinecap="round"/>
        <rect x="5" y="16" width="4" height="8" rx="1" fill="#C8AA6E" opacity="0.5"/>
        <rect x="12" y="10" width="4" height="14" rx="1" fill="#C8AA6E" opacity="0.75"/>
        <rect x="19" y="5" width="4" height="19" rx="1" fill="#C8AA6E"/>
      </svg>
    ),
  };
  return icons[type] || null;
}

function RewardIcon({ type }) {
  const s = { width: 20, height: 20, flexShrink: 0 };
  const icons = {
    diamond: (
      <svg {...s} viewBox="0 0 20 20" fill="none">
        <polygon points="10,2 18,8 14,18 6,18 2,8" stroke="#0BC4AA" strokeWidth="1.5" fill="#0BC4AA22"/>
        <polygon points="10,5 15,9 12,15 8,15 5,9" fill="#0BC4AA" opacity="0.4"/>
      </svg>
    ),
    rp: (
      <svg {...s} viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" stroke="#C8AA6E" strokeWidth="1.5"/>
        <text x="10" y="14" textAnchor="middle" fill="#C8AA6E" fontSize="8" fontWeight="700" fontFamily="sans-serif">RP</text>
      </svg>
    ),
    bundle: (
      <svg {...s} viewBox="0 0 20 20" fill="none">
        <rect x="2" y="7" width="16" height="11" rx="1.5" stroke="#C8AA6E" strokeWidth="1.5"/>
        <path d="M6 7 C6 4 14 4 14 7" stroke="#C8AA6E" strokeWidth="1.5" fill="none"/>
        <line x1="10" y1="10" x2="10" y2="15" stroke="#C8AA6E" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1="7" y1="12.5" x2="13" y2="12.5" stroke="#C8AA6E" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  };
  return icons[type] || null;
}

// ─── AUTH DYNAMIC COMPONENTS ─────────────────────────────────────────────────
const TICKER_EVENTS = [
  "palapourheal won $18.50 on Jinx · GOLD IV",
  "xXSlayerXx lost $10.00 on Yasuo · SILVER II",
  "MidOrFeed won $25.65 on Ahri · PLATINUM I",
  "TopLaner99 won $12.35 on Darius · BRONZE III",
  "JungleKing lost $20.00 on Vi · GOLD II",
  "ADCarry won $28.50 on Caitlyn · DIAMOND IV",
  "SupportMain won $9.50 on Thresh · SILVER I",
  "CarryDiff won $14.25 on Akali · EMERALD II",
  "OnetrICK lost $15.00 on Zed · PLATINUM III",
  "RiftWalker won $22.80 on Orianna · MASTER",
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
    <div style={{ overflow: "hidden", background: "#141416", borderTop: "1px solid #2D2D32", borderBottom: "1px solid #2D2D32", padding: "8px 0", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 0, whiteSpace: "nowrap", transform: `translateX(-${offset}px)`, transition: "none" }}>
        {[...TICKER_EVENTS, ...TICKER_EVENTS].map((e, i) => (
          <span key={i} style={{ fontSize: 13, color: e.includes("won") ? "#3FB950" : "#F85149", fontFamily: "DM Sans, sans-serif", padding: "0 24px", flexShrink: 0 }}>
            {e}
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
    <div style={{ display: "flex", justifyContent: "center", gap: 0, padding: "16px 48px", borderBottom: "1px solid #222225" }}>
      {[
        { label: "TOTAL BETS PLACED", value: 1847, suffix: "" },
        { label: "GOLD WAGERED", value: 24390, prefix: "$" },
        { label: "ACTIVE PLAYERS", value: 312, suffix: "" },
        { label: "BIGGEST WIN TODAY", value: 47.25, prefix: "$", isFloat: true },
      ].map((s, i) => (
        <div key={i} style={{ flex: 1, textAlign: "center", padding: "0 16px", borderRight: i < 3 ? "1px solid #252528" : "none" }}>
          <div style={{ color: "#C8AA6E", fontSize: 18, fontWeight: 700, fontFamily: "Barlow Condensed, sans-serif" }}>
            {s.isFloat ? `$${s.value.toFixed(2)}` : <AnimatedCounter target={s.value} prefix={s.prefix || ""} suffix={s.suffix || ""} />}
          </div>
          <div style={{ color: "#C0C0C8", fontSize: 9, letterSpacing: 3, marginTop: 4 }}>{s.label}</div>
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
    <div style={{ background: "#1A1A1E", border: "1px solid #2A2A2E", borderRadius: 6, overflow: "hidden", marginTop: 16 }}>
      <div style={{ padding: "8px 14px", borderBottom: "1px solid #222225", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 9, letterSpacing: 3, color: "#A0A0A8" }}>RECENT ACTIVITY</span>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#C8464A", animation: "pulse 1.5s ease-in-out infinite" }} />
          <span style={{ fontSize: 9, color: "#C8464A", letterSpacing: 2 }}>LIVE</span>
        </div>
      </div>
      {wins.map((w, i) => (
        <div key={i} style={{
          padding: "10px 14px", borderBottom: "1px solid #222225",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          opacity: i === visible ? 1 : i === (visible - 1 + wins.length) % wins.length ? 0.5 : 0.2,
          transition: "opacity 0.5s ease",
          background: i === visible ? (w.won ? "#0BC4AA06" : "#C8464A06") : "transparent"
        }}>
          <div>
            <div style={{ fontSize: 15, color: "#FFFFFF", fontWeight: 600 }}>{w.player}</div>
            <div style={{ fontSize: 13, color: "#A0A0A8" }}>{w.champ} · {w.rank}</div>
          </div>
          <div style={{ fontSize: 14, fontWeight: 900, color: w.won ? "#3FB950" : "#F85149" }}>
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
  const [username, setUsername] = useState(() => localStorage.getItem("rw_saved_username") || "");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(() => !!localStorage.getItem("rw_saved_username"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handle = async () => {
    if (!username.trim() || !password.trim()) return setError("Fill all fields");
    setLoading(true); setError("");
    try {
      const data = await apiCall("/api/auth", { action: mode === "register" ? "register" : "login", username: username.trim(), password });
      if (rememberMe) {
        localStorage.setItem("rw_saved_username", username.trim());
        localStorage.setItem("rw_session_user", JSON.stringify(data.user));
      } else {
        localStorage.removeItem("rw_saved_username");
        localStorage.removeItem("rw_session_user");
      }
      onLogin(data.user);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  const features = [
    { icon: "target", title: "Bet on Your Own Games", desc: "Wager on your next ranked Solo/Duo match. Only wins count · no match fixing possible." },
    { icon: "coin", title: "Earn Virtual Gold", desc: "Win games, stack gold. Your winrate determines your odds · below 40% WR earns up to 3.00x." },
    { icon: "gift", title: "Redeem for Rewards", desc: "Use your gold balance to claim RP, skins, or champion bundles. Coming soon." },
    { icon: "chart", title: "Compete on Leaderboards", desc: "See where you rank among your friends. Who's the best at backing themselves?" },
  ];

  const howItWorks = [
    { step: "01", text: "Create an account & link your LoL profile via icon verification" },
    { step: "02", text: "Place a bet ($1–$30) before queuing into ranked" },
    { step: "03", text: "Play your game. Win = earn gold. Lose = lose your stake." },
    { step: "04", text: "Check your result · Riot API verifies it automatically" },
  ];

  return (
    <div style={{
      minHeight: "100vh", background: "#1A1A1E", fontFamily: "Barlow Condensed, sans-serif",
      backgroundImage: "radial-gradient(ellipse at 15% 40%, #2A2010 0%, transparent 55%), radial-gradient(ellipse at 85% 15%, #1E1E28 0%, transparent 50%)"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700;800;900&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap');
        * { box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fadeInLeft { from { opacity: 0; transform: translateX(-30px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes fadeInRight { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes glow { 0%,100% { text-shadow: 0 0 20px #C8AA6E44; } 50% { text-shadow: 0 0 60px #C8AA6E99; } }
        @keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes particleFloat { 0%,100% { transform: translateY(0) scale(1); opacity: 0.15; } 50% { transform: translateY(-40px) scale(1.5); opacity: 0.3; } }
        input::placeholder { color: #FFFFFF33; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #010A13; } ::-webkit-scrollbar-thumb { background: #785A28; border-radius: 3px; }
        .auth-feature-card:hover { border-color: #C8AA6E44 !important; background: #0d1f3c !important; }
        .auth-input:focus { border-color: #C8AA6E !important; }
      `}</style>

      {/* Top brand bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 48px", borderBottom: "1px solid #2D2D32" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/logo.png" alt="Runeterra Wagers" style={{ width: 128, height: 128, objectFit: "contain" }} />
          <div>
            <div style={{ fontSize: 9, letterSpacing: 5, color: "#A0A0A8" }}>RUNETERRA</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#C8AA6E", lineHeight: 1, fontFamily: "Barlow Condensed, sans-serif" }}>WAGERS</div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: "#C0C0C8", fontFamily: "DM Sans, sans-serif", fontStyle: "italic" }}>
          Stake your gold. Prove your rank.
        </div>
      </div>

      <FloatingParticles />
      <LiveTicker />
      <AuthStatsBar />
      {/* Main split layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 420px 1fr", gap: 0, minHeight: "calc(100vh - 73px)", alignItems: "start" }}>

        {/* LEFT PANEL · How it works */}
        <div style={{ padding: "28px 40px 28px 48px", animation: "fadeInLeft 0.7s ease" }}>
          <div style={{ fontSize: 12, letterSpacing: 3, color: "#C8AA6E", marginBottom: 8 }}>HOW IT WORKS</div>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: "#F0F0F0", fontFamily: "Barlow Condensed, sans-serif", marginBottom: 20, lineHeight: 1.2 }}>
            Bet on yourself.<br/><span style={{ color: "#C8AA6E" }}>Win real rewards.</span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {howItWorks.map((item, i) => (
              <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start", animation: `fadeInLeft 0.7s ease ${0.1 * i}s both` }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 6, flexShrink: 0,
                  background: "linear-gradient(135deg, #C8AA6E22, #C8AA6E08)",
                  border: "1px solid #C8AA6E55",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#C8AA6E", fontSize: 14, fontWeight: 700, letterSpacing: 0,
                  fontFamily: "Barlow Condensed, sans-serif"
                }}>{item.step}</div>
                <div style={{ color: "#E0E0E0", fontSize: 15, lineHeight: 1.75, paddingTop: 8, fontWeight: 400 }}>
                  {item.text}
                </div>
              </div>
            ))}
          </div>

          {/* Winrate odds table */}
          <div style={{ marginTop: 40, background: "#24242888", border: "1px solid #2A2A2E", borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: 13, letterSpacing: 3, color: "#C8AA6E", marginBottom: 4, fontWeight: 700 }}>PAYOUT MULTIPLIERS</div>
            <div style={{ fontSize: 13, color: "#A0A0A8", fontFamily: "DM Sans, sans-serif", marginBottom: 16 }}>Based on your winrate — not your rank</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 24px" }}>
              {WR_BRACKETS.map(({ range, odds, desc }) => (
                <div key={range} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #222225" }}>
                  <div>
                    <div style={{ fontSize: 13, color: "#D0D0D8", fontFamily: "DM Sans, sans-serif" }}>{range}</div>
                    <div style={{ fontSize: 12, color: "#7A7A82", fontFamily: "DM Sans, sans-serif" }}>{desc}</div>
                  </div>
                  <span style={{ fontSize: 16, color: "#C8AA6E", fontWeight: 700 }}>{odds.toFixed(2)}x</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CENTER · Login form */}
        <div style={{ padding: "28px 0", borderLeft: "1px solid #252528", borderRight: "1px solid #252528" }}>
          <div style={{ padding: "0 36px" }}>
            {/* Hero */}
            <div style={{ textAlign: "center", marginBottom: 36 }}>
              <div style={{ marginBottom: 4, animation: "float 4s ease-in-out infinite" }}>
              <img src="/logo.png" alt="Runeterra Wagers" style={{ width: 220, height: 220, objectFit: "contain", filter: "drop-shadow(0 0 40px #C8AA6E66)" }} />
            </div>
              <h1 style={{ fontSize: 38, fontWeight: 900, color: "#C8AA6E", margin: "0 0 2px", animation: "glow 3s ease-in-out infinite", lineHeight: 1, fontFamily: "Barlow Condensed, sans-serif" }}>
                BET ON<br /><span style={{ color: "#F0F0F0" }}>YOURSELF</span>
              </h1>
              <div style={{ width: 60, height: 1, background: "linear-gradient(90deg, transparent, #C8AA6E, transparent)", margin: "8px auto" }} />
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", marginBottom: 24, border: "1px solid #2D2D32", borderRadius: 4, overflow: "hidden" }}>
              {["login", "register"].map(m => (
                <button key={m} onClick={() => { setMode(m); setError(""); }} style={{
                  flex: 1, padding: "11px", border: "none", cursor: "pointer",
                  background: mode === m ? "#C8AA6E" : "transparent",
                  color: mode === m ? "#1A1A1E" : "#C0C0C8",
                  fontFamily: "Barlow Condensed, sans-serif", fontSize: 11, fontWeight: 700,
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
                <label style={{ display: "block", fontSize: 9, letterSpacing: 3, color: "#A0A0A8", marginBottom: 6 }}>
                  {f.label.toUpperCase()}
                </label>
                <input
                  className="auth-input"
                  type={f.type} value={f.value} placeholder={f.placeholder}
                  onChange={e => f.set(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handle()}
                  style={{
                    width: "100%", background: "#1A1A1E", border: "1px solid #2D2D32",
                    color: "#F0F0F0", padding: "11px 14px", borderRadius: 4,
                    fontFamily: "Barlow Condensed, sans-serif", fontSize: 13, outline: "none",
                    transition: "border-color 0.2s"
                  }}
                />
              </div>
            ))}

            {error && (
              <div style={{ background: "#C8464A11", border: "1px solid #C8464A33", borderRadius: 3, padding: "10px 14px", marginBottom: 14 }}>
                <p style={{ color: "#F85149", fontSize: 13, margin: 0 }}>{error}</p>
              </div>
            )}

            {/* Remember me */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div
                onClick={() => setRememberMe(v => !v)}
                style={{
                  width: 18, height: 18, borderRadius: 3, flexShrink: 0, cursor: "pointer",
                  border: `1px solid ${rememberMe ? "#C8AA6E" : "#35353A"}`,
                  background: rememberMe ? "#C8AA6E" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "all 0.15s"
                }}
              >
                {rememberMe && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="#1A1A1E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              <span
                onClick={() => setRememberMe(v => !v)}
                style={{ fontSize: 13, color: "#C0C0C8", cursor: "pointer", userSelect: "none" }}
              >
                Remember me on this device
              </span>
            </div>

            {loading ? <Loader text="Authenticating..." /> : (
              <button onClick={handle} style={{
                width: "100%", background: "linear-gradient(135deg, #C8AA6E, #785A28)",
                border: "none", color: "#010A13", padding: "13px", borderRadius: 4,
                fontFamily: "Barlow Condensed, sans-serif", fontSize: 13, fontWeight: 700,
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
                <p style={{ color: "#C8AA6E", fontSize: 13, margin: 0 }}>
                  You start with <strong>$500 in virtual gold</strong>. No real money needed.
                </p>
              </div>
            )}

            <div style={{ marginTop: 24, padding: "16px", background: "#24242866", borderRadius: 4, border: "1px solid #2D2D32" }}>
              <div style={{ fontSize: 10, letterSpacing: 3, color: "#C8AA6E88", marginBottom: 10 }}>PLATFORM INFO</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {["Virtual currency only · no real money", "Solo/Duo ranked games only", "$30 max bet per game", "5% platform rake on winnings"].map(t => (
                  <div key={t} style={{ fontSize: 15, color: "#D0D0D8", fontFamily: "DM Sans, sans-serif", display: "flex", gap: 8, alignItems: "center" }}>
                    {t}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL · Features / rewards */}
        <div style={{ padding: "28px 48px 28px 40px", animation: "fadeInRight 0.7s ease" }}>
          <div style={{ fontSize: 12, letterSpacing: 3, color: "#C8AA6E", marginBottom: 8 }}>FEATURES</div>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: "#F0F0F0", fontFamily: "Barlow Condensed, sans-serif", marginBottom: 20, lineHeight: 1.2 }}>
            What you can<br/><span style={{ color: "#C8AA6E" }}>win & earn.</span>
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {features.map((f, i) => (
              <div key={i} className="auth-feature-card" style={{
                background: "#24242888", border: "1px solid #2A2A2E", borderRadius: 8,
                padding: "16px 20px", transition: "all 0.2s", cursor: "default",
                animation: `fadeInRight 0.7s ease ${0.1 * i}s both`
              }}>
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <FeatureIcon type={f.icon} />
                  <div>
                    <div style={{ color: "#C8AA6E", fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{f.title}</div>
                    <div style={{ color: "#E0E0E0", fontSize: 15, fontFamily: "DM Sans, sans-serif", lineHeight: 1.7 }}>{f.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Coming soon rewards */}
          <div style={{ marginTop: 28, background: "linear-gradient(135deg, #C8AA6E11, #785A2811)", border: "1px solid #C8AA6E22", borderRadius: 8, padding: 20 }}>
            <div style={{ fontSize: 13, letterSpacing: 2, color: "#C8AA6E", marginBottom: 14, fontFamily: "Barlow Condensed, sans-serif", fontWeight: 600 }}>COMING SOON · REWARDS SHOP</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { item: "Champion Skin", price: "$800 gold", icon: "diamond" },
                { item: "Riot Points Pack (650 RP)", price: "$350 gold", icon: "rp" },
                { item: "Champion Bundle", price: "$800 gold", emoji: "⚔" },
              ].map(r => (
                <div key={r.item} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #222225" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <RewardIcon type={r.icon} />
                    <span style={{ fontSize: 13, color: "#E0E0E0", fontFamily: "DM Sans, sans-serif" }}>{r.item}</span>
                  </div>
                  <span style={{ fontSize: 14, color: "#C8AA6E", fontWeight: 700 }}>{r.price}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12, fontSize: 13, color: "#A0A0A8", fontStyle: "italic" }}>
              * Rewards are virtual and for demonstration purposes
            </div>
          </div>
          <RecentWinsScroll />
        </div>
      </div>
    </div>
  );
}

// ─── PERSONALIZED ACCOUNT PHRASES ────────────────────────────────────────────
function getAccountPhrase(profile, rank) {
  if (!profile) return null;
  const tier = rank?.split(" ")[0]?.toUpperCase() || "UNRANKED";
  const div = rank?.split(" ")[1] || "";
  const wr = profile.winrate;
  const wins = profile.wins;
  const losses = profile.losses;
  const games = wins + losses;
  const top = profile.topChamps || [];
  const topChamp = top[0]?.name;
  const topPts = top[0]?.points || 0;
  const topLevel = top[0]?.level || 0;
  const secondChamp = top[1]?.name;
  const thirdChamp = top[2]?.name;
  const lp = profile.lp;

  // Each entry: { tag, text }
  // tag = bold label shown before the phrase
  // text = the sarcastic sentence
  const matches = [];

  // ── CHAMPION-SPECIFIC (most important, prioritized) ───────────────────────

  // Stealth/Invisible champs
  if (["Twitch","Evelynn","Shaco","Akshan","Talon","Kha'Zix","Khazix","Rengar"].includes(topChamp)) {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on ${topChamp}`, text: `You win ${wr}% of your games by being completely invisible. Bold strategy. Cowardly, but bold.` });
    else if (wr < 50) matches.push({ tag: `${topChamp} main`, text: `You picked the invisible champion and somehow still got found. Impressive in the worst way.` });
    else matches.push({ tag: `${topChamp} main`, text: `Playing ${topChamp} means your opponents shouldn't see you coming. They do. Every time.` });
  }

  // Yasuo / Yone
  if (topChamp === "Yasuo") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Yasuo`, text: `You have a genuinely good winrate on Yasuo. You are the reason every Yasuo ban exists.` });
    else if (wr < 45) matches.push({ tag: `Yasuo main`, text: `You have mastered the art of dying to your own Wind Wall. The 0/10 power spike is real.` });
    else matches.push({ tag: `Yasuo main`, text: `Wind Wall saved a teammate once. You've been chasing that feeling ever since. You'll never find it again.` });
  }
  if (topChamp === "Yone") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Yone`, text: `${wr}% on Yone. Yasuo's dead brother is somehow your path to success. Dark.` });
    else matches.push({ tag: `Yone main`, text: `You killed Yasuo, came back as Yone, and somehow got worse. The lore is accurate.` });
  }

  // Teemo
  if (topChamp === "Teemo") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Teemo`, text: `You are winning ${wr}% of your games by being the most hated entity in the game. You have chosen violence. Correctly.` });
    else matches.push({ tag: `Teemo main`, text: `You play Teemo, the most reported champion in history, and you still lose. That takes a special kind of commitment.` });
  }

  // Zed
  if (topChamp === "Zed") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Zed`, text: `${wr}% on Zed. You have a montage. It has exactly 47 views. 43 are yours.` });
    else if (wr < 45) matches.push({ tag: `Zed main`, text: `You picked the assassin that's supposed to one-shot people and you still lose lane. The shadows cannot hide your MMR.` });
    else matches.push({ tag: `Zed main`, text: `Zed main. You live by the blade. You also die by it, repeatedly, to the support.` });
  }

  // Katarina
  if (topChamp === "Katarina") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Katarina`, text: `${wr}% on Katarina. You wait until everyone is at 10% HP and then press R. You call this skill. We call it profitable.` });
    else matches.push({ tag: `Katarina main`, text: `Katarina requires zero deaths to be useful. Your KDA suggests a different playstyle.` });
  }

  // Vayne
  if (topChamp === "Vayne") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Vayne`, text: `${wr}% winrate on Vayne. You survived 15 minutes of being useless every game. The mental strength alone is impressive.` });
    else matches.push({ tag: `Vayne main`, text: `Vayne is only good late game. You haven't reached late game without feeding in ${losses} attempts. Statistically fascinating.` });
  }

  // Lux
  if (topChamp === "Lux") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Lux`, text: `${wr}% on Lux. One ability. Point. Click. Win. You have optimized laziness into a career.` });
    else matches.push({ tag: `Lux main`, text: `Your Lux misses the root but always hits the finisher on a teammate's kill. Every. Single. Game.` });
  }

  // Thresh
  if (topChamp === "Thresh") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Thresh`, text: `${wr}% winrate on Thresh. One good hook every 5 minutes and your ADC thinks you're a god. Efficient.` });
    else matches.push({ tag: `Thresh main`, text: `You play Thresh, the highest skill cap support, because you like having an excuse when the hook misses. Which is often.` });
  }

  // Blitzcrank
  if (topChamp === "Blitzcrank") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Blitzcrank`, text: `${wr}% on Blitzcrank. You press Q and something dies. You have convinced yourself this is strategy.` });
    else matches.push({ tag: `Blitzcrank main`, text: `You play the champion with a literal grab ability and your ADC is still alone in lane. Remarkable.` });
  }

  // Darius
  if (topChamp === "Darius") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Darius`, text: `${wr}% on Darius. NOXUS WILL PREVAIL. You have not touched a skill shot in ${games} games and you're winning. Respect.` });
    else matches.push({ tag: `Darius main`, text: `Darius is the champion designed for people who find clicking difficult. You are still losing. The game respects your courage.` });
  }

  // Garen
  if (topChamp === "Garen") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Garen`, text: `${wr}% winrate on Garen. Q. E. R. No skill shots. No excuses. Just results. We respect the simplicity.` });
    else matches.push({ tag: `Garen main`, text: `Garen has three buttons and a passive that heals you. You are losing with this. The bush is not the problem.` });
  }

  // Master Yi
  if (topChamp === "Master Yi") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Master Yi`, text: `${wr}% on Master Yi. Press R. Left click. Repeat. You have found the exploit and you are not apologizing.` });
    else matches.push({ tag: `Master Yi main`, text: `Master Yi only needs one kill to snowball. You haven't gotten that kill in ${losses} games. The jungle timers remain a mystery.` });
  }

  // Jinx
  if (topChamp === "Jinx") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Jinx`, text: `${wr}% on Jinx. You int the first 20 minutes then hypercarry. Your support has anxiety because of you specifically.` });
    else matches.push({ tag: `Jinx main`, text: `Jinx needs to survive the early game. You do not survive the early game. The stats confirm what your support already knows.` });
  }

  // Ahri
  if (topChamp === "Ahri") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Ahri`, text: `${wr}% on Ahri. Your charm hits when it matters and misses when it doesn't. That's the whole champion distilled.` });
    else matches.push({ tag: `Ahri main`, text: `Ahri has a 3-second dash with 3 charges and you still die to the immobile support. The skill expression is hiding from you.` });
  }

  // Fizz
  if (topChamp === "Fizz") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Fizz`, text: `${wr}% on Fizz. You press E when someone points a mouse at you and call it mechanics. It works though.` });
    else matches.push({ tag: `Fizz main`, text: `Fizz's E makes you literally untargetable. You still die during it. We have questions.` });
  }

  // Nautilus
  if (topChamp === "Nautilus") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Nautilus`, text: `${wr}% on Nautilus. You press R and an entire team goes to sleep. This is technically strategy.` });
    else matches.push({ tag: `Nautilus main`, text: `Every ability Nautilus has roots or knocks up. Your ADC is still 0-7. There is no saving some people.` });
  }

  // Draven
  if (topChamp === "Draven") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Draven`, text: `${wr}% on Draven. You catch the axes, you win the game, you collect the gold. The league of Draven is real and you live in it.` });
    else matches.push({ tag: `Draven main`, text: `Draven literally gives you extra gold for catching axes. You drop them, you lose gold, you lose games. The math is not helping you.` });
  }

  // Nasus
  if (topChamp === "Nasus") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Nasus`, text: `${wr}% on Nasus. You farmed 800 stacks and became unkillable. Your opponents had 40 minutes to stop this. They did not.` });
    else matches.push({ tag: `Nasus main`, text: `Nasus gets stronger every single minute by pressing Q on a minion. Your stack count suggests you have found ways to make this hard.` });
  }

  // Caitlyn
  if (topChamp === "Caitlyn") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Caitlyn`, text: `${wr}% on Caitlyn. You stand behind your team and shoot things from maximum range. Efficient. Safe. Boring. Effective.` });
    else matches.push({ tag: `Caitlyn main`, text: `Caitlyn has the longest range in the game and you still find ways to get caught out. The traps are for your opponents, not yourself.` });
  }

  // Orianna
  if (topChamp === "Orianna") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Orianna`, text: `${wr}% on Orianna. One perfectly placed ultimate and an entire team disappears. You have done this ${wins} times.` });
    else matches.push({ tag: `Orianna main`, text: `The ball is not where you think it is. It never is. That's the Orianna experience and you signed up for it.` });
  }

  // Soraka
  if (topChamp === "Soraka") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Soraka`, text: `${wr}% on Soraka. You have kept people alive who had no business surviving. You are a medical professional of the Rift.` });
    else matches.push({ tag: `Soraka main`, text: `Soraka's entire job is to heal. Your ADC is still dying. The banana is missing its target.` });
  }

  // Pyke
  if (topChamp === "Pyke") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Pyke`, text: `${wr}% on Pyke. You play a support that steals kills and gets rich doing it. You are the problem and you are thriving.` });
    else matches.push({ tag: `Pyke main`, text: `Pyke is an assassin who gives gold to teammates. You are losing gold and teammates simultaneously. Impressive balance.` });
  }

  // Ezreal
  if (topChamp === "Ezreal") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Ezreal`, text: `${wr}% on Ezreal. You hit skill shots for 40 minutes and slowly whittle down entire teams. Patience as a weapon.` });
    else matches.push({ tag: `Ezreal main`, text: `Ezreal has a built-in dash and a global ultimate. You are neither escaping nor contributing globally. The Q hits minions well though.` });
  }

  // Lee Sin
  if (topChamp === "Lee Sin") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Lee Sin`, text: `${wr}% on Lee Sin. The insec works more than it should. Your opponents can hear the click and they are still not ready.` });
    else matches.push({ tag: `Lee Sin main`, text: `Lee Sin has a skill floor so high that most players spend their career underneath it looking up. Welcome.` });
  }

  // Vi
  if (topChamp === "Vi") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Vi`, text: `${wr}% on Vi. You picked a target, pressed R, and made it their problem. Simple. Direct. Winning.` });
    else matches.push({ tag: `Vi main`, text: `Vi locks on to one person with her ultimate and cannot be stopped. You somehow are. Every game.` });
  }

  // Shaco
  if (topChamp === "Shaco") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Shaco`, text: `${wr}% on Shaco. You have made ${wins} people paranoid about boxes in bushes. You are the reason people don't ward properly.` });
    else matches.push({ tag: `Shaco main`, text: `Shaco requires deceiving the enemy. You are being deceived by your own win rate. The boxes are working against you now.` });
  }

  // Viktor
  if (topChamp === "Viktor") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Viktor`, text: `${wr}% on Viktor. You have embraced the glorious evolution and it is paying dividends. The machine wins.` });
    else matches.push({ tag: `Viktor main`, text: `Viktor scales to become unstoppable. You have not reached the scale. The evolution is on hold.` });
  }

  // Syndra
  if (topChamp === "Syndra") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Syndra`, text: `${wr}% on Syndra. You collect balls and then throw them at someone's face for lethal damage. Art.` });
    else matches.push({ tag: `Syndra main`, text: `Syndra's ultimate does more damage the more balls she has. You have been losing them. Literally.` });
  }

  // Vex
  if (topChamp === "Vex") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Vex`, text: `${wr}% on Vex. You are winning by being a depressed goth who hates dashes. The lane opponent had 3 dashes. You did not care.` });
    else matches.push({ tag: `Vex main`, text: `Vex counter-dashes every mobility champion in the game. Your opponents apparently don't dash enough for you.` });
  }

  // Rengar
  if (topChamp === "Rengar") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Rengar`, text: `${wr}% on Rengar. One-shot from the bush. They never see it coming. ${wins} times they did not see it coming.` });
    else matches.push({ tag: `Rengar main`, text: `Rengar is invisible before he jumps. They are still somehow ready. Your audio settings may need adjustment.` });
  }

  // Jhin
  if (topChamp === "Jhin") {
    if (wr >= 55) matches.push({ tag: `${wr}% winrate on Jhin`, text: `${wr}% on Jhin. Four bullets. Four kills. The performance continues and the critics are dead.` });
    else matches.push({ tag: `Jhin main`, text: `Jhin reloads after 4 shots. In those 2 seconds you have managed to lose every game. The fourth shot carries theatrical weight you cannot support.` });
  }

  // ── WINRATE-FOCUSED when no specific champion match ──────────────────────
  if (matches.length === 0 && topChamp && wr !== null) {
    if (wr >= 60) matches.push({ tag: `${wr}% winrate on ${topChamp}`, text: `${wr}% on ${topChamp}. At this point you are not playing the game, you are farming it. The bet feels rigged. In your favour.` });
    else if (wr >= 55) matches.push({ tag: `${wr}% winrate on ${topChamp}`, text: `${wr}% on ${topChamp}. Consistently better than average. You know something your opponents don't. They will figure it out eventually. Probably.` });
    else if (wr >= 50) matches.push({ tag: `${wr}% winrate on ${topChamp}`, text: `${wr}% on ${topChamp}. You win just barely more than you lose. The universe is in fragile equilibrium and it depends on you.` });
    else if (wr >= 45) matches.push({ tag: `${wr}% winrate on ${topChamp}`, text: `${wr}% on ${topChamp}. You are statistically feeding more than you're winning on your main. We're still taking your bet.` });
    else matches.push({ tag: `${wr}% winrate on ${topChamp}`, text: `${wr}% on ${topChamp}. That's your main champion. That winrate. On your most played. We are not going to comment further.` });
  }

  // ── SECOND + THIRD CHAMP combos (if we still have no match) ─────────────
  if (matches.length === 0 && topChamp && secondChamp) {
    matches.push({ tag: `${topChamp} / ${secondChamp} main`, text: `Your top two champions are ${topChamp} and ${secondChamp}. No one has ever described themselves as a ${topChamp}/${secondChamp} main out loud. You are a pioneer.` });
  }

  // ── MASTERY POINTS ────────────────────────────────────────────────────────
  if (topPts >= 1000000 && topChamp) {
    matches.push({ tag: `${(topPts/1000000).toFixed(1)}M mastery on ${topChamp}`, text: `You have played ${topChamp} long enough to accumulate ${(topPts/1000000).toFixed(1)} million mastery points. This is either dedication or a cry for help. We're not qualified to say which.` });
  } else if (topPts >= 500000 && topChamp) {
    matches.push({ tag: `${Math.round(topPts/1000)}K mastery on ${topChamp}`, text: `${Math.round(topPts/1000)}K mastery points on ${topChamp}. You have devoted a statistically concerning amount of your life to this champion.` });
  } else if (topLevel === 7 && topChamp) {
    matches.push({ tag: `Mastery 7 on ${topChamp}`, text: `Riot has officially certified you as a ${topChamp} enthusiast. The grey border confirms what your opponents already feared.` });
  }

  // ── RANK-BASED FALLBACK ───────────────────────────────────────────────────
  if (matches.length === 0) {
    if (tier === "IRON") matches.push({ tag: "Iron ranked", text: "The algorithm has seen your games and placed you carefully. We respect the honesty of the system." });
    else if (tier === "BRONZE") matches.push({ tag: "Bronze ranked", text: "Bronze. The rank of people who are 100% sure it's their teammates. It is not their teammates." });
    else if (tier === "SILVER") matches.push({ tag: "Silver ranked", text: "Silver. You are average. This is fine. Most people are. The bet is still yours to place." });
    else if (tier === "GOLD") matches.push({ tag: "Gold ranked", text: "Gold. You escaped Silver, which statistically 40% of players never do. Take the win." });
    else if (tier === "PLATINUM") matches.push({ tag: "Platinum ranked", text: "Platinum. You are good at this game and insufferable at parties when it comes up." });
    else if (tier === "EMERALD") matches.push({ tag: "Emerald ranked", text: "Emerald. The rank Riot invented so Platinum players could feel like they climbed." });
    else if (tier === "DIAMOND") matches.push({ tag: "Diamond ranked", text: "Diamond. Top 2% of players. Still blaming teammates. Both things are true." });
    else if (tier === "MASTER") matches.push({ tag: "Master tier", text: "Master tier. You have no social life and your MMR is proof that the sacrifice was worth it." });
    else if (tier === "GRANDMASTER") matches.push({ tag: "Grandmaster", text: "Grandmaster. Just go pro or get some sunlight. The in-between no longer exists for you." });
    else if (tier === "CHALLENGER") matches.push({ tag: "Challenger", text: "Challenger. Your odds are 1.15x because Riot's data says you should not be losing. Do not lose." });
    else matches.push({ tag: "Account linked", text: "Your account exists and Riot confirms it. That's a start. The rest is up to you." });
  }

  // Return the last (most specific) match
  return matches[matches.length - 1];
}

// ─── LINKED PLAYER CARD ───────────────────────────────────────────────────────
function LinkedPlayerCard({ user, setUser, region }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const DDRAGON_VERSION = "14.24.1"; // fallback, will be overridden

  useEffect(() => {
    if (!user.puuid) { setLoading(false); return; }
    loadProfile();
  }, [user.puuid]);

  const loadProfile = async () => {
    setLoading(true);
    try {
      // Fetch all in parallel
      const [summoner, rankData, masteryRaw, champData] = await Promise.all([
        riotAPI({ action: "summoner", puuid: user.puuid, region }),
        riotAPI({ action: "rank", puuid: user.puuid, region }),
        riotAPI({ action: "mastery", puuid: user.puuid, region }),
        riotAPI({ action: "championdata" }),
      ]);

      // Ranked stats
      const soloQ = Array.isArray(rankData)
        ? rankData.find(e => e.queueType === "RANKED_SOLO_5x5")
        : null;
      const wins = soloQ?.wins || 0;
      const losses = soloQ?.losses || 0;
      const winrate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : null;

      // Top champions with names resolved
      const topChamps = Array.isArray(masteryRaw)
        ? masteryRaw.slice(0, 3).map(m => ({
            name: champData.idToKey?.[String(m.championId)] || "Unknown",
            points: m.championPoints,
            level: m.championLevel,
          }))
        : [];

      const profileData = {
        iconId: summoner.profileIconId,
        level: summoner.summonerLevel,
        version: champData.version || DDRAGON_VERSION,
        wins,
        losses,
        winrate,
        topChamps,
        rank: soloQ ? `${soloQ.tier} ${soloQ.rank}` : "UNRANKED",
        lp: soloQ?.leaguePoints ?? null,
      };
      profileData.phrase = getAccountPhrase(profileData, profileData.rank);
      setProfile(profileData);
    } catch (e) {
      console.error("Profile load error", e);
    }
    setLoading(false);
  };

  const unlink = async () => {
    const data = await apiCall("/api/user", { action: "unlinkAccount", username: user.username });
    setUser(data.user);
  };

  const v = profile?.version || DDRAGON_VERSION;
  const iconUrl = profile?.iconId != null
    ? `https://ddragon.leagueoflegends.com/cdn/${v}/img/profileicon/${profile.iconId}.png`
    : null;
  const champImgUrl = (name) =>
    `https://ddragon.leagueoflegends.com/cdn/${v}/img/champion/${name}.png`;

  const RANK_COLORS = {
    IRON: "#9d9d9d", BRONZE: "#b87333", SILVER: "#a8b2c0",
    GOLD: "#C8AA6E", PLATINUM: "#4cc9b0", EMERALD: "#22c55e",
    DIAMOND: "#6ab0f5", MASTER: "#c084fc", GRANDMASTER: "#ef4444", CHALLENGER: "#facc15"
  };
  const rankColor = RANK_COLORS[profile?.rank?.split(" ")[0]] || "#C8AA6E";

  return (
    <div style={{ background: "#242428", border: "1px solid #2D2D32", borderRadius: 8, overflow: "hidden" }}>
      {/* Top section: profile icon + core info */}
      <div style={{ display: "flex", gap: 20, padding: "20px 24px", alignItems: "flex-start", borderBottom: "1px solid #2D2D32" }}>

        {/* Profile icon */}
        <div style={{ position: "relative", flexShrink: 0 }}>
          {iconUrl ? (
            <img
              src={iconUrl}
              alt="Profile Icon"
              style={{ width: 72, height: 72, borderRadius: 6, border: `2px solid ${rankColor}`, display: "block" }}
              onError={e => { e.target.style.display = "none"; }}
            />
          ) : (
            <div style={{ width: 72, height: 72, borderRadius: 6, background: "#35353A", border: `2px solid ${rankColor}` }} />
          )}
          {profile?.level && (
            <div style={{
              position: "absolute", bottom: -8, left: "50%", transform: "translateX(-50%)",
              background: "#1A1A1E", border: `1px solid ${rankColor}`,
              borderRadius: 10, padding: "1px 8px",
              fontSize: 10, color: rankColor, fontWeight: 700, whiteSpace: "nowrap",
              fontFamily: "Barlow Condensed, sans-serif"
            }}>LVL {profile.level}</div>
          )}
        </div>

        {/* Name + rank info */}
        <div style={{ flex: 1, paddingTop: 2 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#F0F0F0", marginBottom: 4, fontFamily: "Barlow Condensed, sans-serif" }}>
            {user.lolAccount}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{
              background: `${rankColor}22`, border: `1px solid ${rankColor}55`,
              borderRadius: 3, padding: "3px 10px",
              fontSize: 12, color: rankColor, fontWeight: 700,
              fontFamily: "Barlow Condensed, sans-serif", letterSpacing: 1
            }}>
              {profile?.rank || user.rank || "UNRANKED"}
            </span>
            {profile?.lp != null && (
              <span style={{ fontSize: 13, color: "#A0A0A8" }}>{profile.lp} LP</span>
            )}
          </div>

          {/* W/L/Winrate row */}
          {loading ? (
            <div style={{ color: "#A0A0A8", fontSize: 13 }}>Loading stats...</div>
          ) : profile ? (
            <div style={{ display: "flex", gap: 16 }}>
              <div>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#3FB950" }}>{profile.wins}W</span>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#F85149", marginLeft: 6 }}>{profile.losses}L</span>
              </div>
              {profile.winrate != null && (
                <div style={{
                  fontSize: 13, color: profile.winrate >= 55 ? "#3FB950" : profile.winrate >= 50 ? "#C8AA6E" : "#A0A0A8"
                }}>
                  {profile.winrate}% winrate
                </div>
              )}
              <div style={{ fontSize: 15, color: "#A0A0A8", fontFamily: "DM Sans, sans-serif" }}>
                Odds: <span style={{ color: "#C8AA6E", fontWeight: 700, fontSize: 16 }}>{getOdds(profile?.winrate)}x</span> <span style={{ fontSize: 13, color: "#A0A0A8", marginLeft: 4 }}>({getOddsLabel(profile?.winrate)})</span>
              </div>
            </div>
          ) : null}
        </div>

        {/* Unlink button */}
        <button onClick={unlink} style={{
          background: "none", border: "1px solid #35353A", color: "#7A7A82",
          padding: "6px 14px", borderRadius: 4, cursor: "pointer",
          fontSize: 12, flexShrink: 0, transition: "all 0.2s"
        }}
          onMouseEnter={e => { e.target.style.borderColor = "#F85149"; e.target.style.color = "#F85149"; }}
          onMouseLeave={e => { e.target.style.borderColor = "#35353A"; e.target.style.color = "#7A7A82"; }}
        >Unlink</button>
      </div>

      {/* Bottom section: top champions */}
      {!loading && profile?.topChamps?.length > 0 && (
        <div style={{ padding: "16px 24px" }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: "#A0A0A8", marginBottom: 12 }}>TOP CHAMPIONS</div>
          <div style={{ display: "flex", gap: 12 }}>
            {profile.topChamps.map((champ, i) => (
              <div key={champ.name} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, background: "#1A1A1E", borderRadius: 6, padding: "10px 12px", border: i === 0 ? "1px solid #C8AA6E33" : "1px solid #2A2A2E" }}>
                <div style={{ position: "relative", flexShrink: 0 }}>
                  <img
                    src={champImgUrl(champ.name)}
                    alt={champ.name}
                    style={{ width: 44, height: 44, borderRadius: 4, border: i === 0 ? "1px solid #C8AA6E" : "1px solid #35353A", display: "block" }}
                    onError={e => { e.target.src = "https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Garen_0.jpg"; }}
                  />
                  {i === 0 && (
                    <div style={{
                      position: "absolute", top: -6, right: -6,
                      background: "#C8AA6E", borderRadius: "50%",
                      width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 9, fontWeight: 900, color: "#1A1A1E"
                    }}>1</div>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#F0F0F0", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {champ.name}
                  </div>
                  <div style={{ fontSize: 11, color: "#A0A0A8" }}>
                    M{champ.level} · {(champ.points / 1000).toFixed(0)}K pts
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div style={{ padding: "20px 24px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 16, height: 16, border: "2px solid #C8AA6E33", borderTop: "2px solid #C8AA6E", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <span style={{ color: "#A0A0A8", fontSize: 13 }}>Loading champion data...</span>
        </div>
      )}

      {!loading && profile?.phrase && (
        <div style={{ padding: "14px 24px", borderTop: "1px solid #2D2D32", background: "#1A1A1E", display: "flex", gap: 12, alignItems: "flex-start" }}>
          <div style={{ flexShrink: 0, background: "#C8AA6E18", border: "1px solid #C8AA6E33", borderRadius: 4, padding: "3px 10px", fontSize: 11, color: "#C8AA6E", fontWeight: 700, letterSpacing: 0.5, whiteSpace: "nowrap", marginTop: 2 }}>
            {profile.phrase.tag}
          </div>
          <div style={{ fontSize: 13, color: "#C0C0C8", fontStyle: "italic", lineHeight: 1.6 }}>
            {profile.phrase.text}
          </div>
        </div>
      )}
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

      // Icon matches · link the account
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

  if (user.lolAccount) return <LinkedPlayerCard user={user} setUser={setUser} region={region} />;

  if (step === "verify" && pendingAccount && requiredIconId !== null) return (
    <div style={{ background: "#242428", border: "1px solid #C8AA6E44", borderRadius: 4, padding: 24 }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: "#C8AA6E", marginBottom: 16 }}>VERIFY ACCOUNT OWNERSHIP</div>
      <p style={{ color: "#FFFFFF88", fontSize: 13, fontFamily: "DM Sans, sans-serif", marginBottom: 20 }}>
        To prove you own <strong style={{color:"#C8AA6E"}}>{pendingAccount.gameName}#{pendingAccount.tagLine}</strong>, 
        set this icon as your profile picture in the League client, then click Verify:
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 24, background: "#1A1A1E", padding: 16, borderRadius: 4, border: "1px solid #C8AA6E33" }}>
        <img 
          src={getIconUrl(requiredIconId)} 
          alt={`Icon ${requiredIconId}`}
          style={{ width: 80, height: 80, borderRadius: 4, border: "2px solid #C8AA6E", imageRendering: "auto" }}
          onError={e => { e.target.src = getIconUrl(0); }}
        />
        <div>
          <div style={{ color: "#C8AA6E", fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Icon #{requiredIconId}</div>
          <div style={{ color: "#A0A0A8", fontSize: 12, fontFamily: "DM Sans, sans-serif" }}>
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
          color: "#010A13", padding: "12px", borderRadius: 3, fontFamily: "Barlow Condensed, sans-serif",
          fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: 1
        }}>
          {loading ? "Verifying..." : "✓ Verify & Link"}
        </button>
        <button onClick={() => { setStep("input"); setPendingAccount(null); setRequiredIconId(null); }} style={{
          background: "none", border: "1px solid #35353A", color: "#A0A0A8",
          padding: "12px 20px", borderRadius: 3, fontFamily: "Barlow Condensed, sans-serif", fontSize: 12, cursor: "pointer"
        }}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div style={{ background: "#242428", border: "1px solid #2D2D32", borderRadius: 4, padding: 24 }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: "#A0A0A8", marginBottom: 16 }}>LINK YOUR LOL ACCOUNT</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          placeholder="Game Name (e.g. Faker)"
          value={gameName} onChange={e => setGameName(e.target.value)}
          style={{ flex: 2, minWidth: 150, background: "#1A1A1E", border: "1px solid #35353A", color: "#F0F0F0", padding: "10px 12px", borderRadius: 3, fontFamily: "Barlow Condensed, sans-serif", fontSize: 13 }}
        />
        <input
          placeholder="Tag (e.g. EUW, NA1, 1234)"
          value={tagLine} onChange={e => setTagLine(e.target.value)}
          style={{ flex: 1, minWidth: 80, background: "#1A1A1E", border: "1px solid #35353A", color: "#F0F0F0", padding: "10px 12px", borderRadius: 3, fontFamily: "Barlow Condensed, sans-serif", fontSize: 13 }}
        />
        <select value={region} onChange={e => setRegion(e.target.value)}
          style={{ background: "#1A1A1E", border: "1px solid #35353A", color: "#F0F0F0", padding: "10px 12px", borderRadius: 3, fontFamily: "Barlow Condensed, sans-serif", fontSize: 13 }}>
          <option value="euw1">EUW</option>
          <option value="na1">NA</option>
          <option value="kr">KR</option>
          <option value="br1">BR</option>
        </select>
        <button onClick={startLink} disabled={loading} style={{
          background: "#C8AA6E", color: "#010A13", border: "none", padding: "10px 20px",
          borderRadius: 3, fontFamily: "Barlow Condensed, sans-serif", fontSize: 12, fontWeight: 700,
          cursor: "pointer", whiteSpace: "nowrap"
        }}>
          {loading ? "..." : "Link Account"}
        </button>
      </div>
    </div>
  );
}

// ─── PLACE BET ───────────────────────────────────────────────────────────────

// ─── PLACE BET (UPDATED — supports virtual and real money modes) ──────────────
function PlaceBet({ user, setUser, toast, betMode }) {
  const [amount, setAmount] = useState(betMode === "real" ? 1 : 10);
  const [loading, setLoading] = useState(false);

  const isReal = betMode === "real";
  const maxBet = isReal ? MAX_REAL_BET : MAX_BET;
  const activeBet = user.bets?.find(b => b.status === "pending");
  const odds = getOdds(user.winrate);
  const rake = isReal ? 0 : RAKE; // no rake on real bets — stake returned + profit split
  const potentialWin = isReal
    ? (amount * odds).toFixed(2) // full payout shown (stake back + profit as credits)
    : ((amount * odds) * (1 - RAKE)).toFixed(2);
  const availableBalance = isReal ? user.realBalance : user.balance;

  const place = async () => {
    if (!user.lolAccount) return toast("Link your LoL account first", "error");
    if (activeBet) return toast("You already have an active bet!", "error");
    if (amount > maxBet) return toast(`Max bet is $${maxBet.toFixed(2)}`, "error");
    if (amount > availableBalance) return toast(`Insufficient ${isReal ? "real" : "virtual"} balance`, "error");
    if (amount < (isReal ? 0.10 : 1)) return toast(`Minimum bet is ${isReal ? "$0.10" : "$1"}`, "error");

    setLoading(true);
    try {
      const data = await apiCall("/api/bet", {
        action: "placeBet",
        username: user.username,
        amount: Number(amount),
        odds,
        potentialWin: Number(potentialWin),
        mode: betMode
      });
      setUser(data.user);
      toast(`Bet placed! Win to earn ${isReal ? `$${amount} back + $${(potentialWin - amount).toFixed(2)} skin credits` : `$${potentialWin}`}`, "success");
    } catch(e) {
      toast(e.message, "error");
    }
    setLoading(false);
  };

  const accentColor = isReal ? "#4ade80" : "#C8AA6E";
  const accentBg = isReal ? "#0d280d" : "#0d1f3c";

  return (
    <div style={{ background: "#242428", border: `1px solid ${isReal ? "#4ade8033" : "#2D2D32"}`, borderRadius: 4, padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#A0A0A8" }}>PLACE BET · NEXT RANKED GAME</div>
        <div style={{ fontSize: 10, background: isReal ? "#4ade8022" : "#C8AA6E22", color: accentColor, border: `1px solid ${accentColor}44`, borderRadius: 3, padding: "2px 8px", letterSpacing: 1 }}>
          {isReal ? "💵 REAL" : "🎮 VIRTUAL"}
        </div>
      </div>

      {activeBet ? (
        <div style={{ background: "#1A1A1E", border: `1px solid ${accentColor}44`, borderRadius: 3, padding: 20 }}>
          <div style={{ color: accentColor, fontSize: 13, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: accentColor, animation: "pulse 1.5s ease-in-out infinite" }} />
            Active {activeBet.mode === "real" ? "Real Money" : "Virtual"} Bet
          </div>
          <div style={{ color: "#F0F0F0", fontSize: 24, fontWeight: 700 }}>{formatMoney(activeBet.amount)}</div>
          <div style={{ color: "#A0A0A8", fontSize: 13, marginTop: 4 }}>
            {activeBet.mode === "real"
              ? <>Win to get <span style={{ color: "#4ade80", fontWeight: 700 }}>${activeBet.amount.toFixed(2)} back</span> + <span style={{ color: "#a78bfa", fontWeight: 700 }}>${(activeBet.potentialWin - activeBet.amount).toFixed(2)} skin credits</span></>
              : <>Win to earn <span style={{ color: "#0BC4AA", fontWeight: 700 }}>{formatMoney(activeBet.potentialWin)}</span></>
            }
          </div>
          <div style={{ color: "#A0A0A8", fontSize: 11, marginTop: 8 }}>Placed {timeAgo(activeBet.placedAt)}</div>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <label style={{ fontSize: 10, letterSpacing: 2, color: "#A0A0A8" }}>BET AMOUNT</label>
              <span style={{ fontSize: 12, color: accentColor }}>
                Max: ${maxBet.toFixed(2)} · Available: ${Number(availableBalance).toFixed(2)}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: accentColor, fontSize: 18 }}>$</span>
              <input
                type="number"
                min={isReal ? 0.10 : 1}
                max={maxBet}
                step={isReal ? 0.10 : 1}
                value={amount}
                onChange={e => setAmount(Math.min(maxBet, Math.max(isReal ? 0.10 : 1, Number(e.target.value))))}
                style={{
                  flex: 1, background: "#1A1A1E", border: `1px solid ${accentColor}44`, color: "#F0F0F0",
                  padding: "12px", borderRadius: 3, fontFamily: "Barlow Condensed, sans-serif", fontSize: 20,
                  fontWeight: 700, textAlign: "center", outline: "none"
                }}
              />
            </div>
            <input
              type="range" min={isReal ? 0.10 : 1} max={maxBet} step={isReal ? 0.10 : 1} value={amount}
              onChange={e => setAmount(Number(e.target.value))}
              style={{ width: "100%", marginTop: 12, accentColor }}
            />
          </div>

          {/* Quick amounts */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {(isReal ? [0.25, 0.50, 0.75, 1.00] : [5, 10, 20, 30]).map(v => (
              <button key={v} onClick={() => setAmount(v)} style={{
                flex: 1, background: amount === v ? accentColor : "#010A13",
                color: amount === v ? "#1A1A1E" : "#C0C0C8",
                border: "1px solid #35353A", borderRadius: 3, padding: "6px",
                fontFamily: "Barlow Condensed, sans-serif", fontSize: 12, cursor: "pointer"
              }}>${v.toFixed(isReal ? 2 : 0)}</button>
            ))}
          </div>

          <div style={{ background: "#1A1A1E", borderRadius: 3, padding: 16, marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: isReal ? 12 : 0 }}>
              <div>
                <div style={{ fontSize: 12, letterSpacing: 2, color: "#A0A0A8", fontFamily: "DM Sans, sans-serif" }}>YOUR MULTIPLIER</div>
                <div style={{ color: accentColor, fontSize: 24, fontWeight: 700 }}>{odds}x</div>
                <div style={{ color: "#A0A0A8", fontSize: 13, fontFamily: "DM Sans, sans-serif" }}>
                  {user.winrate != null ? `${user.winrate}% WR · ${getOddsLabel(user.winrate)}` : "Link account to get odds"}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, letterSpacing: 2, color: "#A0A0A8", fontFamily: "DM Sans, sans-serif" }}>IF YOU WIN</div>
                {isReal ? (
                  <>
                    <div style={{ color: "#4ade80", fontSize: 17, fontWeight: 700 }}>${Number(amount).toFixed(2)} <span style={{ fontSize: 13, color: "#A0A0A8", fontFamily: "DM Sans, sans-serif" }}>back to wallet</span></div>
                    <div style={{ color: "#a78bfa", fontSize: 17, fontWeight: 700 }}>${(potentialWin - amount).toFixed(2)} <span style={{ fontSize: 13, color: "#A0A0A8", fontFamily: "DM Sans, sans-serif" }}>skin credits</span></div>
                  </>
                ) : (
                  <>
                    <div style={{ color: "#0BC4AA", fontSize: 26, fontWeight: 700 }}>{formatMoney(potentialWin)}</div>
                    <div style={{ color: "#A0A0A8", fontSize: 13, fontFamily: "DM Sans, sans-serif" }}>{RAKE * 100}% rake applied</div>
                  </>
                )}
              </div>
            </div>
            {isReal && (
              <div style={{ background: "#a78bfa11", border: "1px solid #a78bfa33", borderRadius: 3, padding: "8px 12px", marginTop: 8 }}>
                <div style={{ color: "#a78bfa", fontSize: 11 }}>
                  💜 Skin credits can be spent in the <strong>Shop</strong> tab to redeem RP cards — gifted to you directly in-game!
                </div>
              </div>
            )}
          </div>

          <button onClick={place} disabled={loading || !user.lolAccount} style={{
            width: "100%", background: user.lolAccount ? `linear-gradient(135deg, ${accentColor}, ${isReal ? "#16a34a" : "#785A28"})` : "#785A2844",
            border: "none", color: "#010A13", padding: "14px",
            borderRadius: 3, fontFamily: "Barlow Condensed, sans-serif", fontSize: 14,
            fontWeight: 700, letterSpacing: 2, cursor: user.lolAccount ? "pointer" : "not-allowed",
            textTransform: "uppercase"
          }}>
            {loading ? "Placing..." : user.lolAccount ? `Place ${isReal ? "Real" : "Virtual"} Bet` : "Link LoL Account First"}
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
  const isReal = activeBet.mode === "real";

  return (
    <div style={{ background: "#242428", border: `1px solid ${isReal ? "#4ade8044" : "#C8AA6E44"}`, borderRadius: 4, padding: 24 }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: "#A0A0A8", marginBottom: 12 }}>RESOLVE YOUR BET</div>
      <p style={{ color: "#FFFFFF88", fontSize: 13, fontFamily: "DM Sans, sans-serif", marginBottom: 16 }}>
        After finishing a ranked game, click below to check the result automatically via Riot's API.
      </p>
      <button onClick={resolve} disabled={loading} style={{
        background: "transparent", border: `1px solid ${isReal ? "#4ade80" : "#C8AA6E"}`,
        color: isReal ? "#4ade80" : "#C8AA6E",
        padding: "12px 24px", borderRadius: 3, fontFamily: "Barlow Condensed, sans-serif",
        fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: 1,
        transition: "all 0.2s", width: "100%"
      }}>
        {loading ? "Checking Riot API..." : "Check My Last Game"}
      </button>
    </div>
  );
}


// ─── WALLET TOGGLE ───────────────────────────────────────────────────────────
function WalletToggle({ mode, setMode }) {
  return (
    <div style={{ display: "flex", border: "1px solid #2D2D32", borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
      {[{ id: "virtual", label: "🎮 Virtual Gold" }, { id: "real", label: "💵 Real Money" }].map(({ id, label }) => (
        <button key={id} onClick={() => setMode(id)} style={{
          flex: 1, padding: "9px 6px", border: "none", cursor: "pointer",
          fontFamily: "Barlow Condensed, sans-serif", fontSize: 11, fontWeight: 700,
          letterSpacing: 1, textTransform: "uppercase", transition: "all 0.2s",
          background: mode === id ? (id === "real" ? "linear-gradient(135deg, #1a4a1a, #0d2e0d)" : "linear-gradient(135deg, #C8AA6E, #785A28)") : "#141416",
          color: mode === id ? (id === "real" ? "#4ade80" : "#1A1A1E") : "#785A28",
          borderBottom: mode === id ? `2px solid ${id === "real" ? "#4ade80" : "#C8AA6E"}` : "2px solid transparent",
        }}>{label}</button>
      ))}
    </div>
  );
}

// ─── PAYPAL BUTTON ────────────────────────────────────────────────────────────
function PayPalButton({ amount, username, onSuccess, onError }) {
  const containerRef = useRef(null);
  const instanceRef = useRef(null);

  useEffect(() => {
    if (!window.paypal || !containerRef.current) return;
    if (instanceRef.current) {
      try { instanceRef.current.close(); } catch (_) {}
      if (containerRef.current) containerRef.current.innerHTML = "";
    }
    instanceRef.current = window.paypal.Buttons({
      style: { layout: "horizontal", color: "gold", shape: "rect", label: "pay", height: 44, tagline: false },
      createOrder: async () => {
        const res = await fetch("/api/paypal/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount, username }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create order");
        return data.orderID;
      },
      onApprove: async (data) => {
        const res = await fetch("/api/paypal/capture-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderID: data.orderID, username }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "Failed to capture payment");
        onSuccess(result.depositedAmount, result.realBalance);
      },
      onError: (err) => { console.error("PayPal error:", err); onError("Something went wrong with PayPal. Please try again."); },
      onCancel: () => {},
    });
    if (instanceRef.current.isEligible()) instanceRef.current.render(containerRef.current);
    return () => { if (instanceRef.current) { try { instanceRef.current.close(); } catch (_) {} } };
  }, [amount, username]);

  return (
    <div>
      <div ref={containerRef} style={{ minHeight: 44 }} />
      {!window.paypal && (
        <div style={{ background: "#1A1A1E", border: "1px solid #C8464A33", borderRadius: 3, padding: 12, textAlign: "center", color: "#C8464A", fontSize: 12 }}>
          ⚠️ PayPal SDK not loaded. Check your index.html script tag.
        </div>
      )}
    </div>
  );
}

// ─── DEPOSIT PANEL ────────────────────────────────────────────────────────────
function DepositPanel({ user, setUser, toast }) {
  const [amount, setAmount] = useState(10);
  const [deposits, setDeposits] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    fetch(`/api/paypal/deposit-history?username=${encodeURIComponent(user.username)}`)
      .then(r => r.json())
      .then(data => setDeposits(data.deposits || []))
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [user.username]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ background: "#0d280d", border: "1px solid #4ade8033", borderRadius: 8, padding: "14px 18px", display: "flex", gap: 12 }}>
        <div style={{ fontSize: 20 }}>💵</div>
        <div>
          <div style={{ color: "#4ade80", fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Deposit Real Money</div>
          <div style={{ color: "#86efac", fontSize: 13, fontFamily: "DM Sans, sans-serif", lineHeight: 1.6 }}>
            Add funds via PayPal to your real balance. Use it to place real bets — if you win, your stake returns to your wallet and your profit becomes <strong>Skin Credits</strong> to spend on RP cards.
          </div>
        </div>
      </div>

      <div style={{ background: "#242428", border: "1px solid #2D2D32", borderRadius: 8, padding: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#A0A0A8", marginBottom: 20 }}>ADD FUNDS VIA PAYPAL</div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <label style={{ fontSize: 10, letterSpacing: 2, color: "#A0A0A8" }}>DEPOSIT AMOUNT</label>
            <span style={{ fontSize: 12, color: "#4ade80" }}>Max: $500</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "#4ade80", fontSize: 18 }}>$</span>
            <input type="number" min={1} max={500} value={amount}
              onChange={e => setAmount(Math.min(500, Math.max(1, Number(e.target.value))))}
              style={{ flex: 1, background: "#1A1A1E", border: "1px solid #4ade8044", color: "#F0F0F0", padding: "12px", borderRadius: 3, fontFamily: "Barlow Condensed, sans-serif", fontSize: 20, fontWeight: 700, textAlign: "center", outline: "none" }}
            />
          </div>
          <input type="range" min={1} max={500} value={amount} onChange={e => setAmount(Number(e.target.value))}
            style={{ width: "100%", marginTop: 12, accentColor: "#4ade80" }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          {[10, 25, 50, 100].map(v => (
            <button key={v} onClick={() => setAmount(v)} style={{
              flex: 1, background: amount === v ? "#4ade8022" : "#010A13", color: amount === v ? "#4ade80" : "#C0C0C8",
              border: `1px solid ${amount === v ? "#4ade80" : "#35353A"}`, borderRadius: 3, padding: "6px",
              fontFamily: "Barlow Condensed, sans-serif", fontSize: 12, cursor: "pointer"
            }}>${v}</button>
          ))}
        </div>
        <PayPalButton
          amount={amount} username={user.username}
          onSuccess={(deposited, newRealBal) => {
            setUser(prev => ({ ...prev, realBalance: newRealBal }));
            setDeposits(prev => [{ id: Date.now(), amount: deposited, created_at: Date.now(), status: "completed" }, ...prev]);
            toast(`✅ $${deposited.toFixed(2)} added to your real balance!`, "success");
          }}
          onError={(msg) => toast(msg, "error")}
        />
        <div style={{ marginTop: 12, fontSize: 11, color: "#7A7A82", textAlign: "center", fontFamily: "DM Sans, sans-serif" }}>
          🔒 Payments processed securely by PayPal. We never store your card details.
        </div>
      </div>

      <div style={{ background: "#242428", border: "1px solid #2D2D32", borderRadius: 8, padding: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "#A0A0A8", marginBottom: 16 }}>DEPOSIT HISTORY</div>
        {loadingHistory ? <Loader text="Loading..." /> : deposits.length === 0 ? (
          <div style={{ color: "#A0A0A8", fontSize: 13, fontFamily: "DM Sans, sans-serif", fontStyle: "italic", textAlign: "center", padding: "16px 0" }}>No deposits yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {deposits.map((d, i) => (
              <div key={d.id || i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderRadius: 4, background: "#1A1A1E", border: "1px solid #4ade8022" }}>
                <div>
                  <div style={{ color: "#4ade80", fontSize: 13, fontWeight: 700 }}>PayPal Deposit</div>
                  <div style={{ color: "#A0A0A8", fontSize: 11, marginTop: 2 }}>
                    {new Date(Number(d.created_at)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <div style={{ color: "#4ade80", fontSize: 16, fontWeight: 900 }}>+${Number(d.amount).toFixed(2)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SKIN SHOP ────────────────────────────────────────────────────────────────
// RP cards: creditCost is the full price in dollars.
// Players can pay with any mix of Skin Credits + Real Balance.
const RP_CARDS = [
  { name: "RP Card 650", rp: 650, totalCost: 5.00, popular: false },
  { name: "RP Card 1380", rp: 1380, totalCost: 10.00, popular: true },
  { name: "RP Card 2800", rp: 2800, totalCost: 20.00, popular: false },
  { name: "RP Card 5750", rp: 5750, totalCost: 40.00, popular: false },
];

function SkinShop({ user, setUser, toast }) {
  const [redemptions, setRedemptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  // selectedCard = the card being checked out
  const [selectedCard, setSelectedCard] = useState(null);
  // How much the player allocates from each balance (controlled by slider)
  const [creditsUsed, setCreditsUsed] = useState(0);

  const skinCredits = Number(user.skinCredits || 0);
  const realBalance = Number(user.realBalance || 0);

  useEffect(() => {
    fetch("/api/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "getRedemptions", username: user.username })
    }).then(r => r.json())
      .then(data => setRedemptions(data.redemptions || []))
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [user.username]);

  const openCheckout = (card) => {
    // Auto-fill: use as many credits as possible, rest from real balance
    const maxCredits = Math.min(skinCredits, card.totalCost);
    setCreditsUsed(Math.round(maxCredits * 100) / 100);
    setSelectedCard(card);
  };

  const realUsed = selectedCard ? Math.max(0, Math.round((selectedCard.totalCost - creditsUsed) * 100) / 100) : 0;
  const canAffordSelected = selectedCard
    ? (creditsUsed <= skinCredits && realUsed <= realBalance && Math.abs(creditsUsed + realUsed - selectedCard.totalCost) < 0.001)
    : false;

  const redeem = async () => {
    if (!selectedCard || !canAffordSelected) return;
    setLoading(true);
    try {
      const data = await apiCall("/api/redeem", {
        action: "submitRedemption",
        username: user.username,
        skinName: selectedCard.name,
        rpCost: selectedCard.rp,
        creditCost: creditsUsed,
        realCost: realUsed,
        totalCost: selectedCard.totalCost
      });
      setUser(data.user);
      setRedemptions(prev => [{
        id: Date.now(), skinName: selectedCard.name, rpCost: selectedCard.rp,
        creditCost: creditsUsed, realCost: realUsed, totalCost: selectedCard.totalCost,
        status: "pending", createdAt: Date.now()
      }, ...prev]);
      setSelectedCard(null);
      toast(`✅ Redemption submitted! Your ${selectedCard.name} will be gifted to your LoL account within 24h.`, "success");
    } catch(e) {
      toast(e.message, "error");
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Balance overview */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={{ background: "#1a0d28", border: "1px solid #a78bfa44", borderRadius: 8, padding: "16px 18px" }}>
          <div style={{ fontSize: 13, letterSpacing: 2, color: "#a78bfa", marginBottom: 6, fontFamily: "DM Sans, sans-serif", fontWeight: 600 }}>💜 SKIN CREDITS</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#a78bfa", fontFamily: "Barlow Condensed, sans-serif" }}>${skinCredits.toFixed(2)}</div>
          <div style={{ fontSize: 13, color: "#c4b5fd", fontFamily: "DM Sans, sans-serif", marginTop: 4 }}>Earned from bet winnings</div>
        </div>
        <div style={{ background: "#0d280d", border: "1px solid #4ade8044", borderRadius: 8, padding: "16px 18px" }}>
          <div style={{ fontSize: 13, letterSpacing: 2, color: "#4ade80", marginBottom: 6, fontFamily: "DM Sans, sans-serif", fontWeight: 600 }}>💵 REAL BALANCE</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#4ade80", fontFamily: "Barlow Condensed, sans-serif" }}>${realBalance.toFixed(2)}</div>
          <div style={{ fontSize: 13, color: "#86efac", fontFamily: "DM Sans, sans-serif", marginTop: 4 }}>Withdrawable funds</div>
        </div>
      </div>

      {/* How it works */}
      <div style={{ background: "#1a1a28", border: "1px solid #a78bfa22", borderRadius: 8, padding: "14px 18px" }}>
        <div style={{ fontSize: 14, color: "#c4b5fd", fontFamily: "DM Sans, sans-serif", lineHeight: 1.7 }}>
          <strong style={{ color: "#a78bfa" }}>How it works:</strong> Choose an RP card below. You can pay using any mix of your Skin Credits and Real Balance. After submitting, the RP card will be gifted directly to your linked LoL account — usually within 24 hours.
        </div>
      </div>

      {/* Checkout modal */}
      {selectedCard && (
        <div style={{ background: "#1A1A1E", border: "2px solid #a78bfa55", borderRadius: 10, padding: 24 }}>
          <div style={{ fontSize: 14, letterSpacing: 2, color: "#a78bfa", marginBottom: 16, fontFamily: "DM Sans, sans-serif", fontWeight: 700 }}>CHECKOUT — {selectedCard.name}</div>
          <div style={{ fontSize: 22, color: "#a78bfa", fontWeight: 900, fontFamily: "Barlow Condensed, sans-serif", marginBottom: 20 }}>{selectedCard.rp.toLocaleString()} RP · Total: ${selectedCard.totalCost.toFixed(2)}</div>

          {/* Split slider */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 14, color: "#a78bfa", fontFamily: "DM Sans, sans-serif", fontWeight: 600 }}>💜 Credits: ${creditsUsed.toFixed(2)}</span>
              <span style={{ fontSize: 14, color: "#4ade80", fontFamily: "DM Sans, sans-serif", fontWeight: 600 }}>💵 Real: ${realUsed.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.min(skinCredits, selectedCard.totalCost)}
              step={0.01}
              value={creditsUsed}
              onChange={e => {
                const v = Number(e.target.value);
                const r = Math.round((selectedCard.totalCost - v) * 100) / 100;
                if (r <= realBalance) setCreditsUsed(Math.round(v * 100) / 100);
              }}
              style={{ width: "100%", accentColor: "#a78bfa" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#7A7A82", fontFamily: "DM Sans, sans-serif", marginTop: 4 }}>
              <span>All real money</span><span>All skin credits</span>
            </div>
          </div>

          {/* Breakdown */}
          <div style={{ background: "#242428", borderRadius: 6, padding: "12px 16px", marginBottom: 16 }}>
            {creditsUsed > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 14, color: "#c4b5fd", fontFamily: "DM Sans, sans-serif" }}>Skin Credits used</span>
              <span style={{ fontSize: 14, color: "#a78bfa", fontWeight: 700 }}>−${creditsUsed.toFixed(2)}</span>
            </div>}
            {realUsed > 0 && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 14, color: "#86efac", fontFamily: "DM Sans, sans-serif" }}>Real Balance used</span>
              <span style={{ fontSize: 14, color: "#4ade80", fontWeight: 700 }}>−${realUsed.toFixed(2)}</span>
            </div>}
            {!canAffordSelected && (
              <div style={{ color: "#C8464A", fontSize: 13, fontFamily: "DM Sans, sans-serif", marginTop: 6 }}>
                ⚠️ Not enough balance. Adjust the slider or deposit more funds.
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={redeem} disabled={loading || !canAffordSelected} style={{
              flex: 2, background: canAffordSelected ? "linear-gradient(135deg, #a78bfa, #7c3aed)" : "#35353A",
              color: canAffordSelected ? "#fff" : "#A0A0A8", border: "none", padding: "14px",
              borderRadius: 4, fontFamily: "Barlow Condensed, sans-serif", fontSize: 15,
              fontWeight: 700, cursor: canAffordSelected ? "pointer" : "not-allowed", letterSpacing: 1
            }}>
              {loading ? "Submitting..." : "CONFIRM REDEMPTION"}
            </button>
            <button onClick={() => setSelectedCard(null)} style={{
              flex: 1, background: "none", color: "#A0A0A8", border: "1px solid #35353A",
              padding: "14px", borderRadius: 4, fontFamily: "Barlow Condensed, sans-serif",
              fontSize: 14, cursor: "pointer"
            }}>CANCEL</button>
          </div>
        </div>
      )}

      {/* RP Cards grid */}
      <div style={{ background: "#242428", border: "1px solid #2D2D32", borderRadius: 8, padding: 24 }}>
        <div style={{ fontSize: 14, letterSpacing: 2, color: "#C8AA6E", marginBottom: 20, fontWeight: 700 }}>RP CARD SHOP</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {RP_CARDS.map(card => {
            const totalAvailable = skinCredits + realBalance;
            const canAfford = totalAvailable >= card.totalCost;
            return (
              <div key={card.name} style={{
                background: "#1A1A1E", border: `2px solid ${card.popular ? "#a78bfa55" : "#2A2A2E"}`,
                borderRadius: 8, padding: 18, position: "relative"
              }}>
                {card.popular && (
                  <div style={{ position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)", background: "#a78bfa", color: "#1A1A1E", fontSize: 10, fontWeight: 700, letterSpacing: 1, padding: "3px 12px", borderRadius: 10 }}>POPULAR</div>
                )}
                <div style={{ fontSize: 22, marginBottom: 8 }}>🎮</div>
                <div style={{ color: "#F0F0F0", fontSize: 17, fontWeight: 700, fontFamily: "Barlow Condensed, sans-serif", marginBottom: 4 }}>{card.name}</div>
                <div style={{ color: "#a78bfa", fontSize: 24, fontWeight: 900, fontFamily: "Barlow Condensed, sans-serif", marginBottom: 8 }}>{card.rp.toLocaleString()} RP</div>
                <div style={{ fontSize: 14, color: "#C0C0C8", fontFamily: "DM Sans, sans-serif", marginBottom: 14 }}>
                  Total: <span style={{ color: "#F0F0F0", fontWeight: 700 }}>${card.totalCost.toFixed(2)}</span>
                  <span style={{ color: "#7A7A82", marginLeft: 6 }}>(credits + real balance)</span>
                </div>
                <button
                  onClick={() => canAfford ? openCheckout(card) : toast("Not enough combined balance (credits + real funds)", "error")}
                  style={{
                    width: "100%", background: canAfford ? "linear-gradient(135deg, #a78bfa, #7c3aed)" : "#35353A",
                    color: canAfford ? "#fff" : "#7A7A82", border: "none", padding: "10px",
                    borderRadius: 4, fontFamily: "Barlow Condensed, sans-serif", fontSize: 13,
                    fontWeight: 700, cursor: canAfford ? "pointer" : "not-allowed", letterSpacing: 1
                  }}>
                  {canAfford ? "SELECT" : `Need $${Math.max(0, card.totalCost - totalAvailable).toFixed(2)} more`}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Redemption history */}
      <div style={{ background: "#242428", border: "1px solid #2D2D32", borderRadius: 8, padding: 24 }}>
        <div style={{ fontSize: 14, letterSpacing: 2, color: "#C8AA6E", marginBottom: 16, fontWeight: 700 }}>YOUR REDEMPTIONS</div>
        <div style={{ fontSize: 14, color: "#A0A0A8", fontFamily: "DM Sans, sans-serif", marginBottom: 16 }}>
          Status <span style={{ color: "#a78bfa" }}>Pending</span> = request received, gift on its way. <span style={{ color: "#4ade80" }}>Sent</span> = gifted in-game.
        </div>
        {loadingHistory ? <Loader text="Loading..." /> : redemptions.length === 0 ? (
          <div style={{ color: "#A0A0A8", fontSize: 14, fontFamily: "DM Sans, sans-serif", fontStyle: "italic", textAlign: "center", padding: "16px 0" }}>No redemptions yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {redemptions.map((r, i) => (
              <div key={r.id || i} style={{ padding: "14px 16px", borderRadius: 6, background: "#1A1A1E", border: `1px solid ${r.status === "fulfilled" ? "#4ade8033" : "#a78bfa33"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ color: "#F0F0F0", fontSize: 15, fontWeight: 700, fontFamily: "Barlow Condensed, sans-serif" }}>{r.skinName}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: r.status === "fulfilled" ? "#4ade80" : "#a78bfa", border: `1px solid ${r.status === "fulfilled" ? "#4ade80" : "#a78bfa"}`, padding: "2px 8px", borderRadius: 3, letterSpacing: 1, fontWeight: 700 }}>
                        {r.status === "fulfilled" ? "✓ SENT" : "⏳ PENDING"}
                      </span>
                      <span style={{ fontSize: 13, color: "#A0A0A8", fontFamily: "DM Sans, sans-serif" }}>{timeAgo(r.createdAt)}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {r.creditCost > 0 && <div style={{ color: "#a78bfa", fontSize: 14, fontWeight: 700 }}>💜 −${Number(r.creditCost).toFixed(2)}</div>}
                    {r.realCost > 0 && <div style={{ color: "#4ade80", fontSize: 14, fontWeight: 700 }}>💵 −${Number(r.realCost).toFixed(2)}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── BET HISTORY ─────────────────────────────────────────────────────────────
function BetHistory({ bets }) {
  if (!bets?.length) return (
    <div style={{ background: "#242428", border: "1px solid #2D2D32", borderRadius: 4, padding: 24, textAlign: "center" }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: "#A0A0A8", marginBottom: 12 }}>BET HISTORY</div>
      <p style={{ color: "#A0A0A8", fontFamily: "DM Sans, sans-serif", fontStyle: "italic" }}>No bets yet. Place your first wager.</p>
    </div>
  );

  return (
    <div style={{ background: "#242428", border: "1px solid #2D2D32", borderRadius: 4, padding: 24 }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: "#A0A0A8", marginBottom: 16 }}>BET HISTORY</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[...bets].reverse().map(bet => (
          <div key={bet.id} style={{
            background: "#1A1A1E", border: `1px solid ${bet.status === "won" ? "#0BC4AA33" : bet.status === "lost" ? "#C8464A33" : "#785A2833"}`,
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
                {bet.result && <span style={{ color: "#A0A0A8", fontSize: 12, fontFamily: "DM Sans, sans-serif" }}>
                  {bet.result.champion} · {bet.result.kills}/{bet.result.deaths}/{bet.result.assists}
                </span>}
              </div>
              <div style={{ color: "#A0A0A8", fontSize: 11, marginTop: 4 }}>{timeAgo(bet.placedAt)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ color: "#F0F0F0", fontSize: 16, fontWeight: 700 }}>
                {bet.status === "won" ? "+" : bet.status === "pending" ? "" : "-"}{formatMoney(bet.status === "won" ? bet.potentialWin : bet.amount)}
              </div>
              <div style={{ color: "#A0A0A8", fontSize: 11 }}>bet: {formatMoney(bet.amount)}</div>
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
    <div style={{ background: "#242428", border: "1px solid #2D2D32", borderRadius: 4, padding: 24 }}>
      <div style={{ fontSize: 10, letterSpacing: 3, color: "#A0A0A8", marginBottom: 20 }}>LEADERBOARD</div>
      {loading ? <Loader /> : (
        <div>
          {users.map((u, i) => (
            <div key={u.username} style={{
              display: "flex", alignItems: "center", gap: 16,
              padding: "12px 0", borderBottom: "1px solid #2A2A2E"
            }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: i === 0 ? "#C8AA6E" : i === 1 ? "#A0A0A0" : i === 2 ? "#CD7F32" : "#35353A",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 700, color: i < 3 ? "#1A1A1E" : "#C0C0C8", flexShrink: 0
              }}>{i + 1}</div>
              <div style={{ flex: 1 }}>
                <div style={{ color: "#F0F0F0", fontSize: 14, fontWeight: 600 }}>{u.username}</div>
                <div style={{ color: "#A0A0A8", fontSize: 11, fontFamily: "DM Sans, sans-serif" }}>
                  {u.lolAccount || "No LoL account"} {u.rank && `• ${u.rank}`}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: "#C8AA6E", fontSize: 16, fontWeight: 700 }}>{formatMoney(u.balance)}</div>
                <div style={{ color: "#A0A0A8", fontSize: 11 }}>{u.wins}W / {u.total - u.wins}L</div>
              </div>
            </div>
          ))}
          {!users.length && <p style={{ color: "#A0A0A8", textAlign: "center", fontFamily: "DM Sans, sans-serif" }}>No players yet</p>}
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
    <div style={{ background: "#242428", border: "1px solid #2D2D32", borderRadius: 8, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: "1px solid #252528", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 12, letterSpacing: 3, color: "#C8AA6E" }}>LIVE GAMES</div>
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
            borderBottom: i < 3 ? "1px solid #222225" : "none",
            background: flash === i ? "#C8AA6E06" : "transparent",
            transition: "background 0.3s ease"
          }}>
            {/* Top row: champion + bet */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "#F0F0F0", letterSpacing: 0 }}>{g.champ}</span>
              <span style={{ fontSize: 13, fontWeight: 900, color: "#C8AA6E" }}>${g.bet}</span>
            </div>
            {/* Bottom row: rank + game time + kda */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: RANK_COLORS[g.rank] || "#C0C0C8", letterSpacing: 1, fontWeight: 600 }}>
                {g.rank}{g.div}
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#FFFFFF55", fontFamily: "DM Sans, sans-serif" }}>{g.mins}m</span>
                <span style={{ fontSize: 11, color: "#FFFFFF44" }}>{g.k}/{g.d}/{g.a}</span>
              </div>
            </div>
            {/* Progress bar showing game time */}
            <div style={{ marginTop: 6, height: 2, background: "#785A2811", borderRadius: 1 }}>
              <div style={{ height: "100%", width: `${(g.mins / 50) * 100}%`, background: `linear-gradient(90deg, #785A28, ${RANK_COLORS[g.rank] || "#C8AA6E"})`, borderRadius: 1, transition: "width 0.5s ease" }} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: "8px 16px", borderTop: "1px solid #222225", textAlign: "center" }}>
        <span style={{ fontSize: 10, color: "#A0A0A8", letterSpacing: 2 }}>UPDATES EVERY FEW SECONDS</span>
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
        <div style={{ marginBottom: 16, animation: "floatIcon 3s ease-in-out infinite" }}>
          {won ? (
            <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
              <circle cx="40" cy="40" r="38" fill="#C8AA6E22" stroke="#C8AA6E" strokeWidth="1.5"/>
              <path d="M20 28 C20 18 60 18 60 28 L60 44 C60 52 52 58 40 58 C28 58 20 52 20 44Z" fill="#C8AA6E"/>
              <rect x="28" y="56" width="24" height="6" rx="2" fill="#C8AA6E"/>
              <rect x="24" y="60" width="32" height="5" rx="2" fill="#A07830"/>
              <rect x="14" y="28" width="8" height="18" rx="4" fill="#C8AA6E"/>
              <rect x="58" y="28" width="8" height="18" rx="4" fill="#C8AA6E"/>
              <circle cx="31" cy="38" r="5" fill="#1A1A1E"/>
              <circle cx="49" cy="38" r="5" fill="#1A1A1E"/>
            </svg>
          ) : (
            <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
              <circle cx="40" cy="40" r="38" fill="#F8514922" stroke="#F85149" strokeWidth="1.5"/>
              <ellipse cx="40" cy="37" rx="20" ry="18" fill="#F85149"/>
              <circle cx="32" cy="34" r="4" fill="#1A1A1E"/>
              <circle cx="48" cy="34" r="4" fill="#1A1A1E"/>
              <rect x="28" y="44" width="4" height="8" rx="2" fill="#1A1A1E"/>
              <rect x="36" y="44" width="4" height="10" rx="2" fill="#1A1A1E"/>
              <rect x="44" y="44" width="4" height="8" rx="2" fill="#1A1A1E"/>
              <ellipse cx="40" cy="55" rx="12" ry="4" fill="#C8464A"/>
              <path d="M28 27 L24 18 M40 25 L40 16 M52 27 L56 18" stroke="#F85149" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          )}
        </div>

        {/* Win/Loss title */}
        <div style={{
          fontFamily: "Barlow Condensed, sans-serif",
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
            background: "#1A1A1E",
            border: `1px solid ${won ? "#C8AA6E33" : "#C8464A33"}`,
            borderRadius: 8, padding: "20px 24px", marginBottom: 24
          }}>
            <div style={{ color: "#A0A0A8", fontSize: 10, letterSpacing: 3, marginBottom: 12 }}>MATCH RESULT</div>
            <div style={{ color: "#C8AA6E", fontSize: 18, fontWeight: 700, fontFamily: "Barlow Condensed, sans-serif", marginBottom: 16 }}>
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
                  borderRight: i < 2 ? "1px solid #2D2D32" : "none",
                  padding: "0 16px"
                }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: s.color, fontFamily: "Barlow Condensed, sans-serif" }}>{s.value}</div>
                  <div style={{ fontSize: 9, letterSpacing: 2, color: "#A0A0A8", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "#A0A0A8", fontFamily: "DM Sans, sans-serif" }}>
              KDA: <span style={{ color: "#F0F0F0" }}>
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
              <div style={{ color: "#A0A0A8", fontSize: 11, letterSpacing: 2, marginBottom: 4 }}>WINNINGS</div>
              <div style={{ color: "#0BC4AA", fontSize: 32, fontWeight: 900, fontFamily: "Barlow Condensed, sans-serif" }}>
                +${Number(bet?.potentialWin || 0).toFixed(2)}
              </div>
              <div style={{ color: "#A0A0A8", fontSize: 11, marginTop: 4 }}>added to your balance</div>
            </>
          ) : (
            <>
              <div style={{ color: "#A0A0A8", fontSize: 11, letterSpacing: 2, marginBottom: 4 }}>LOST</div>
              <div style={{ color: "#C8464A", fontSize: 32, fontWeight: 900, fontFamily: "Barlow Condensed, sans-serif" }}>
                -${Number(bet?.amount || 0).toFixed(2)}
              </div>
              <div style={{ color: "#A0A0A8", fontSize: 11, marginTop: 4 }}>better luck next time, summoner</div>
            </>
          )}
        </div>

        <button onClick={onClose} style={{
          background: won ? "linear-gradient(135deg, #C8AA6E, #785A28)" : "transparent",
          border: won ? "none" : "1px solid #C8464A55",
          color: won ? "#010A13" : "#C8464A",
          padding: "12px 40px", borderRadius: 4,
          fontFamily: "Barlow Condensed, sans-serif", fontSize: 13, fontWeight: 700,
          cursor: "pointer", letterSpacing: 2, textTransform: "uppercase"
        }}>
          {won ? "Claim Victory" : "Try Again"}
        </button>

        <div style={{ color: "#7A7A82", fontSize: 10, marginTop: 12, fontFamily: "DM Sans, sans-serif" }}>
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
      }}>debug</button>
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
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem("rw_session_user");
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [tab, setTab] = useState("dashboard");
  const [toast, setToast] = useState(null);
  const [region, setRegion] = useState("euw1");
  const [resultScreen, setResultScreen] = useState(null);
  const [walletMode, setWalletMode] = useState("virtual"); // "virtual" | "real"

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

  const tabs = ["dashboard", "bet", "history", "leaderboard", "deposit", "shop"];

  return (
    <div style={{ minHeight: "100vh", background: "#1A1A1E", fontFamily: "Barlow Condensed, sans-serif", color: "#E0E0E0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700;800;900&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap');
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
      <div style={{ borderBottom: "1px solid #2D2D32", background: "#141416" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 10, letterSpacing: 4, color: "#A0A0A8" }}>RUNETERRA</span>
            <span style={{ color: "#6A6A72" }}>|</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#C8AA6E" }}>WAGERS</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {/* 3 balance pills */}
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ background: "#1A1A1E", border: "1px solid #C8AA6E33", borderRadius: 4, padding: "4px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 8, letterSpacing: 2, color: "#785A28" }}>GOLD</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#C8AA6E" }}>{formatMoney(user.balance)}</div>
              </div>
              <div style={{ background: "#1A1A1E", border: "1px solid #4ade8033", borderRadius: 4, padding: "4px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 8, letterSpacing: 2, color: "#16a34a" }}>REAL</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>{formatMoney(user.realBalance || 0)}</div>
              </div>
              <div style={{ background: "#1A1A1E", border: "1px solid #a78bfa33", borderRadius: 4, padding: "4px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 8, letterSpacing: 2, color: "#7c3aed" }}>CREDITS</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>{formatMoney(user.skinCredits || 0)}</div>
              </div>
            </div>
            <div style={{ width: 1, height: 32, background: "#785A2833" }} />
            <div style={{ fontSize: 12, color: "#A0A0A8" }}>{user.username}</div>
            <button onClick={() => setUser(null)} style={{
              background: "none", border: "1px solid #35353A", color: "#A0A0A8",
              padding: "4px 10px", borderRadius: 3, cursor: "pointer",
              fontFamily: "Barlow Condensed, sans-serif", fontSize: 10, letterSpacing: 1
            }}>LOGOUT</button>
          </div>
        </div>

        {/* Nav tabs */}
        <div style={{ display: "flex", padding: "0 24px", gap: 4 }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: "none", border: "none", cursor: "pointer",
              padding: "10px 16px", fontFamily: "Barlow Condensed, sans-serif", fontSize: 13,
              letterSpacing: 2, textTransform: "uppercase",
              color: t === "shop" ? (tab === t ? "#a78bfa" : "#5b3f8a") : tab === t ? "#C8AA6E" : "#785A28",
              borderBottom: `2px solid ${t === "shop" ? (tab === t ? "#a78bfa" : "transparent") : tab === t ? "#C8AA6E" : "transparent"}`,
              transition: "all 0.2s"
            }}>{t === "shop" ? "💜 Shop" : t === "deposit" ? "💵 Deposit" : t}</button>
          ))}
        </div>
      </div>

      {/* Content · wide 3-col layout */}
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 220px", gap: 0, minHeight: "calc(100vh - 100px)", animation: "fadeIn 0.3s ease" }}>

        {/* LEFT SIDEBAR */}
        <div style={{ padding: "24px 16px 24px 24px", borderRight: "1px solid #252528", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Player card */}
          <div style={{ background: "#242428", border: "1px solid #2D2D32", borderRadius: 8, padding: "18px 16px" }}>
            <div style={{ fontSize: 12, letterSpacing: 3, color: "#C8AA6E", marginBottom: 10 }}>SUMMONER</div>
            <div style={{ color: "#F0F0F0", fontSize: 18, fontWeight: 700, letterSpacing: 0, marginBottom: 4, fontFamily: "Barlow Condensed, sans-serif" }}>{user.username}</div>
            {user.lolAccount ? (
              <>
                <div style={{ color: "#D0D0D8", fontSize: 14, marginBottom: 10 }}>{user.lolAccount}</div>
                <div style={{ display: "inline-block", background: "linear-gradient(135deg, #C8AA6E22, #785A2811)", border: "1px solid #C8AA6E55", borderRadius: 3, padding: "4px 12px", fontSize: 11, color: "#C8AA6E", letterSpacing: 2, fontWeight: 700 }}>
                  {user.rank || "UNRANKED"}
                </div>
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <div style={{ flex: 1, textAlign: "center", background: "#1A1A1E", borderRadius: 4, padding: "8px 4px" }}>
                    <div style={{ color: "#3FB950", fontSize: 20, fontWeight: 700 }}>{stats.wins}</div>
                    <div style={{ color: "#8A8A92", fontSize: 9, letterSpacing: 2, marginTop: 2 }}>WINS</div>
                  </div>
                  <div style={{ flex: 1, textAlign: "center", background: "#1A1A1E", borderRadius: 4, padding: "8px 4px" }}>
                    <div style={{ color: "#F85149", fontSize: 20, fontWeight: 700 }}>{stats.losses}</div>
                    <div style={{ color: "#8A8A92", fontSize: 9, letterSpacing: 2, marginTop: 2 }}>LOSSES</div>
                  </div>
                  <div style={{ flex: 1, textAlign: "center", background: "#1A1A1E", borderRadius: 4, padding: "8px 4px" }}>
                    <div style={{ color: "#C8AA6E", fontSize: 20, fontWeight: 700 }}>
                      {stats.wins + stats.losses > 0 ? `${Math.round(stats.wins / (stats.wins + stats.losses) * 100)}%` : "--"}
                    </div>
                    <div style={{ color: "#8A8A92", fontSize: 9, letterSpacing: 2, marginTop: 2 }}>W/R</div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ color: "#A0A0A8", fontSize: 13, fontFamily: "DM Sans, sans-serif", fontStyle: "italic", marginTop: 4 }}>No account linked</div>
            )}
          </div>

          {/* Wallet toggle + balance cards */}
          <WalletToggle mode={walletMode} setMode={setWalletMode} />

          {walletMode === "virtual" ? (
            <div style={{ background: "linear-gradient(135deg, #0d1f3c, #0A1628)", border: "1px solid #C8AA6E22", borderRadius: 8, padding: "18px 16px" }}>
              <div style={{ fontSize: 12, letterSpacing: 3, color: "#C8AA6E", marginBottom: 6 }}>VIRTUAL GOLD</div>
              <div style={{ color: "#C8AA6E", fontSize: 30, fontWeight: 700, fontFamily: "Barlow Condensed, sans-serif" }}>{formatMoney(user.balance)}</div>
              <div style={{ marginTop: 10, height: 2, background: "#785A2818", borderRadius: 2 }}>
                <div style={{ height: "100%", width: `${Math.min(100, (user.balance / 500) * 100)}%`, background: "linear-gradient(90deg, #785A28, #C8AA6E)", borderRadius: 2, transition: "width 0.5s ease" }} />
              </div>
              <div style={{ color: "#C0C0C8", fontSize: 12, marginTop: 6, fontFamily: "DM Sans, sans-serif" }}>of $500.00 starting gold</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ background: "linear-gradient(135deg, #0d280d, #0a1a0a)", border: "1px solid #4ade8033", borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80" }} />
                  <div style={{ fontSize: 10, letterSpacing: 3, color: "#4ade80" }}>REAL BALANCE</div>
                </div>
                <div style={{ color: "#4ade80", fontSize: 26, fontWeight: 700, fontFamily: "Barlow Condensed, sans-serif" }}>{formatMoney(user.realBalance || 0)}</div>
                <div style={{ color: "#86efac", fontSize: 11, marginTop: 4, fontFamily: "DM Sans, sans-serif" }}>💳 withdrawable</div>
              </div>
              <div style={{ background: "linear-gradient(135deg, #1a0d28, #0d0818)", border: "1px solid #a78bfa33", borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#a78bfa" }} />
                  <div style={{ fontSize: 10, letterSpacing: 3, color: "#a78bfa" }}>SKIN CREDITS</div>
                </div>
                <div style={{ color: "#a78bfa", fontSize: 26, fontWeight: 700, fontFamily: "Barlow Condensed, sans-serif" }}>{formatMoney(user.skinCredits || 0)}</div>
                <div style={{ color: "#c4b5fd", fontSize: 11, marginTop: 4, fontFamily: "DM Sans, sans-serif" }}>💜 spend in shop</div>
              </div>
            </div>
          )}

          {/* Active bet */}
          {(() => {
            const activeBet = user.bets?.find(b => b.status === "pending");
            const isReal = activeBet?.mode === "real";
            return activeBet ? (
              <div style={{ background: "#242428", border: `1px solid ${isReal ? "#4ade8044" : "#C8AA6E44"}`, borderRadius: 8, padding: "18px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, letterSpacing: 3, color: isReal ? "#4ade80" : "#C8AA6E" }}>ACTIVE BET {isReal ? "💵" : "🎮"}</div>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: isReal ? "#4ade80" : "#C8AA6E", boxShadow: `0 0 8px ${isReal ? "#4ade80" : "#C8AA6E"}`, animation: "pulse 1.5s ease-in-out infinite" }} />
                </div>
                <div style={{ color: isReal ? "#4ade80" : "#C8AA6E", fontSize: 26, fontWeight: 700, fontFamily: "Barlow Condensed, sans-serif" }}>{formatMoney(activeBet.amount)}</div>
                <div style={{ color: "#E0E0E0", fontSize: 13, marginTop: 4, fontFamily: "DM Sans, sans-serif" }}>
                  {isReal
                    ? <>Stake: <span style={{ color: "#4ade80" }}>${activeBet.amount.toFixed(2)}</span> + Credits: <span style={{ color: "#a78bfa" }}>${(activeBet.potentialWin - activeBet.amount).toFixed(2)}</span></>
                    : <>Win: <span style={{ color: "#0BC4AA", fontWeight: 700 }}>{formatMoney(activeBet.potentialWin)}</span></>
                  }
                </div>
                <div style={{ color: "#A0A0A8", fontSize: 12, marginTop: 4, fontFamily: "DM Sans, sans-serif" }}>{timeAgo(activeBet.placedAt)}</div>
              </div>
            ) : (
              <div style={{ background: "#24242866", border: "1px solid #252528", borderRadius: 8, padding: "18px 16px", textAlign: "center" }}>
                <div style={{ color: "#7A7A82", fontSize: 13, fontFamily: "DM Sans, sans-serif" }}>No active bet</div>
              </div>
            );
          })()}

          {/* Multipliers table — winrate based */}
          <div style={{ background: "#242428", border: "1px solid #2D2D32", borderRadius: 8, padding: "18px 16px" }}>
            <div style={{ fontSize: 13, letterSpacing: 2, color: "#C8AA6E", marginBottom: 4, fontWeight: 700 }}>MULTIPLIERS</div>
            <div style={{ fontSize: 12, color: "#A0A0A8", fontFamily: "DM Sans, sans-serif", marginBottom: 12 }}>Based on your winrate</div>
            {WR_BRACKETS.map(({ range, odds, desc }) => {
              const wr = user.winrate;
              const isMe = wr != null && (
                (range === "65%+" && wr >= 65) ||
                (range === "58–64%" && wr >= 58 && wr < 65) ||
                (range === "52–57%" && wr >= 52 && wr < 58) ||
                (range === "48–51%" && wr >= 48 && wr < 52) ||
                (range === "42–47%" && wr >= 42 && wr < 48) ||
                (range === "<42%" && wr < 42)
              );
              return (
                <div key={range} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 8px", marginBottom: 2, borderRadius: 3, background: isMe ? "#C8AA6E11" : "transparent", border: isMe ? "1px solid #C8AA6E33" : "1px solid transparent" }}>
                  <div>
                    <div style={{ fontSize: 12, color: isMe ? "#C8AA6E" : "#A0A0A8", fontWeight: isMe ? 700 : 400, fontFamily: "DM Sans, sans-serif" }}>{range}</div>
                    <div style={{ fontSize: 11, color: isMe ? "#C8AA6E99" : "#5A5A62", fontFamily: "DM Sans, sans-serif" }}>{desc}</div>
                  </div>
                  <span style={{ fontSize: 14, color: isMe ? "#C8AA6E" : "#785A2899", fontWeight: 700 }}>{odds.toFixed(2)}x</span>
                </div>
              );
            })}
            {user.winrate == null && (
              <div style={{ fontSize: 12, color: "#A0A0A8", fontFamily: "DM Sans, sans-serif", fontStyle: "italic", marginTop: 8, textAlign: "center" }}>
                Link your LoL account to see your bracket
              </div>
            )}
          </div>
        </div>

        {/* CENTER CONTENT */}
        <div style={{ padding: "24px 24px" }}>
          {(tab === "dashboard" || tab === "bet") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <LinkAccount user={user} setUser={updateUser} region={region} setRegion={setRegion} toast={showToast} />
              <PlaceBet user={user} setUser={updateUser} toast={showToast} betMode={walletMode} />
              <ResolveBet user={user} setUser={updateUser} region={region} toast={showToast} showResult={setResultScreen} />
            </div>
          )}
          {tab === "history" && <BetHistory bets={user.bets} />}
          {tab === "leaderboard" && <Leaderboard />}
          {tab === "deposit" && <DepositPanel user={user} setUser={updateUser} toast={showToast} />}
          {tab === "shop" && <SkinShop user={user} setUser={updateUser} toast={showToast} />}
        </div>

        {/* RIGHT SIDEBAR */}
        <div style={{ padding: "24px 24px 24px 16px", borderLeft: "1px solid #252528", display: "flex", flexDirection: "column", gap: 14 }}>
          <LiveFeed />
          <div style={{ background: "#242428", border: "1px solid #2D2D32", borderRadius: 8, padding: "18px 16px" }}>
            <div style={{ fontSize: 12, letterSpacing: 3, color: "#C8AA6E", marginBottom: 14 }}>YOUR RECENT BETS</div>
            {user.bets?.filter(b => b.status !== "pending").length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {[...user.bets].reverse().filter(b => b.status !== "pending").slice(0, 4).map(bet => (
                  <div key={bet.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 4, background: bet.status === "won" ? "#0BC4AA08" : "#C8464A08", border: `1px solid ${bet.status === "won" ? "#0BC4AA22" : "#C8464A22"}` }}>
                    <div>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <div style={{ fontSize: 12, color: bet.status === "won" ? "#0BC4AA" : "#C8464A", fontWeight: 700, letterSpacing: 1 }}>{bet.status === "won" ? "WIN" : "LOSS"}</div>
                        {bet.mode === "real" && <div style={{ fontSize: 9, color: "#4ade80", border: "1px solid #4ade8044", borderRadius: 2, padding: "1px 4px" }}>REAL</div>}
                      </div>
                      {bet.result?.champion && <div style={{ fontSize: 12, color: "#A0A0A8", fontFamily: "DM Sans, sans-serif", marginTop: 1 }}>{bet.result.champion} · {bet.result.kills}/{bet.result.deaths}/{bet.result.assists}</div>}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: bet.status === "won" ? "#0BC4AA" : "#C8464A" }}>
                      {bet.status === "won" ? "+" : "-"}{formatMoney(bet.status === "won" ? bet.potentialWin : bet.amount)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ color: "#C0C0C8", fontSize: 13, fontFamily: "DM Sans, sans-serif", fontStyle: "italic", textAlign: "center", padding: "16px 0" }}>No completed bets yet</div>
            )}
          </div>
          <div style={{ background: "#242428", border: "1px solid #2D2D32", borderRadius: 8, padding: "18px 16px" }}>
            <div style={{ fontSize: 13, letterSpacing: 2, color: "#C8AA6E", marginBottom: 14, fontWeight: 700 }}>HOUSE RULES</div>
            {[
              ["Virtual bets: $1–$30", "5% rake on winnings"],
              ["Real bets: max $1.00", "Stake returned if you win"],
              ["Profit → Skin Credits", "Spend in 💜 Shop tab"],
              ["Odds based on WR", "Solo/Duo ranked only"],
            ].map(([rule, sub], i) => (
              <div key={i} style={{ paddingBottom: 10, marginBottom: 10, borderBottom: i < 3 ? "1px solid #222225" : "none" }}>
                <div style={{ fontSize: 15, color: "#FFFFFF", fontWeight: 600 }}>{rule}</div>
                <div style={{ fontSize: 13, color: "#C0C0C8", marginTop: 3, fontFamily: "DM Sans, sans-serif" }}>{sub}</div>
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
