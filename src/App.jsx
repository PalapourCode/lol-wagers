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
// Mathematical basis: fair odds = 1 / win_probability
// House edge: 15% → multiplier = (1 / win_prob) * 0.85
// Clamped between 1.20x (dominant) and 3.00x (struggling)
// No winrate data → 1.70x default (balanced, 15% edge at 50% WR)
const getOdds = (winrate) => {
  if (winrate == null) return 1.70;
  const winProb = Math.max(0.25, Math.min(0.80, winrate / 100));
  const raw = (1 / winProb) * 0.85;
  return Math.round(Math.max(1.20, Math.min(3.00, raw)) * 100) / 100;
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
// All values computed from getOdds() at representative WR midpoints
const WR_BRACKETS = [
  { label: "65%+ WR",   range: "65%+",    odds: getOdds(67), desc: "Dominant"     },
  { label: "58–64% WR", range: "58–64%",  odds: getOdds(61), desc: "Favoured"     },
  { label: "52–57% WR", range: "52–57%",  odds: getOdds(54), desc: "Above average"},
  { label: "48–51% WR", range: "48–51%",  odds: getOdds(50), desc: "Balanced"     },
  { label: "42–47% WR", range: "42–47%",  odds: getOdds(44), desc: "Underdog"     },
  { label: "< 42% WR",  range: "<42%",    odds: getOdds(38), desc: "High Risk"    },
];

const formatMoney = (n) => `$${Number(n).toFixed(2)}`;   // virtual gold (fake $)
const formatEUR   = (n) => `€${Number(n).toFixed(2)}`;   // real balance & credits (EUR)

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
  const [email, setEmail] = useState("");
  const [rememberMe, setRememberMe] = useState(() => !!localStorage.getItem("rw_saved_username"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handle = async () => {
    if (!username.trim() || !password.trim()) return setError("Fill all fields");
    setLoading(true); setError("");
    try {
      const data = await apiCall("/api/auth", { action: mode === "register" ? "register" : "login", username: username.trim(), password, email: email.trim() || undefined });
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

            {/* Email — register only */}
            {mode === "register" && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 9, letterSpacing: 3, color: "#A0A0A8", marginBottom: 6 }}>
                  EMAIL <span style={{ color: "#555", fontWeight: 400, letterSpacing: 1 }}>(for card delivery notifications)</span>
                </label>
                <input
                  className="auth-input"
                  type="email" value={email} placeholder="you@example.com"
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handle()}
                  style={{
                    width: "100%", background: "#1A1A1E", border: "1px solid #2D2D32",
                    color: "#F0F0F0", padding: "11px 14px", borderRadius: 4,
                    fontFamily: "Barlow Condensed, sans-serif", fontSize: 13, outline: "none",
                    transition: "border-color 0.2s"
                  }}
                />
              </div>
            )}

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
                {["Virtual currency only · no real money", "Solo/Duo ranked games only", "$30 max virtual bet per game", "5% platform rake on winnings"].map(t => (
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
        rank,
        region,
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
    if (amount > maxBet) return toast(`Max bet is €${maxBet.toFixed(2)}`, "error");
    if (amount > availableBalance) return toast(`Insufficient ${isReal ? "real" : "virtual"} balance`, "error");
    if (amount < (isReal ? 0.10 : 1)) return toast(`Minimum bet is ${isReal ? "€0.10" : "$1"}`, "error");

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
      const winMsg = isReal
        ? `€${amount} back + €${(potentialWin - amount).toFixed(2)} skin credits`
        : `$${potentialWin}`;
      toast(`Bet placed! Win to earn ${winMsg}`, "success");
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
      <div style={{ fontSize: 10, letterSpacing: 3, color: "#A0A0A8", marginBottom: 12 }}>ACTIVE BET</div>

      {/* Auto-resolve notice */}
      <div style={{ background: "#0d1a0d", border: "1px solid #4ade8022", borderRadius: 6, padding: "10px 14px", marginBottom: 16, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <span style={{ fontSize: 16, flexShrink: 0 }}>⚡</span>
        <p style={{ color: "#86efac", fontSize: 13, fontFamily: "DM Sans, sans-serif", margin: 0, lineHeight: 1.5 }}>
          <strong>Auto-resolve is on.</strong> Your bet resolves automatically within 5 minutes of your game ending — even if you close this tab.
        </p>
      </div>

      <p style={{ color: "#FFFFFF66", fontSize: 13, fontFamily: "DM Sans, sans-serif", marginBottom: 16 }}>
        Already finished a game? Click below to resolve instantly instead of waiting.
      </p>
      <button onClick={resolve} disabled={loading} style={{
        background: "transparent", border: `1px solid ${isReal ? "#4ade80" : "#C8AA6E"}`,
        color: isReal ? "#4ade80" : "#C8AA6E",
        padding: "12px 24px", borderRadius: 3, fontFamily: "Barlow Condensed, sans-serif",
        fontSize: 13, fontWeight: 700, cursor: "pointer", letterSpacing: 1,
        transition: "all 0.2s", width: "100%"
      }}>
        {loading ? "Checking Riot API..." : "Resolve Now"}
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
            <span style={{ fontSize: 12, color: "#4ade80" }}>Max: €500</span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "#4ade80", fontSize: 18 }}>€</span>
            <input type="number" min={5} max={500} value={amount}
              onChange={e => setAmount(Math.min(500, Math.max(5, Number(e.target.value))))}
              style={{ flex: 1, background: "#1A1A1E", border: "1px solid #4ade8044", color: "#F0F0F0", padding: "12px", borderRadius: 3, fontFamily: "Barlow Condensed, sans-serif", fontSize: 20, fontWeight: 700, textAlign: "center", outline: "none" }}
            />
          </div>
          <input type="range" min={5} max={500} value={amount} onChange={e => setAmount(Number(e.target.value))}
            style={{ width: "100%", marginTop: 12, accentColor: "#4ade80" }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          {[10, 25, 50, 100].map(v => (
            <button key={v} onClick={() => setAmount(v)} style={{
              flex: 1, background: amount === v ? "#4ade8022" : "#010A13", color: amount === v ? "#4ade80" : "#C0C0C8",
              border: `1px solid ${amount === v ? "#4ade80" : "#35353A"}`, borderRadius: 3, padding: "6px",
              fontFamily: "Barlow Condensed, sans-serif", fontSize: 12, cursor: "pointer"
            }}>€{v}</button>
          ))}
        </div>
        <PayPalButton
          amount={amount} username={user.username}
          onSuccess={(deposited, newRealBal) => {
            setUser(prev => ({ ...prev, realBalance: newRealBal }));
            setDeposits(prev => [{ id: Date.now(), amount: deposited, created_at: Date.now(), status: "completed" }, ...prev]);
            toast(`✅ €${deposited.toFixed(2)} added to your real balance!`, "success");
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
                <div style={{ color: "#4ade80", fontSize: 16, fontWeight: 900 }}>+€{Number(d.amount).toFixed(2)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SKIN SHOP ────────────────────────────────────────────────────────────────
// RP cards — exact Riot EUR prices (EUW 2025):
// 575 RP=€4.99 | 1380 RP=€10.99 | 2800 RP=€21.99 | 4500 RP=€34.99 | 6500 RP=€49.99
// Credit prices = Riot EUR price + ~2% for EUR/USD buffer. Profit from 15% bet edge.
const RP_CARDS = [
  { name: "575 RP",  rp: 575,  eurCost: 4.99,  totalCost: 5.10,  popular: false },
  { name: "1380 RP", rp: 1380, eurCost: 10.99, totalCost: 11.20, popular: true  },
  { name: "2800 RP", rp: 2800, eurCost: 21.99, totalCost: 22.50, popular: false },
  { name: "4500 RP", rp: 4500, eurCost: 34.99, totalCost: 35.70, popular: false },
  { name: "6500 RP", rp: 6500, eurCost: 49.99, totalCost: 51.00, popular: false },
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
          <div style={{ fontSize: 26, fontWeight: 700, color: "#4ade80", fontFamily: "Barlow Condensed, sans-serif" }}>{`€${realBalance.toFixed(2)}`}</div>
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
          <div style={{ fontSize: 22, color: "#a78bfa", fontWeight: 900, fontFamily: "Barlow Condensed, sans-serif", marginBottom: 20 }}>{selectedCard.rp.toLocaleString()} RP · €{selectedCard.eurCost.toFixed(2)} <span style={{ fontSize: 15, color: "#7A7A82" }}>({selectedCard.totalCost.toFixed(2)} credits)</span></div>

          {/* Split slider */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 14, color: "#a78bfa", fontFamily: "DM Sans, sans-serif", fontWeight: 600 }}>💜 Credits: {creditsUsed.toFixed(2)}</span>
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
              <span style={{ fontSize: 14, color: "#a78bfa", fontWeight: 700 }}>−{creditsUsed.toFixed(2)}</span>
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
                  <span style={{ color: "#F0F0F0", fontWeight: 700, fontSize: 18 }}>€{card.eurCost.toFixed(2)}</span>
                  <span style={{ color: "#7A7A82", marginLeft: 8, fontSize: 13 }}>≈ {card.totalCost.toFixed(2)} credits</span>
                </div>
                <button
                  onClick={() => canAfford ? openCheckout(card) : toast("Not enough combined balance (credits + real funds)", "error")}
                  style={{
                    width: "100%", background: canAfford ? "linear-gradient(135deg, #a78bfa, #7c3aed)" : "#35353A",
                    color: canAfford ? "#fff" : "#7A7A82", border: "none", padding: "10px",
                    borderRadius: 4, fontFamily: "Barlow Condensed, sans-serif", fontSize: 13,
                    fontWeight: 700, cursor: canAfford ? "pointer" : "not-allowed", letterSpacing: 1
                  }}>
                  {canAfford ? "SELECT" : `Need ${Math.max(0, card.totalCost - totalAvailable).toFixed(2)} more credits`}
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
  const [phase, setPhase] = useState("intro"); // intro → main → payout
  const [teemos, setTeemos] = useState([]);
  const [particles, setParticles] = useState([]);
  const audioCtx = useRef(null);

  // ── SOUND ENGINE ────────────────────────────────────────────────────────────
  const getAudioCtx = () => {
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx.current;
  };

  const playTone = (freq, type, duration, gain = 0.3, delay = 0) => {
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = type; osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
      g.gain.setValueAtTime(0, ctx.currentTime + delay);
      g.gain.linearRampToValueAtTime(gain, ctx.currentTime + delay + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + duration + 0.05);
    } catch(e) {}
  };

  const playWinFanfare = () => {
    // Triumphant ascending fanfare
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) => playTone(f, "triangle", 0.4, 0.25, i * 0.12));
    setTimeout(() => {
      [784, 988, 1175, 1568].forEach((f, i) => playTone(f, "sine", 0.6, 0.2, i * 0.1));
    }, 700);
    // Low punch
    playTone(80, "sawtooth", 0.3, 0.4, 0);
    playTone(100, "sawtooth", 0.2, 0.3, 0.05);
  };

  const playLossDoom = () => {
    // Descending doom
    [400, 320, 250, 180, 120].forEach((f, i) => playTone(f, "sawtooth", 0.5, 0.2, i * 0.15));
    playTone(60, "square", 1.2, 0.15, 0);
    setTimeout(() => playTone(55, "sawtooth", 0.8, 0.1), 900);
  };

  const playCoinsSound = () => {
    for (let i = 0; i < 8; i++) {
      playTone(800 + Math.random() * 400, "sine", 0.15, 0.15, i * 0.06);
    }
  };

  const playTeemoSqueak = () => {
    playTone(1200, "sine", 0.08, 0.1, 0);
    playTone(1600, "sine", 0.06, 0.06, 0.05);
  };

  // ── PARTICLES ────────────────────────────────────────────────────────────────
  const spawnParticles = useCallback(() => {
    if (!won) return;
    const burst = Array.from({ length: 120 }, (_, i) => ({
      id: i + Date.now(),
      x: 20 + Math.random() * 60,
      y: -5,
      vx: (Math.random() - 0.5) * 4,
      size: 4 + Math.random() * 10,
      delay: Math.random() * 3,
      duration: 2.5 + Math.random() * 3,
      color: ["#C8AA6E","#FFD700","#0BC4AA","#ff6b35","#a78bfa","#fff","#C8464A","#00ff88"][Math.floor(Math.random() * 8)],
      shape: Math.random() > 0.6 ? "circle" : Math.random() > 0.5 ? "star" : "rect",
      spin: (Math.random() - 0.5) * 720,
    }));
    setParticles(burst);
  }, [won]);

  // ── TEEMOS ───────────────────────────────────────────────────────────────────
  const spawnTeemos = useCallback(() => {
    const count = won ? 12 : 6;
    const t = Array.from({ length: count }, (_, i) => ({
      id: i,
      x: Math.random() * 95,
      delay: i * 0.18 + Math.random() * 0.3,
      size: won ? 40 + Math.random() * 40 : 30 + Math.random() * 25,
      spin: (Math.random() - 0.5) * 60,
      speed: 3 + Math.random() * 4,
      flipped: Math.random() > 0.5,
      happy: won,
      wobble: Math.random() * 2,
    }));
    setTeemos(t);
  }, [won]);

  // ── LIFECYCLE ────────────────────────────────────────────────────────────────
  useEffect(() => {
    won ? playWinFanfare() : playLossDoom();
    spawnParticles();
    spawnTeemos();

    const t1 = setTimeout(() => setPhase("main"), 600);
    const t2 = setTimeout(() => { setPhase("payout"); playCoinsSound(); }, 1800);
    const t3 = setTimeout(onClose, 14000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  // Teemo squeak on hover
  const handleTeemoHover = () => playTeemoSqueak();

  // ── TEEMO SVG ────────────────────────────────────────────────────────────────
  const TeemoFace = ({ happy, size }) => (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ filter: happy ? "drop-shadow(0 0 8px #C8AA6E)" : "drop-shadow(0 0 6px #C8464A)" }}>
      {/* Body */}
      <ellipse cx="50" cy="65" rx="20" ry="25" fill={happy ? "#e8a040" : "#a04040"} />
      {/* Head */}
      <circle cx="50" cy="42" r="28" fill={happy ? "#f0b050" : "#b05050"} />
      {/* Hat */}
      <ellipse cx="50" cy="18" rx="32" ry="8" fill={happy ? "#cc3333" : "#661111"} />
      <ellipse cx="50" cy="16" rx="16" ry="14" fill={happy ? "#dd4444" : "#772222"} />
      {/* Hat pompom */}
      <circle cx="50" cy="4" r="6" fill="white" />
      {/* Eyes */}
      {happy ? (
        <>
          <ellipse cx="38" cy="42" rx="6" ry="7" fill="white" />
          <ellipse cx="62" cy="42" rx="6" ry="7" fill="white" />
          <circle cx="39" cy="43" r="4" fill="#1a1a1a" />
          <circle cx="63" cy="43" r="4" fill="#1a1a1a" />
          <circle cx="41" cy="41" r="1.5" fill="white" />
          <circle cx="65" cy="41" r="1.5" fill="white" />
        </>
      ) : (
        <>
          <ellipse cx="38" cy="42" rx="6" ry="5" fill="white" />
          <ellipse cx="62" cy="42" rx="6" ry="5" fill="white" />
          <circle cx="38" cy="43" r="3.5" fill="#1a1a1a" />
          <circle cx="62" cy="43" r="3.5" fill="#1a1a1a" />
          {/* X eyes for dead */}
          {!happy && <>
            <line x1="34" y1="39" x2="42" y2="46" stroke="#ff4444" strokeWidth="2" />
            <line x1="42" y1="39" x2="34" y2="46" stroke="#ff4444" strokeWidth="2" />
            <line x1="58" y1="39" x2="66" y2="46" stroke="#ff4444" strokeWidth="2" />
            <line x1="66" y1="39" x2="58" y2="46" stroke="#ff4444" strokeWidth="2" />
          </>}
        </>
      )}
      {/* Whiskers */}
      <line x1="20" y1="48" x2="38" y2="50" stroke="#8b6914" strokeWidth="1.5" />
      <line x1="20" y1="52" x2="38" y2="52" stroke="#8b6914" strokeWidth="1.5" />
      <line x1="62" y1="50" x2="80" y2="48" stroke="#8b6914" strokeWidth="1.5" />
      <line x1="62" y1="52" x2="80" y2="52" stroke="#8b6914" strokeWidth="1.5" />
      {/* Smile / frown */}
      {happy
        ? <path d="M38 58 Q50 68 62 58" stroke="#8b6914" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        : <path d="M38 64 Q50 56 62 64" stroke="#8b6914" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      }
      {/* Mushroom on loss */}
      {!happy && <circle cx="70" cy="75" r="8" fill="#aa2222" opacity="0.8" />}
      {/* Stars on win */}
      {happy && <>
        <text x="72" y="25" fontSize="14" fill="#FFD700">✦</text>
        <text x="10" y="30" fontSize="10" fill="#FFD700">✦</text>
      </>}
    </svg>
  );

  // ── BG COLOR ─────────────────────────────────────────────────────────────────
  const bgGradient = won
    ? "radial-gradient(ellipse at center, #0a1f0a 0%, #010A13 60%)"
    : "radial-gradient(ellipse at center, #1a0505 0%, #010A13 60%)";

  const accentColor = won ? "#C8AA6E" : "#C8464A";
  const glowColor   = won ? "#C8AA6E44" : "#C8464A33";

  const isReal = bet?.mode === "real";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: bgGradient,
      display: "flex", alignItems: "center", justifyContent: "center",
      overflow: "hidden",
      "--accent-88": accentColor + "88",
      "--accent-44": accentColor + "44",
      "--accent-cc": accentColor + "cc",
      "--accent-33": accentColor + "33",
    }}>
      <style>{`
        @keyframes teemoFall {
          0%   { transform: translateY(-120px) rotate(0deg) scaleX(var(--flip)); opacity: 0; }
          10%  { opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translateY(110vh) rotate(var(--spin)) scaleX(var(--flip)); opacity: 0; }
        }
        @keyframes teemoWalk {
          0%   { transform: translateX(-140px) translateY(0) scaleX(var(--flip)); opacity: 0; }
          5%   { opacity: 1; }
          48%  { transform: translateX(calc(100vw + 100px)) translateY(calc(sin(var(--wobble)) * 15px)) scaleX(var(--flip)); opacity: 1; }
          100% { transform: translateX(calc(100vw + 140px)) scaleX(var(--flip)); opacity: 0; }
        }
        @keyframes teemoBob {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-12px); }
        }
        @keyframes confettiFall {
          0%   { transform: translateY(-30px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(var(--spin)); opacity: 0; }
        }
        @keyframes screenShake {
          0%,100% { transform: translate(0,0) rotate(0); }
          10% { transform: translate(-6px, -4px) rotate(-0.5deg); }
          20% { transform: translate(6px, 4px) rotate(0.5deg); }
          30% { transform: translate(-4px, 6px) rotate(0); }
          40% { transform: translate(4px, -6px) rotate(0.3deg); }
          50% { transform: translate(-6px, 2px) rotate(-0.3deg); }
          60% { transform: translate(4px, -4px) rotate(0); }
          70% { transform: translate(-2px, 6px) rotate(0.5deg); }
        }
        @keyframes revealTitle {
          0%   { transform: scale(3) rotate(-5deg); opacity: 0; filter: blur(20px); }
          60%  { transform: scale(0.95) rotate(1deg); opacity: 1; filter: blur(0); }
          80%  { transform: scale(1.05) rotate(-0.5deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes pulseGlow {
          0%,100% { text-shadow: 0 0 30px var(--accent-88), 0 0 60px var(--accent-44); }
          50%      { text-shadow: 0 0 60px var(--accent-cc), 0 0 120px var(--accent-88), 0 0 200px var(--accent-33); }
        }
        @keyframes shimmerGold {
          0%   { background-position: -300% center; }
          100% { background-position: 300% center; }
        }
        @keyframes slideUp {
          from { transform: translateY(40px); opacity: 0; }
          to   { transform: translateY(0); opacity: 1; }
        }
        @keyframes coinPop {
          0%   { transform: scale(0) rotate(-20deg); opacity: 0; }
          60%  { transform: scale(1.2) rotate(5deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes bgPulse {
          0%,100% { opacity: 0.4; }
          50%      { opacity: 0.8; }
        }
        @keyframes scanline {
          0%   { transform: translateY(-100%); }
          100% { transform: translateY(100vh); }
        }
        @keyframes borderRace {
          0%   { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
      `}</style>

      {/* ── ANIMATED BG RINGS ── */}
      {[1,2,3,4].map(i => (
        <div key={i} style={{
          position: "absolute",
          width: `${i * 280}px`, height: `${i * 280}px`,
          borderRadius: "50%",
          border: `1px solid ${accentColor}${won ? "22" : "15"}`,
          top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          animation: `bgPulse ${1.5 + i * 0.5}s ease-in-out infinite`,
          animationDelay: `${i * 0.2}s`,
          pointerEvents: "none",
        }} />
      ))}

      {/* ── SCANLINE ── */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
        background: `linear-gradient(180deg, transparent 50%, ${accentColor}08 50%)`,
        backgroundSize: "100% 4px",
        opacity: 0.3,
      }} />

      {/* ── TEEMOS ── */}
      {teemos.map(t => (
        <div
          key={t.id}
          onMouseEnter={handleTeemoHover}
          style={{
            position: "absolute",
            left: won ? undefined : `${t.x}%`,
            top: won ? `${20 + (t.id % 4) * 18}%` : undefined,
            zIndex: 2,
            cursor: "pointer",
            "--flip": t.flipped ? -1 : 1,
            "--spin": `${t.spin}deg`,
            "--wobble": `${t.wobble}`,
            animation: won
              ? `teemoWalk ${t.speed}s ${t.delay}s linear infinite`
              : `teemoFall ${t.speed}s ${t.delay}s ease-in forwards`,
            filter: won ? "none" : "grayscale(30%)",
          }}
        >
          <div style={{ animation: won ? `teemoBob ${0.8 + t.wobble * 0.3}s ease-in-out infinite` : "none" }}>
            <TeemoFace happy={t.happy} size={t.size} />
          </div>
        </div>
      ))}

      {/* ── WIN CONFETTI ── */}
      {particles.map(p => (
        <div key={p.id} style={{
          position: "absolute",
          left: `${p.x}%`,
          top: "-20px",
          width: p.shape === "circle" ? p.size : p.size * 0.7,
          height: p.shape === "circle" ? p.size : p.size * 1.2,
          background: p.color,
          borderRadius: p.shape === "circle" ? "50%" : p.shape === "rect" ? "2px" : "0",
          clipPath: p.shape === "star" ? "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)" : "none",
          "--spin": `${p.spin}deg`,
          animation: `confettiFall ${p.duration}s ${p.delay}s linear forwards`,
          pointerEvents: "none",
          zIndex: 2,
          boxShadow: `0 0 4px ${p.color}88`,
        }} />
      ))}

      {/* ── MAIN CARD ── */}
      <div style={{
        position: "relative", zIndex: 10,
        background: won
          ? "linear-gradient(160deg, #0c1a0c 0%, #0A1628 40%, #0d1f0d 100%)"
          : "linear-gradient(160deg, #1a0808 0%, #0A1628 40%, #1a0505 100%)",
        border: `2px solid ${accentColor}`,
        borderRadius: 16,
        padding: "40px 52px",
        maxWidth: 500, width: "90%",
        textAlign: "center",
        boxShadow: `0 0 60px ${glowColor}, 0 0 120px ${glowColor}, inset 0 0 40px ${glowColor}`,
        animation: `screenShake 0.5s ease 0s 1`,
      }}>

        {/* Animated border glow */}
        <div style={{
          position: "absolute", inset: -2, borderRadius: 18, zIndex: -1,
          background: `linear-gradient(90deg, transparent, ${accentColor}, transparent, ${accentColor}, transparent)`,
          backgroundSize: "200% 100%",
          animation: "borderRace 2s linear infinite",
          opacity: 0.6,
        }} />

        {/* ── TITLE ── */}
        {phase !== "intro" && (
          <div style={{
            fontFamily: "Barlow Condensed, sans-serif",
            fontSize: 68, fontWeight: 900, letterSpacing: 8,
            color: won ? "transparent" : "#C8464A",
            background: won ? "linear-gradient(90deg, #785A28, #C8AA6E, #FFD700, #fff, #FFD700, #C8AA6E, #785A28)" : "none",
            backgroundSize: won ? "300% auto" : "auto",
            WebkitBackgroundClip: won ? "text" : "unset",
            WebkitTextFillColor: won ? "transparent" : "#C8464A",
            animation: won
              ? "revealTitle 0.6s cubic-bezier(0.34,1.56,0.64,1), shimmerGold 4s linear infinite, pulseGlow 2s ease-in-out infinite"
              : "revealTitle 0.6s cubic-bezier(0.34,1.56,0.64,1), pulseGlow 2s ease-in-out infinite",
            marginBottom: 4, lineHeight: 1,
            textTransform: "uppercase",
          }}>
            {won ? "VICTORY!" : "DEFEAT"}
          </div>
        )}

        {/* ── SUBTITLE ── */}
        {phase !== "intro" && (
          <div style={{
            fontSize: 13, letterSpacing: 4, color: `${accentColor}aa`,
            fontFamily: "Barlow Condensed, sans-serif", marginBottom: 24,
            animation: "slideUp 0.5s ease 0.3s both",
          }}>
            {won ? "THE ENEMY HAS BEEN SLAIN" : "YOU HAVE BEEN SLAIN"}
          </div>
        )}

        {/* ── DIVIDER ── */}
        <div style={{
          height: 1, margin: "0 auto 24px",
          background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
          animation: "slideUp 0.5s ease 0.4s both",
        }} />

        {/* ── MATCH STATS ── */}
        {result && phase !== "intro" && (
          <div style={{
            background: `${accentColor}0d`,
            border: `1px solid ${accentColor}33`,
            borderRadius: 8, padding: "16px 20px", marginBottom: 20,
            animation: "slideUp 0.5s ease 0.5s both",
          }}>
            <div style={{ color: `${accentColor}88`, fontSize: 10, letterSpacing: 3, marginBottom: 10 }}>MATCH RESULT</div>
            <div style={{
              fontFamily: "Barlow Condensed, sans-serif", fontSize: 22, fontWeight: 700,
              color: accentColor, marginBottom: 14, letterSpacing: 2,
            }}>
              {result.champion?.toUpperCase()}
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              {[
                { label: "KILLS",   val: result.kills,   color: "#0BC4AA" },
                { label: "DEATHS",  val: result.deaths,  color: "#C8464A" },
                { label: "ASSISTS", val: result.assists,  color: "#C8AA6E" },
              ].map((s, i) => (
                <div key={s.label} style={{
                  flex: 1, borderRight: i < 2 ? `1px solid #2D2D32` : "none", padding: "0 12px",
                }}>
                  <div style={{ fontSize: 32, fontWeight: 900, color: s.color, fontFamily: "Barlow Condensed, sans-serif" }}>{s.val}</div>
                  <div style={{ fontSize: 9, letterSpacing: 2, color: "#7A7A82", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── PAYOUT ── */}
        {phase === "payout" && (
          <div style={{
            background: won ? "linear-gradient(135deg, #0d1f0d, #0a2a0a)" : "linear-gradient(135deg, #1f0a0a, #2a0d0d)",
            border: `2px solid ${accentColor}66`,
            borderRadius: 10, padding: "20px 24px", marginBottom: 24,
            animation: "coinPop 0.5s cubic-bezier(0.34,1.56,0.64,1)",
            boxShadow: `0 0 30px ${glowColor}`,
          }}>
            {won ? (
              <>
                <div style={{ color: `${accentColor}99`, fontSize: 10, letterSpacing: 3, marginBottom: 6 }}>
                  {isReal ? "STAKE RETURNED + SKIN CREDITS EARNED" : "GOLD EARNED"}
                </div>
                <div style={{
                  fontFamily: "Barlow Condensed, sans-serif", fontSize: 52, fontWeight: 900,
                  color: "transparent",
                  background: "linear-gradient(90deg, #C8AA6E, #FFD700, #fff, #FFD700, #C8AA6E)",
                  backgroundSize: "200% auto",
                  WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                  animation: "shimmerGold 2s linear infinite",
                  lineHeight: 1,
                }}>
                  {isReal
                    ? `€${Number(bet?.potentialWin || 0).toFixed(2)}`
                    : `$${Number(bet?.potentialWin || 0).toFixed(2)}`
                  }
                </div>
                {isReal && (
                  <div style={{ fontSize: 12, color: "#86efac", marginTop: 6 }}>
                    €{Number(bet?.amount || 0).toFixed(2)} back + {(Number(bet?.potentialWin || 0) - Number(bet?.amount || 0)).toFixed(2)} skin credits
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ color: "#C8464A99", fontSize: 10, letterSpacing: 3, marginBottom: 6 }}>WAGER LOST</div>
                <div style={{
                  fontFamily: "Barlow Condensed, sans-serif", fontSize: 52, fontWeight: 900,
                  color: "#C8464A", lineHeight: 1,
                  animation: "pulseGlow 1.5s ease-in-out infinite",
                }}>
                  {isReal ? `-€${Number(bet?.amount || 0).toFixed(2)}` : `-$${Number(bet?.amount || 0).toFixed(2)}`}
                </div>
                <div style={{ fontSize: 12, color: "#7A7A82", marginTop: 6 }}>
                  Better luck next time, summoner
                </div>
              </>
            )}
          </div>
        )}

        {/* ── CLOSE BUTTON ── */}
        {phase === "payout" && (
          <button onClick={onClose} style={{
            background: won
              ? "linear-gradient(135deg, #C8AA6E, #FFD700, #785A28)"
              : "transparent",
            border: won ? "none" : "1px solid #C8464A66",
            color: won ? "#010A13" : "#C8464A",
            padding: "13px 48px", borderRadius: 4,
            fontFamily: "Barlow Condensed, sans-serif", fontSize: 14, fontWeight: 900,
            cursor: "pointer", letterSpacing: 3, textTransform: "uppercase",
            animation: "slideUp 0.4s ease",
            boxShadow: won ? "0 4px 20px #C8AA6E44" : "none",
            transition: "all 0.2s",
          }}
          onMouseEnter={e => { e.target.style.transform = "scale(1.05)"; playTeemoSqueak(); }}
          onMouseLeave={e => { e.target.style.transform = "scale(1)"; }}
          >
            {won ? "⚔ CLAIM VICTORY" : "↩ TRY AGAIN"}
          </button>
        )}

        <div style={{ color: "#3A3A42", fontSize: 10, marginTop: 16, fontFamily: "DM Sans, sans-serif", letterSpacing: 1 }}>
          AUTO-CLOSE IN 14s · HOVER TEEMOS FOR SOUNDS
        </div>
      </div>
    </div>
  );
}


// ─── DEBUG PANEL (admin only) ────────────────────────────────────────────────
function DebugPanel({ user, setUser, toast, showResult }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [champion, setChampion] = useState("Teemo");
  const [betAmt, setBetAmt] = useState("1.00");
  const [mode, setMode] = useState("real");
  const activeBet = user.bets?.find(b => b.status === "pending");

  // Preview screens without touching the DB — just fires the visual directly
  const previewScreen = (won) => {
    const fakeMatch = {
      matchId: `PREVIEW_${Date.now()}`,
      win: won,
      champion,
      kills:   won ? 12 : 1,
      deaths:  won ? 2  : 9,
      assists: won ? 7  : 3,
      gameEndTimestamp: Date.now(),
    };
    const fakeBet = {
      amount: parseFloat(betAmt) || 1,
      potentialWin: ((parseFloat(betAmt) || 1) * 1.7).toFixed(2),
      mode,
    };
    showResult({ result: fakeMatch, bet: fakeBet });
  };

  // Resolve an actual pending bet (updates DB)
  const simulateReal = async (won) => {
    if (!activeBet) return toast("No active bet to resolve", "error");
    setLoading(true);
    try {
      const fakeMatch = {
        matchId: `DEBUG_${Date.now()}`,
        win: won, champion,
        kills: won ? 12 : 1, deaths: won ? 2 : 9, assists: 5,
        gameEndTimestamp: Date.now(),
      };
      const data = await apiCall("/api/bet", {
        action: "resolveBet", username: user.username,
        won, matchId: fakeMatch.matchId, result: fakeMatch
      });
      setUser(data.user);
      showResult({ result: fakeMatch, bet: activeBet });
    } catch(e) { toast(e.message, "error"); }
    setLoading(false);
  };

  const resetBalance = async () => {
    setLoading(true);
    try {
      const data = await apiCall("/api/debug", { action: "resetBalance", username: user.username });
      setUser(data.user);
      toast("Balance reset to $500", "success");
    } catch(e) { toast(e.message, "error"); }
    setLoading(false);
  };

  const champs = ["Teemo","Jinx","Lux","Yasuo","Thresh","Ahri","Zed","Vi"];

  return (
    <div style={{ position: "fixed", bottom: 80, right: 20, zIndex: 9998 }}>
      {/* Toggle button — subtle, looks like a system widget */}
      <button onClick={() => setOpen(o => !o)} style={{
        background: open ? "#1a1a2e" : "#0d0d14",
        border: `1px solid ${open ? "#C8AA6E55" : "#2a2a35"}`,
        color: open ? "#C8AA6E" : "#444",
        padding: "6px 10px", borderRadius: 4, cursor: "pointer",
        fontFamily: "monospace", fontSize: 10, letterSpacing: 1,
        transition: "all 0.2s",
      }}>⚙ DEV</button>

      {open && (
        <div style={{
          position: "absolute", bottom: 36, right: 0,
          background: "#0d0d14", border: "1px solid #C8AA6E33",
          borderRadius: 8, padding: 18, width: 260,
          display: "flex", flexDirection: "column", gap: 10,
          boxShadow: "0 8px 32px #00000088",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
            <span style={{ color: "#C8AA6E", fontSize: 11, letterSpacing: 2, fontFamily: "Barlow Condensed, sans-serif", fontWeight: 700 }}>DEV TOOLS</span>
            <span style={{ color: "#333", fontSize: 10, fontFamily: "monospace" }}>only you see this</span>
          </div>

          {/* Champion picker */}
          <div>
            <div style={{ color: "#555", fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>CHAMPION</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {champs.map(c => (
                <button key={c} onClick={() => setChampion(c)} style={{
                  background: champion === c ? "#C8AA6E22" : "#1a1a1e",
                  border: `1px solid ${champion === c ? "#C8AA6E" : "#2a2a2e"}`,
                  color: champion === c ? "#C8AA6E" : "#666",
                  padding: "3px 7px", borderRadius: 3, cursor: "pointer",
                  fontFamily: "monospace", fontSize: 10,
                }}>{c}</button>
              ))}
            </div>
          </div>

          {/* Bet amount + mode for preview */}
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#555", fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>BET AMT</div>
              <input
                value={betAmt} onChange={e => setBetAmt(e.target.value)}
                style={{
                  width: "100%", background: "#1a1a1e", border: "1px solid #2a2a2e",
                  color: "#C8AA6E", padding: "5px 8px", borderRadius: 3,
                  fontFamily: "monospace", fontSize: 12, boxSizing: "border-box"
                }}
              />
            </div>
            <div>
              <div style={{ color: "#555", fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>MODE</div>
              <select value={mode} onChange={e => setMode(e.target.value)} style={{
                background: "#1a1a1e", border: "1px solid #2a2a2e", color: "#aaa",
                padding: "5px 6px", borderRadius: 3, fontFamily: "monospace", fontSize: 11,
              }}>
                <option value="real">real</option>
                <option value="virtual">virtual</option>
              </select>
            </div>
          </div>

          {/* PREVIEW — no DB touch */}
          <div>
            <div style={{ color: "#555", fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>PREVIEW SCREEN (no DB)</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => previewScreen(true)} style={{
                flex: 1, background: "#0BC4AA18", border: "1px solid #0BC4AA44", color: "#0BC4AA",
                padding: "8px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 12, fontWeight: 700,
              }}>🏆 WIN</button>
              <button onClick={() => previewScreen(false)} style={{
                flex: 1, background: "#C8464A18", border: "1px solid #C8464A44", color: "#C8464A",
                padding: "8px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 12, fontWeight: 700,
              }}>💀 LOSS</button>
            </div>
          </div>

          <div style={{ height: 1, background: "#2a2a2e" }} />

          {/* RESOLVE — touches DB, needs active bet */}
          <div>
            <div style={{ color: "#555", fontSize: 10, letterSpacing: 1, marginBottom: 4 }}>
              RESOLVE REAL BET {activeBet ? <span style={{ color: "#4ade80" }}>({activeBet.mode} €{activeBet.amount})</span> : <span style={{ color: "#444" }}>(no active bet)</span>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => simulateReal(true)} disabled={loading || !activeBet} style={{
                flex: 1, background: activeBet ? "#0BC4AA12" : "#111", border: `1px solid ${activeBet ? "#0BC4AA33" : "#222"}`,
                color: activeBet ? "#0BC4AA" : "#333",
                padding: "7px", borderRadius: 4, cursor: activeBet ? "pointer" : "not-allowed", fontFamily: "monospace", fontSize: 11,
              }}>✓ Force WIN</button>
              <button onClick={() => simulateReal(false)} disabled={loading || !activeBet} style={{
                flex: 1, background: activeBet ? "#C8464A12" : "#111", border: `1px solid ${activeBet ? "#C8464A33" : "#222"}`,
                color: activeBet ? "#C8464A" : "#333",
                padding: "7px", borderRadius: 4, cursor: activeBet ? "pointer" : "not-allowed", fontFamily: "monospace", fontSize: 11,
              }}>✗ Force LOSS</button>
            </div>
          </div>

          <div style={{ height: 1, background: "#2a2a2e" }} />

          <button onClick={resetBalance} disabled={loading} style={{
            background: "#C8AA6E12", border: "1px solid #C8AA6E33", color: "#C8AA6E88",
            padding: "7px", borderRadius: 4, cursor: "pointer", fontFamily: "monospace", fontSize: 11,
          }}>↺ Reset virtual balance $500</button>
        </div>
      )}
    </div>
  );
}


// ─── ADMIN PANEL ─────────────────────────────────────────────────────────────
function AdminPanel({ adminToken, onLogout }) {
  const [tab, setTab] = useState("players");
  const [players, setPlayers] = useState([]);
  const [redemptions, setRedemptions] = useState([]);
  const [financials, setFinancials] = useState(null);
  const [activity, setActivity] = useState([]);
  const [pendingBets, setPendingBets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState("");
  const [expandedPlayer, setExpandedPlayer] = useState(null);
  const [playerDetail, setPlayerDetail] = useState({});
  const [adjustField, setAdjustField] = useState("Virtual Gold");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [noteText, setNoteText] = useState("");
  const [detailTab, setDetailTab] = useState("bets");

  const showToast = (msg, type = "info") => setToast({ message: msg, type, id: Date.now() });

  const adminCall = async (action, extra = {}) => {
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, adminToken, ...extra })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Admin request failed");
    return data;
  };

  const loadTab = async (t) => {
    setLoading(true);
    try {
      if (t === "players") { const d = await adminCall("getPlayers"); setPlayers(d.players); }
      else if (t === "redemptions") { const d = await adminCall("getRedemptions"); setRedemptions(d.redemptions); }
      else if (t === "financials") { const d = await adminCall("getFinancials"); setFinancials(d); }
      else if (t === "activity") { const d = await adminCall("getActivity"); setActivity(d.activity); }
      else if (t === "pending") { const d = await adminCall("getPendingBets"); setPendingBets(d.bets); }
    } catch(e) { showToast(e.message, "error"); }
    setLoading(false);
  };

  useEffect(() => { loadTab(tab); }, [tab]);

  const loadPlayerDetail = async (username) => {
    if (playerDetail[username]) return; // cached
    try {
      const d = await adminCall("getPlayerDetail", { username });
      setPlayerDetail(prev => ({ ...prev, [username]: d }));
    } catch(e) { showToast(e.message, "error"); }
  };

  const toggleExpand = async (username) => {
    if (expandedPlayer === username) { setExpandedPlayer(null); return; }
    setExpandedPlayer(username);
    setDetailTab("bets");
    const p = players.find(x => x.username === username);
    setNoteText(p?.adminNote || "");
    await loadPlayerDetail(username);
  };

  const fulfillRedemption = async (id) => {
    try {
      await adminCall("fulfillRedemption", { redemptionId: id });
      setRedemptions(prev => prev.map(r => r.id === id ? { ...r, status: "fulfilled" } : r));
      showToast("✅ Marked as sent!", "success");
    } catch(e) { showToast(e.message, "error"); }
  };

  const cancelBet = async (username) => {
    try {
      await adminCall("cancelPendingBet", { username });
      setPlayers(prev => prev.map(p => p.username === username ? { ...p, bets: { ...p.bets, pending: 0 } } : p));
      setPendingBets(prev => prev.filter(b => b.username !== username));
      showToast(`✅ Bet cancelled & refunded to ${username}`, "success");
    } catch(e) { showToast(e.message, "error"); }
  };

  const resetGold = async (username) => {
    try {
      await adminCall("resetVirtualBalance", { username });
      setPlayers(prev => prev.map(p => p.username === username ? { ...p, balance: 500 } : p));
      showToast(`✅ ${username}'s virtual gold reset to $500`, "success");
    } catch(e) { showToast(e.message, "error"); }
  };

  const adjustBalance = async (username) => {
    const amt = parseFloat(adjustAmount);
    if (isNaN(amt)) return showToast("Enter a valid number (negative to deduct)", "error");
    const fieldMap = { "Virtual Gold": "balance", "Real Balance": "real_balance", "Skin Credits": "skin_credits" };
    const field = fieldMap[adjustField];
    if (!field) return showToast("Select a valid wallet type", "error");
    try {
      const result = await adminCall("adjustBalance", { username, field, amount: amt });
      setPlayers(prev => prev.map(p => {
        if (p.username !== username) return p;
        return {
          ...p,
          balance: Number(result.updated.balance),
          realBalance: Number(result.updated.real_balance),
          skinCredits: Number(result.updated.skin_credits),
        };
      }));
      showToast(`✅ ${amt >= 0 ? "Added" : "Deducted"} $${Math.abs(amt).toFixed(2)} ${adjustField} for ${username}`, "success");
      setAdjustAmount("");
    } catch(e) { showToast(e.message, "error"); }
  };

  const saveNote = async (username) => {
    try {
      await adminCall("saveNote", { username, note: noteText });
      setPlayers(prev => prev.map(p => p.username === username ? { ...p, adminNote: noteText } : p));
      showToast("✅ Note saved", "success");
    } catch(e) { showToast(e.message, "error"); }
  };

  const fmt = (n) => `$${Number(n || 0).toFixed(2)}`;
  const timeAgo = (ts) => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };
  const fmtDate = (ts) => new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  const filteredPlayers = players.filter(p =>
    !search ||
    p.username.toLowerCase().includes(search.toLowerCase()) ||
    (p.lolAccount || "").toLowerCase().includes(search.toLowerCase())
  );

  const TABS = [
    { id: "players", label: "👥 Players" },
    { id: "pending", label: "⏳ Pending Bets" + (pendingBets.length ? ` (${pendingBets.length})` : "") },
    { id: "redemptions", label: "💜 Redemptions" },
    { id: "financials", label: "💰 Financials" },
    { id: "activity", label: "📋 Activity" },
  ];

  const S = {
    page: { minHeight: "100vh", background: "#0d0d10", fontFamily: "DM Sans, sans-serif", color: "#E0E0E0" },
    topbar: { background: "#141416", borderBottom: "1px solid #2D2D32", padding: "0 28px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" },
    card: { background: "#1A1A1E", border: "1px solid #2D2D32", borderRadius: 8, padding: 20 },
    th: { fontSize: 11, letterSpacing: 1, color: "#7A7A82", textTransform: "uppercase", padding: "10px 14px", textAlign: "left", borderBottom: "1px solid #2A2A2E", whiteSpace: "nowrap", background: "#141416" },
    td: { padding: "13px 14px", borderBottom: "1px solid #1E1E22", fontSize: 14, verticalAlign: "middle" },
    btn: (color = "#C8AA6E") => ({ background: "none", border: `1px solid ${color}55`, color, padding: "7px 14px", borderRadius: 4, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "DM Sans, sans-serif", transition: "all 0.15s" }),
    btnSolid: (bg = "#4ade80", fg = "#0d0d10") => ({ background: bg, border: "none", color: fg, padding: "8px 16px", borderRadius: 4, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "DM Sans, sans-serif" }),
    label: { fontSize: 11, letterSpacing: 2, color: "#7A7A82", fontWeight: 700, textTransform: "uppercase", marginBottom: 8 },
    sectionTitle: { fontSize: 20, fontWeight: 700, color: "#F0F0F0", marginBottom: 16 },
  };

  return (
    <div style={S.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;900&family=DM+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: #141416; }
        ::-webkit-scrollbar-thumb { background: #35353A; border-radius: 3px; }
        tr:hover > td { background: #1E1E24 !important; }
      `}</style>

      {/* Top bar */}
      <div style={S.topbar}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 10, letterSpacing: 4, color: "#C8AA6E", fontWeight: 700 }}>RUNETERRA WAGERS</span>
          <div style={{ width: 1, height: 20, background: "#2D2D32" }} />
          <span style={{ fontSize: 16, fontWeight: 700, color: "#F0F0F0" }}>Admin Panel</span>
          <span style={{ background: "#C8AA6E22", border: "1px solid #C8AA6E55", color: "#C8AA6E", fontSize: 11, padding: "2px 10px", borderRadius: 10, fontWeight: 700, letterSpacing: 1 }}>ADMIN</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => loadTab(tab)} style={S.btn()}>↻ Refresh</button>
          <button onClick={onLogout} style={S.btn("#C8464A")}>Logout</button>
        </div>
      </div>

      {/* Nav */}
      <div style={{ background: "#141416", borderBottom: "1px solid #2D2D32", padding: "0 28px", display: "flex", gap: 2 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: "none", border: "none", cursor: "pointer", padding: "13px 18px",
            fontSize: 14, fontWeight: 600, fontFamily: "DM Sans, sans-serif",
            color: tab === t.id ? "#C8AA6E" : "#7A7A82",
            borderBottom: `2px solid ${tab === t.id ? "#C8AA6E" : "transparent"}`,
            transition: "all 0.15s",
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ padding: 28, maxWidth: 1600 }}>
        {loading && (
          <div style={{ textAlign: "center", padding: 80, color: "#7A7A82", fontSize: 16 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
            Loading...
          </div>
        )}

        {/* ══ PLAYERS TAB ════════════════════════════════════════════════════ */}
        {!loading && tab === "players" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <div style={S.sectionTitle}>
                All Players <span style={{ color: "#7A7A82", fontSize: 15, fontWeight: 400 }}>({filteredPlayers.length}{search ? ` of ${players.length}` : ""})</span>
              </div>
              <input
                placeholder="Search by username or LoL account..."
                value={search} onChange={e => setSearch(e.target.value)}
                style={{ background: "#1A1A1E", border: "1px solid #35353A", color: "#E0E0E0", padding: "9px 14px", borderRadius: 6, fontSize: 14, width: 300, fontFamily: "DM Sans, sans-serif" }}
              />
            </div>

            <div style={{ background: "#1A1A1E", border: "1px solid #2D2D32", borderRadius: 8, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Username", "LoL Account", "Rank", "Email", "🎮 Virtual", "💵 Real", "💜 Credits", "Deposited", "Bets", "W/L", "Pending", "Joined", "Note", ""].map(h => (
                        <th key={h} style={S.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPlayers.map(p => (
                      <>
                        <tr key={p.username}>
                          <td style={S.td}><span style={{ color: "#F0F0F0", fontWeight: 700 }}>{p.username}</span></td>
                          <td style={S.td}><span style={{ color: p.lolAccount ? "#C8AA6E" : "#35353A", fontSize: 13 }}>{p.lolAccount || "—"}</span></td>
                          <td style={S.td}><span style={{ color: "#A0A0A8", fontSize: 13 }}>{p.rank || "—"}</span></td>
                          <td style={S.td}><span style={{ color: p.email ? "#86efac" : "#35353A", fontSize: 12 }}>{p.email || "—"}</span></td>
                          <td style={S.td}><span style={{ color: "#C8AA6E", fontWeight: 700 }}>{fmt(p.balance)}</span></td>
                          <td style={S.td}><span style={{ color: "#4ade80", fontWeight: 700 }}>{fmt(p.realBalance)}</span></td>
                          <td style={S.td}><span style={{ color: "#a78bfa", fontWeight: 700 }}>{fmt(p.skinCredits)}</span></td>
                          <td style={S.td}>
                            <div style={{ color: "#E0E0E0", fontWeight: 600 }}>{fmt(p.deposit.total)}</div>
                            <div style={{ color: "#7A7A82", fontSize: 12 }}>{p.deposit.count} tx</div>
                          </td>
                          <td style={S.td}><span style={{ color: "#A0A0A8" }}>{p.bets.total}</span></td>
                          <td style={S.td}>
                            <span style={{ color: "#3FB950" }}>{p.bets.wins}W</span>
                            <span style={{ color: "#35353A", margin: "0 3px" }}>/</span>
                            <span style={{ color: "#F85149" }}>{p.bets.losses}L</span>
                            {p.bets.total > 0 && <span style={{ color: "#7A7A82", fontSize: 12, marginLeft: 6 }}>({Math.round(p.bets.wins / p.bets.total * 100)}%)</span>}
                          </td>
                          <td style={S.td}>
                            {p.bets.pending > 0
                              ? <span style={{ color: "#C8AA6E", fontWeight: 700 }}>● {p.bets.pending}</span>
                              : <span style={{ color: "#35353A" }}>—</span>}
                          </td>
                          <td style={S.td}><span style={{ color: "#7A7A82", fontSize: 13 }}>{timeAgo(p.createdAt)}</span></td>
                          <td style={S.td}>
                            {p.adminNote
                              ? <span style={{ color: "#C8AA6E", fontSize: 12, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }} title={p.adminNote}>📝 {p.adminNote}</span>
                              : <span style={{ color: "#35353A", fontSize: 12 }}>—</span>}
                          </td>
                          <td style={S.td}>
                            <button onClick={() => toggleExpand(p.username)} style={S.btn()}>
                              {expandedPlayer === p.username ? "▲ Close" : "▼ Manage"}
                            </button>
                          </td>
                        </tr>

                        {/* ── EXPANDED PLAYER ROW ── */}
                        {expandedPlayer === p.username && (
                          <tr key={`${p.username}_exp`}>
                            <td colSpan={13} style={{ padding: 0, background: "#111114", borderBottom: "2px solid #C8AA6E33" }}>
                              <div style={{ padding: 24 }}>

                                {/* Actions row */}
                                <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 24 }}>

                                  {/* Quick actions */}
                                  <div style={{ minWidth: 200 }}>
                                    <div style={S.label}>Quick Actions</div>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                      <button onClick={() => resetGold(p.username)} style={S.btn("#C8AA6E")}>↺ Reset Virtual Gold → $500</button>
                                      {p.bets.pending > 0 && (
                                        <button onClick={() => cancelBet(p.username)} style={S.btn("#C8464A")}>✕ Cancel Pending Bet & Refund</button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Adjust balance */}
                                  <div style={{ minWidth: 320 }}>
                                    <div style={S.label}>Adjust Balance</div>
                                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                      <select value={adjustField} onChange={e => setAdjustField(e.target.value)} style={{ background: "#1A1A1E", border: "1px solid #35353A", color: "#E0E0E0", padding: "9px 12px", borderRadius: 4, fontFamily: "DM Sans, sans-serif", fontSize: 13 }}>
                                        <option>Virtual Gold</option>
                                        <option>Real Balance</option>
                                        <option>Skin Credits</option>
                                      </select>
                                      <input
                                        type="number" step="0.01" placeholder="Amount (neg = deduct)"
                                        value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)}
                                        style={{ background: "#1A1A1E", border: "1px solid #35353A", color: "#E0E0E0", padding: "9px 12px", borderRadius: 4, fontFamily: "DM Sans, sans-serif", fontSize: 13, width: 170 }}
                                      />
                                      <button onClick={() => adjustBalance(p.username)} style={S.btnSolid("#4ade80")}>Apply</button>
                                    </div>
                                    <div style={{ color: "#7A7A82", fontSize: 12, marginTop: 6 }}>Use negative to deduct. E.g. −5 removes $5.00.</div>
                                  </div>

                                  {/* Admin note */}
                                  <div style={{ flex: 1, minWidth: 260 }}>
                                    <div style={S.label}>Admin Note</div>
                                    <div style={{ display: "flex", gap: 8 }}>
                                      <input
                                        value={noteText} onChange={e => setNoteText(e.target.value)}
                                        placeholder="Private note about this player..."
                                        style={{ flex: 1, background: "#1A1A1E", border: "1px solid #35353A", color: "#E0E0E0", padding: "9px 12px", borderRadius: 4, fontFamily: "DM Sans, sans-serif", fontSize: 13 }}
                                      />
                                      <button onClick={() => saveNote(p.username)} style={S.btnSolid("#C8AA6E", "#0d0d10")}>Save</button>
                                    </div>
                                  </div>
                                </div>

                                {/* Detail sub-tabs */}
                                <div style={{ display: "flex", gap: 2, borderBottom: "1px solid #2D2D32", marginBottom: 16 }}>
                                  {[
                                    { id: "bets", label: `Bet History (${playerDetail[p.username]?.bets?.length || 0})` },
                                    { id: "deposits", label: `Deposits (${playerDetail[p.username]?.deposits?.length || 0})` },
                                    { id: "redemptions", label: `Redemptions (${playerDetail[p.username]?.redemptions?.length || 0})` },
                                  ].map(dt => (
                                    <button key={dt.id} onClick={() => setDetailTab(dt.id)} style={{
                                      background: "none", border: "none", cursor: "pointer",
                                      padding: "8px 16px", fontSize: 13, fontWeight: 600,
                                      fontFamily: "DM Sans, sans-serif",
                                      color: detailTab === dt.id ? "#C8AA6E" : "#7A7A82",
                                      borderBottom: `2px solid ${detailTab === dt.id ? "#C8AA6E" : "transparent"}`,
                                    }}>{dt.label}</button>
                                  ))}
                                </div>

                                {/* Bet history */}
                                {detailTab === "bets" && (
                                  <div style={{ overflowX: "auto" }}>
                                    {!playerDetail[p.username] ? (
                                      <div style={{ color: "#7A7A82", fontSize: 14, padding: "12px 0" }}>Loading...</div>
                                    ) : playerDetail[p.username].bets.length === 0 ? (
                                      <div style={{ color: "#7A7A82", fontSize: 14, fontStyle: "italic" }}>No bets yet.</div>
                                    ) : (
                                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                        <thead><tr>
                                          {["Date", "Mode", "Amount", "Odds", "Potential Win", "Status", "Champion", "K/D/A"].map(h => <th key={h} style={{ ...S.th, background: "#0d0d10" }}>{h}</th>)}
                                        </tr></thead>
                                        <tbody>
                                          {playerDetail[p.username].bets.map(b => (
                                            <tr key={b.id}>
                                              <td style={S.td}><span style={{ color: "#7A7A82", fontSize: 12 }}>{fmtDate(b.placedAt)}</span></td>
                                              <td style={S.td}><span style={{ fontSize: 12, color: b.mode === "real" ? "#4ade80" : "#C8AA6E", border: `1px solid ${b.mode === "real" ? "#4ade8044" : "#C8AA6E44"}`, padding: "2px 7px", borderRadius: 3 }}>{b.mode?.toUpperCase()}</span></td>
                                              <td style={S.td}><span style={{ color: "#F0F0F0", fontWeight: 600 }}>{fmt(b.amount)}</span></td>
                                              <td style={S.td}><span style={{ color: "#A0A0A8" }}>{Number(b.odds).toFixed(2)}x</span></td>
                                              <td style={S.td}><span style={{ color: "#0BC4AA" }}>{fmt(b.potentialWin)}</span></td>
                                              <td style={S.td}>
                                                <span style={{ fontSize: 12, fontWeight: 700, color: b.status === "won" ? "#3FB950" : b.status === "lost" ? "#F85149" : b.status === "cancelled" ? "#7A7A82" : "#C8AA6E", border: `1px solid currentColor`, padding: "2px 8px", borderRadius: 3 }}>
                                                  {b.status.toUpperCase()}
                                                </span>
                                              </td>
                                              <td style={S.td}><span style={{ color: "#A0A0A8", fontSize: 13 }}>{b.result?.champion || "—"}</span></td>
                                              <td style={S.td}><span style={{ color: "#A0A0A8", fontSize: 13 }}>{b.result ? `${b.result.kills}/${b.result.deaths}/${b.result.assists}` : "—"}</span></td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>
                                )}

                                {/* Deposit history */}
                                {detailTab === "deposits" && (
                                  <div>
                                    {!playerDetail[p.username] ? (
                                      <div style={{ color: "#7A7A82", fontSize: 14 }}>Loading...</div>
                                    ) : playerDetail[p.username].deposits.length === 0 ? (
                                      <div style={{ color: "#7A7A82", fontSize: 14, fontStyle: "italic" }}>No deposits yet.</div>
                                    ) : (
                                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                        <thead><tr>
                                          {["Date", "Amount", "Status"].map(h => <th key={h} style={{ ...S.th, background: "#0d0d10" }}>{h}</th>)}
                                        </tr></thead>
                                        <tbody>
                                          {playerDetail[p.username].deposits.map(d => (
                                            <tr key={d.id}>
                                              <td style={S.td}><span style={{ color: "#7A7A82", fontSize: 13 }}>{fmtDate(d.createdAt)}</span></td>
                                              <td style={S.td}><span style={{ color: "#4ade80", fontWeight: 700, fontSize: 15 }}>{fmt(d.amount)}</span></td>
                                              <td style={S.td}><span style={{ color: "#3FB950", fontSize: 12, border: "1px solid #3FB95044", padding: "2px 8px", borderRadius: 3 }}>✓ {d.status}</span></td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>
                                )}

                                {/* Redemption history */}
                                {detailTab === "redemptions" && (
                                  <div>
                                    {!playerDetail[p.username] ? (
                                      <div style={{ color: "#7A7A82", fontSize: 14 }}>Loading...</div>
                                    ) : playerDetail[p.username].redemptions.length === 0 ? (
                                      <div style={{ color: "#7A7A82", fontSize: 14, fontStyle: "italic" }}>No redemptions yet.</div>
                                    ) : (
                                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                        <thead><tr>
                                          {["Date", "Card", "Credits Used", "Real $ Used", "Status"].map(h => <th key={h} style={{ ...S.th, background: "#0d0d10" }}>{h}</th>)}
                                        </tr></thead>
                                        <tbody>
                                          {playerDetail[p.username].redemptions.map(r => (
                                            <tr key={r.id}>
                                              <td style={S.td}><span style={{ color: "#7A7A82", fontSize: 13 }}>{fmtDate(r.createdAt)}</span></td>
                                              <td style={S.td}><span style={{ color: "#a78bfa", fontWeight: 600 }}>{r.skinName}</span></td>
                                              <td style={S.td}><span style={{ color: "#a78bfa" }}>{fmt(r.creditCost)}</span></td>
                                              <td style={S.td}><span style={{ color: "#4ade80" }}>{fmt(r.realCost)}</span></td>
                                              <td style={S.td}><span style={{ color: r.status === "fulfilled" ? "#3FB950" : "#C8AA6E", fontSize: 12, border: "1px solid currentColor", padding: "2px 8px", borderRadius: 3 }}>{r.status === "fulfilled" ? "✓ SENT" : "⏳ PENDING"}</span></td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                    {filteredPlayers.length === 0 && (
                      <tr><td colSpan={13} style={{ ...S.td, textAlign: "center", color: "#7A7A82", padding: 40 }}>No players found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ══ PENDING BETS TAB ═══════════════════════════════════════════════ */}
        {!loading && tab === "pending" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={S.sectionTitle}>
              Pending Bets <span style={{ color: "#C8AA6E", fontSize: 15, fontWeight: 400 }}>({pendingBets.length} active across all players)</span>
            </div>
            {pendingBets.length === 0 ? (
              <div style={{ ...S.card, textAlign: "center", color: "#7A7A82", padding: 48, fontSize: 15 }}>No pending bets right now 🎉</div>
            ) : (
              <div style={{ background: "#1A1A1E", border: "1px solid #C8AA6E33", borderRadius: 8, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr>
                    {["Placed", "Player", "LoL Account", "Rank", "Mode", "Amount", "Odds", "Potential Win", "Action"].map(h => <th key={h} style={S.th}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {pendingBets.map(b => (
                      <tr key={b.id}>
                        <td style={S.td}><span style={{ color: "#7A7A82", fontSize: 13 }}>{timeAgo(b.placedAt)}</span></td>
                        <td style={S.td}><span style={{ color: "#F0F0F0", fontWeight: 700 }}>{b.username}</span></td>
                        <td style={S.td}><span style={{ color: "#C8AA6E" }}>{b.lolAccount || "—"}</span></td>
                        <td style={S.td}><span style={{ color: "#A0A0A8", fontSize: 13 }}>{b.rank || "—"}</span></td>
                        <td style={S.td}><span style={{ fontSize: 12, color: b.mode === "real" ? "#4ade80" : "#C8AA6E", border: `1px solid ${b.mode === "real" ? "#4ade8044" : "#C8AA6E44"}`, padding: "2px 8px", borderRadius: 3 }}>{b.mode?.toUpperCase()}</span></td>
                        <td style={S.td}><span style={{ color: "#F0F0F0", fontWeight: 700, fontSize: 15 }}>{fmt(b.amount)}</span></td>
                        <td style={S.td}><span style={{ color: "#A0A0A8" }}>{Number(b.odds).toFixed(2)}x</span></td>
                        <td style={S.td}><span style={{ color: "#0BC4AA", fontWeight: 700 }}>{fmt(b.potentialWin)}</span></td>
                        <td style={S.td}><button onClick={() => cancelBet(b.username)} style={S.btn("#C8464A")}>✕ Cancel & Refund</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ══ REDEMPTIONS TAB ════════════════════════════════════════════════ */}
        {!loading && tab === "redemptions" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={S.sectionTitle}>
              Redemptions
              <span style={{ marginLeft: 12, color: "#a78bfa", fontSize: 15, fontWeight: 400 }}>
                {redemptions.filter(r => r.status === "pending").length} pending
              </span>
            </div>
            {["pending", "fulfilled"].map(statusFilter => {
              const filtered = redemptions.filter(r => r.status === statusFilter);
              if (!filtered.length) return (
                <div key={statusFilter} style={{ ...S.card, textAlign: "center", color: "#7A7A82", padding: 32, fontSize: 14 }}>
                  {statusFilter === "pending" ? "No pending redemptions 🎉" : null}
                </div>
              );
              return (
                <div key={statusFilter}>
                  <div style={{ fontSize: 13, letterSpacing: 2, color: statusFilter === "pending" ? "#a78bfa" : "#4ade80", fontWeight: 700, marginBottom: 10 }}>
                    {statusFilter === "pending" ? "⏳ PENDING — Action needed" : "✓ FULFILLED"}
                  </div>
                  <div style={{ background: "#1A1A1E", border: `1px solid ${statusFilter === "pending" ? "#a78bfa44" : "#4ade8022"}`, borderRadius: 8, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead><tr>
                        {["Time", "Player", "Gift to this LoL account ↓", "RP Card", "Credits Used", "Real $ Used", "Total", statusFilter === "pending" ? "Action" : ""].map(h => <th key={h} style={S.th}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {filtered.map(r => (
                          <tr key={r.id}>
                            <td style={S.td}><span style={{ color: "#7A7A82", fontSize: 13 }}>{timeAgo(r.createdAt)}</span></td>
                            <td style={S.td}><span style={{ color: "#F0F0F0", fontWeight: 700 }}>{r.username}</span></td>
                            <td style={S.td}>
                              <span style={{ color: "#C8AA6E", fontWeight: 700, fontSize: 15 }}>
                                {r.lolAccount || <span style={{ color: "#C8464A" }}>⚠️ No LoL account!</span>}
                              </span>
                            </td>
                            <td style={S.td}><span style={{ color: "#a78bfa", fontWeight: 700 }}>{r.skinName}</span></td>
                            <td style={S.td}><span style={{ color: "#a78bfa" }}>{fmt(r.creditCost)}</span></td>
                            <td style={S.td}><span style={{ color: "#4ade80" }}>{fmt(r.realCost)}</span></td>
                            <td style={S.td}><span style={{ color: "#F0F0F0", fontWeight: 700 }}>{fmt(r.creditCost + r.realCost)}</span></td>
                            <td style={S.td}>
                              {statusFilter === "pending"
                                ? <button onClick={() => fulfillRedemption(r.id)} style={S.btnSolid("#4ade80")}>✓ Mark as Sent</button>
                                : <span style={{ color: "#4ade80", fontSize: 13, fontWeight: 600 }}>✓ Sent</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ══ FINANCIALS TAB ═════════════════════════════════════════════════ */}
        {!loading && tab === "financials" && financials && financials.real && financials.virtual && (
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>

            {/* ══════════════════════════════════════════════════════════════
                PANEL 1 — REAL MONEY  (green border, what matters)
            ══════════════════════════════════════════════════════════════ */}
            <div style={{ border: "2px solid #4ade8055", borderRadius: 10, overflow: "hidden" }}>

              {/* Panel header */}
              <div style={{ background: "linear-gradient(135deg, #0a2010, #0d280d)", padding: "14px 20px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #4ade8033" }}>
                <span style={{ fontSize: 20 }}>💵</span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#4ade80", letterSpacing: 2, fontFamily: "Barlow Condensed, sans-serif" }}>REAL MONEY — EUR</div>
                  <div style={{ fontSize: 12, color: "#86efac", marginTop: 2 }}>This is actual money. These numbers affect your bank account.</div>
                </div>
              </div>

              <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>

                {/* Cash flow row */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                  {[
                    { label: "Total Deposited", val: `€${financials.totalDeposited.toFixed(2)}`, color: "#4ade80", sub: `${financials.totalDeposits} PayPal payments`, icon: "↓" },
                    { label: "Real Balance Owed", val: `€${financials.totalRealOwed.toFixed(2)}`, color: "#f87171", sub: "In player wallets right now", icon: "−" },
                    { label: "RP Cards Sent", val: `€${financials.totalFulfilled.toFixed(2)}`, color: "#f87171", sub: `${financials.totalRedemptionsFulfilled} redemptions fulfilled`, icon: "−" },
                    { label: "RP Cards Pending", val: `€${financials.totalPendingRedeem.toFixed(2)}`, color: "#fb923c", sub: `${financials.totalRedemptionsPending} not yet sent`, icon: "−" },
                  ].map(({ label, val, color, sub, icon }) => (
                    <div key={label} style={{ background: "#0a1a0a", border: "1px solid #4ade8022", borderRadius: 8, padding: "14px 16px" }}>
                      <div style={{ fontSize: 11, letterSpacing: 2, color: "#7A7A82", marginBottom: 6 }}>{label}</div>
                      <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "Barlow Condensed, sans-serif", color }}>{val}</div>
                      <div style={{ fontSize: 11, color: "#6A6A72", marginTop: 4 }}>{sub}</div>
                    </div>
                  ))}
                </div>

                {/* Net margin — big prominent number */}
                <div style={{ background: financials.netMargin >= 0 ? "#0a1f0a" : "#1f0a0a", border: `2px solid ${financials.netMargin >= 0 ? "#4ade8066" : "#f8717166"}`, borderRadius: 8, padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 11, letterSpacing: 2, color: "#7A7A82", marginBottom: 4 }}>NET MARGIN (what you actually keep)</div>
                    <div style={{ fontSize: 12, color: "#7A7A82" }}>
                      Deposited €{financials.totalDeposited.toFixed(2)} − owed €{financials.totalRealOwed.toFixed(2)} − sent RP €{financials.totalFulfilled.toFixed(2)} − pending RP €{financials.totalPendingRedeem.toFixed(2)}
                    </div>
                  </div>
                  <div style={{ fontSize: 42, fontWeight: 900, fontFamily: "Barlow Condensed, sans-serif", color: financials.netMargin >= 0 ? "#4ade80" : "#f87171", marginLeft: 20, flexShrink: 0 }}>
                    {financials.netMargin >= 0 ? "+" : ""}€{financials.netMargin.toFixed(2)}
                  </div>
                </div>

                {/* Real bet stats */}
                <div>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "#4ade8088", marginBottom: 10 }}>REAL BET STATS</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
                    {[
                      { label: "Real Bets Placed", val: financials.real.totalBets, color: "#F0F0F0" },
                      { label: "Player Wins", val: financials.real.wins, color: "#f87171", sub: "You pay credits" },
                      { label: "Player Losses", val: financials.real.losses, color: "#4ade80", sub: "You keep stake" },
                      { label: "€ Wagered", val: `€${financials.real.wagered.toFixed(2)}`, color: "#F0F0F0" },
                      { label: "Player Win Rate", val: `${financials.real.winRate}%`, color: financials.real.winRate > 55 ? "#f87171" : "#4ade80", sub: financials.real.winRate > 55 ? "⚠️ High — check edge" : "✓ Healthy" },
                    ].map(({ label, val, color, sub }) => (
                      <div key={label} style={{ background: "#0a1a0a", border: "1px solid #4ade8015", borderRadius: 6, padding: "10px 12px", textAlign: "center" }}>
                        <div style={{ fontSize: 10, letterSpacing: 1, color: "#6A6A72", marginBottom: 4 }}>{label}</div>
                        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "Barlow Condensed, sans-serif", color }}>{val}</div>
                        {sub && <div style={{ fontSize: 10, color: "#6A6A72", marginTop: 3 }}>{sub}</div>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pending real bets */}
                {financials.pendingRealAtStake > 0 && (
                  <div style={{ background: "#1a1200", border: "1px solid #fb923c44", borderRadius: 6, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13, color: "#fb923c" }}>⏳ {financials.pendingBetsCount} real bet{financials.pendingBetsCount > 1 ? "s" : ""} currently in progress</span>
                    <span style={{ fontSize: 18, fontWeight: 700, fontFamily: "Barlow Condensed, sans-serif", color: "#fb923c" }}>€{financials.pendingRealAtStake.toFixed(2)} at stake</span>
                  </div>
                )}
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════
                SKIN CREDITS — purple, sits between the two panels
            ══════════════════════════════════════════════════════════════ */}
            <div style={{ border: "2px solid #a78bfa55", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ background: "linear-gradient(135deg, #100a1e, #14102a)", padding: "14px 20px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #a78bfa33" }}>
                <span style={{ fontSize: 20 }}>💜</span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#a78bfa", letterSpacing: 2, fontFamily: "Barlow Condensed, sans-serif" }}>SKIN CREDITS</div>
                  <div style={{ fontSize: 12, color: "#c4b5fd", marginTop: 2 }}>Not cash — only become real cost when a player redeems for an RP card.</div>
                </div>
              </div>
              <div style={{ padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ background: "#100a1e", border: "1px solid #a78bfa22", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "#7A7A82", marginBottom: 6 }}>CREDITS OUTSTANDING</div>
                  <div style={{ fontSize: 32, fontWeight: 800, fontFamily: "Barlow Condensed, sans-serif", color: "#a78bfa" }}>{financials.totalCreditsOwed.toFixed(2)}</div>
                  <div style={{ fontSize: 11, color: "#6A6A72", marginTop: 4 }}>Future RP card liability</div>
                </div>
                <div style={{ background: "#100a1e", border: "1px solid #a78bfa22", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ fontSize: 11, letterSpacing: 2, color: "#7A7A82", marginBottom: 6 }}>CREDITS ISSUED ALL-TIME</div>
                  <div style={{ fontSize: 32, fontWeight: 800, fontFamily: "Barlow Condensed, sans-serif", color: "#c4b5fd" }}>{financials.totalCreditsPaidOut.toFixed(2)}</div>
                  <div style={{ fontSize: 11, color: "#6A6A72", marginTop: 4 }}>Created from real bet wins</div>
                </div>
              </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════
                PANEL 2 — FAKE MONEY  (dimmed gold, engagement only)
            ══════════════════════════════════════════════════════════════ */}
            <div style={{ border: "1px solid #C8AA6E33", borderRadius: 10, overflow: "hidden", opacity: 0.75 }}>
              <div style={{ background: "#0d0c08", padding: "14px 20px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #C8AA6E22" }}>
                <span style={{ fontSize: 20 }}>🎮</span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#C8AA6E", letterSpacing: 2, fontFamily: "Barlow Condensed, sans-serif" }}>VIRTUAL GOLD — FAKE MONEY</div>
                  <div style={{ fontSize: 12, color: "#7A7A82", marginTop: 2 }}>No financial impact. For engagement tracking only. Ignore for accounting.</div>
                </div>
              </div>
              <div style={{ padding: 20 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                  {[
                    { label: "Virtual Bets", val: financials.virtual.totalBets, color: "#C8AA6E" },
                    { label: "Player Wins", val: financials.virtual.wins, color: "#A0A0A8" },
                    { label: "Player Losses", val: financials.virtual.losses, color: "#A0A0A8" },
                    { label: "Fake $ Wagered", val: `$${financials.virtual.wagered.toFixed(2)}`, color: "#C8AA6E" },
                    { label: "Player Win Rate", val: `${financials.virtual.winRate}%`, color: "#A0A0A8" },
                  ].map(({ label, val, color }) => (
                    <div key={label} style={{ background: "#0d0c08", border: "1px solid #C8AA6E15", borderRadius: 6, padding: "10px 12px", textAlign: "center" }}>
                      <div style={{ fontSize: 10, letterSpacing: 1, color: "#555550", marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "Barlow Condensed, sans-serif", color }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Platform counts row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {[
                { label: "Total Players", val: financials.totalPlayers, color: "#F0F0F0" },
                { label: "PayPal Deposits", val: financials.totalDeposits, color: "#4ade80" },
                { label: "RP Cards Sent", val: financials.totalRedemptionsFulfilled, color: "#C8AA6E" },
                { label: "RP Cards Pending", val: financials.totalRedemptionsPending, color: "#fb923c" },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ ...S.card, textAlign: "center" }}>
                  <div style={S.label}>{label}</div>
                  <div style={{ fontSize: 32, fontWeight: 800, fontFamily: "Barlow Condensed, sans-serif", color, marginTop: 6 }}>{val}</div>
                </div>
              ))}
            </div>

          </div>
        )}


        {/* ══ ACTIVITY TAB ═══════════════════════════════════════════════════ */}
        {!loading && tab === "activity" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={S.sectionTitle}>Recent Activity <span style={{ color: "#7A7A82", fontSize: 14, fontWeight: 400 }}>— last 80 events across all players</span></div>
            {activity.map((a, i) => {
              const cfg = {
                deposit: { icon: "💵", color: "#4ade80", label: "Deposit" },
                bet: { icon: "🎮", color: a.status === "won" ? "#3FB950" : a.status === "lost" ? "#F85149" : a.status === "cancelled" ? "#7A7A82" : "#C8AA6E", label: `Bet ${a.status}` },
                redemption: { icon: "💜", color: "#a78bfa", label: `Redemption ${a.status}` },
              }[a.type] || { icon: "·", color: "#7A7A82", label: a.type };

              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "13px 18px", background: "#1A1A1E", border: "1px solid #2A2A2E", borderRadius: 6 }}>
                  <div style={{ fontSize: 20, width: 28, textAlign: "center", flexShrink: 0 }}>{cfg.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ color: "#F0F0F0", fontWeight: 700, fontSize: 14 }}>{a.username}</span>
                      <span style={{ fontSize: 11, color: cfg.color, border: `1px solid ${cfg.color}55`, padding: "2px 8px", borderRadius: 3, fontWeight: 700 }}>{cfg.label.toUpperCase()}</span>
                      {a.mode === "real" && <span style={{ fontSize: 11, color: "#4ade80", border: "1px solid #4ade8044", padding: "2px 6px", borderRadius: 3 }}>REAL</span>}
                      {a.skinName && <span style={{ fontSize: 13, color: "#a78bfa" }}>{a.skinName}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ color: cfg.color, fontWeight: 700, fontSize: 15 }}>{fmt(a.amount)}</div>
                    <div style={{ color: "#7A7A82", fontSize: 12, marginTop: 2 }}>{timeAgo(a.ts)}</div>
                  </div>
                </div>
              );
            })}
            {!activity.length && <div style={{ textAlign: "center", padding: 48, color: "#7A7A82", fontSize: 14 }}>No activity yet.</div>}
          </div>
        )}
      </div>

      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
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

  // Auto-poll every 60s when player has a pending bet
  // The cron job resolves it server-side — we just need to refresh the UI
  const hasPendingBet = user?.bets?.some(b => b.status === "pending");
  useEffect(() => {
    if (!hasPendingBet || !user?.username) return;
    const poll = async () => {
      try {
        const data = await fetch("/api/user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getUser", username: user.username })
        }).then(r => r.json());
        if (data.user) {
          const wasResolved = data.user.bets?.some(
            b => b.status !== "pending" &&
            user.bets?.find(ob => ob.id === b.id && ob.status === "pending")
          );
          setUser(data.user);
          if (wasResolved) {
            const resolved = data.user.bets?.find(
              b => user.bets?.find(ob => ob.id === b.id && ob.status === "pending") && b.status !== "pending"
            );
            if (resolved?.status === "won") showToast("🏆 Your bet was resolved — you WON!", "success");
            else if (resolved?.status === "lost") showToast("Your bet has been resolved.", "info");
          }
        }
      } catch (_) {}
    };
    const interval = setInterval(poll, 60000); // every 60s
    return () => clearInterval(interval);
  }, [hasPendingBet, user?.username]);

  if (!user) return <AuthPage onLogin={setUser} />;
  if (user.isAdmin) return <AdminPanel adminToken={user.adminToken} onLogout={() => setUser(null)} />;

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
                <div style={{ fontSize: 13, fontWeight: 700, color: "#4ade80" }}>{formatEUR(user.realBalance || 0)}</div>
              </div>
              <div style={{ background: "#1A1A1E", border: "1px solid #a78bfa33", borderRadius: 4, padding: "4px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 8, letterSpacing: 2, color: "#7c3aed" }}>CREDITS</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#a78bfa" }}>{formatEUR(user.skinCredits || 0)}</div>
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
                <div style={{ color: "#4ade80", fontSize: 26, fontWeight: 700, fontFamily: "Barlow Condensed, sans-serif" }}>{formatEUR(user.realBalance || 0)}</div>
                <div style={{ color: "#86efac", fontSize: 11, marginTop: 4, fontFamily: "DM Sans, sans-serif" }}>💳 withdrawable</div>
              </div>
              <div style={{ background: "linear-gradient(135deg, #1a0d28, #0d0818)", border: "1px solid #a78bfa33", borderRadius: 8, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#a78bfa" }} />
                  <div style={{ fontSize: 10, letterSpacing: 3, color: "#a78bfa" }}>SKIN CREDITS</div>
                </div>
                <div style={{ color: "#a78bfa", fontSize: 26, fontWeight: 700, fontFamily: "Barlow Condensed, sans-serif" }}>{formatEUR(user.skinCredits || 0)}</div>
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
