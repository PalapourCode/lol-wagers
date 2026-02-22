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

  return (
    <div style={{
      minHeight: "100vh", background: "#010A13",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: "Cinzel, serif",
      backgroundImage: "radial-gradient(ellipse at 50% 0%, #0A1628 0%, #010A13 70%)"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;900&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap');
        * { box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        input::placeholder { color: #785A2888; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #010A13; } ::-webkit-scrollbar-thumb { background: #785A28; border-radius: 3px; }
      `}</style>

      {/* Decorative hex frame */}
      <div style={{ textAlign: "center", marginBottom: 40, animation: "fadeIn 0.8s ease" }}>
        <div style={{ fontSize: 11, letterSpacing: 6, color: "#785A28", marginBottom: 12 }}>RUNETERRA WAGERS</div>
        <h1 style={{
          fontSize: 48, fontWeight: 900, color: "#C8AA6E", margin: 0,
          textShadow: "0 0 40px #C8AA6E55", lineHeight: 1
        }}>BET ON<br /><span style={{ color: "#F0E6D3" }}>YOURSELF</span></h1>
        <div style={{ width: 80, height: 2, background: "linear-gradient(90deg, transparent, #C8AA6E, transparent)", margin: "16px auto" }} />
        <p style={{ color: "#785A28", fontSize: 12, fontFamily: "Crimson Text, serif", fontStyle: "italic", margin: 0 }}>
          Stake your gold. Prove your rank.
        </p>
      </div>

      <div style={{
        background: "#0A1628", border: "1px solid #785A2855", borderRadius: 4,
        padding: 36, width: 360, animation: "fadeIn 0.8s ease 0.1s both"
      }}>
        <div style={{ display: "flex", marginBottom: 28, border: "1px solid #785A2833", borderRadius: 3, overflow: "hidden" }}>
          {["login", "register"].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: "10px", border: "none", cursor: "pointer",
              background: mode === m ? "#C8AA6E" : "transparent",
              color: mode === m ? "#010A13" : "#785A28",
              fontFamily: "Cinzel, serif", fontSize: 12, fontWeight: 700,
              textTransform: "uppercase", letterSpacing: 2, transition: "all 0.2s"
            }}>{m}</button>
          ))}
        </div>

        {[
          { label: "Username (case insensitive)", value: username, set: setUsername, type: "text" },
          { label: "Password", value: password, set: setPassword, type: "password" }
        ].map(f => (
          <div key={f.label} style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 10, letterSpacing: 3, color: "#785A28", marginBottom: 6 }}>
              {f.label.toUpperCase()}
            </label>
            <input
              type={f.type} value={f.value}
              onChange={e => f.set(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handle()}
              style={{
                width: "100%", background: "#010A13", border: "1px solid #785A2855",
                color: "#F0E6D3", padding: "10px 14px", borderRadius: 3,
                fontFamily: "Cinzel, serif", fontSize: 13, outline: "none",
                transition: "border-color 0.2s"
              }}
              onFocus={e => e.target.style.borderColor = "#C8AA6E"}
              onBlur={e => e.target.style.borderColor = "#785A2855"}
            />
          </div>
        ))}

        {error && <p style={{ color: "#C8464A", fontSize: 12, marginBottom: 16, fontFamily: "Crimson Text, serif" }}>⚠ {error}</p>}

        {loading ? <Loader text="Authenticating..." /> : (
          <button onClick={handle} style={{
            width: "100%", background: "linear-gradient(135deg, #C8AA6E, #785A28)",
            border: "none", color: "#010A13", padding: "12px", borderRadius: 3,
            fontFamily: "Cinzel, serif", fontSize: 13, fontWeight: 700,
            letterSpacing: 2, cursor: "pointer", textTransform: "uppercase",
            transition: "opacity 0.2s"
          }}
            onMouseEnter={e => e.target.style.opacity = "0.85"}
            onMouseLeave={e => e.target.style.opacity = "1"}
          >
            {mode === "login" ? "Enter the Rift" : "Create Account"}
          </button>
        )}

        {mode === "register" && (
          <p style={{ color: "#785A28", fontSize: 11, marginTop: 16, textAlign: "center", fontFamily: "Crimson Text, serif" }}>
            You start with <strong style={{ color: "#C8AA6E" }}>$500 in fake gold</strong> to test the platform.
          </p>
        )}
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
function ResolveBet({ user, setUser, region, toast }) {
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

      if (won) {
        toast(`🏆 You won! +${formatMoney(activeBet.potentialWin)} added to your balance!`, "success");
      } else {
        toast(`💀 You lost. Better luck next time, summoner.`, "error");
      }
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


// ─── DEBUG PANEL (admin only) ────────────────────────────────────────────────
function DebugPanel({ user, setUser, toast }) {
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
      toast(won ? "🏆 Simulated WIN!" : "💀 Simulated LOSS!", won ? "success" : "error");
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

      {/* Content */}
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "32px 24px", animation: "fadeIn 0.3s ease" }}>

        {tab === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Stats row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {[
                { label: "Balance", value: formatMoney(user.balance), color: "#C8AA6E" },
                { label: "Wins", value: stats.wins, color: "#0BC4AA" },
                { label: "Losses", value: stats.losses, color: "#C8464A" },
                { label: "Win Rate", value: stats.wins + stats.losses > 0 ? `${Math.round(stats.wins / (stats.wins + stats.losses) * 100)}%` : "—", color: "#C8AA6E" }
              ].map(s => (
                <div key={s.label} style={{ background: "#0A1628", border: "1px solid #785A2833", borderRadius: 4, padding: "16px 20px" }}>
                  <div style={{ fontSize: 9, letterSpacing: 3, color: "#785A28", marginBottom: 6 }}>{s.label.toUpperCase()}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>
            <LinkAccount user={user} setUser={updateUser} region={region} setRegion={setRegion} toast={showToast} />
            <PlaceBet user={user} setUser={updateUser} toast={showToast} />
            <ResolveBet user={user} setUser={updateUser} region={region} toast={showToast} />
          </div>
        )}

        {tab === "bet" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <LinkAccount user={user} setUser={updateUser} region={region} setRegion={setRegion} toast={showToast} />
            <PlaceBet user={user} setUser={updateUser} toast={showToast} />
            <ResolveBet user={user} setUser={updateUser} region={region} toast={showToast} />
          </div>
        )}

        {tab === "history" && <BetHistory bets={user.bets} />}
        {tab === "leaderboard" && <Leaderboard />}
      </div>

      {toast && <Toast key={toast.id} message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <DebugPanel user={user} setUser={updateUser} toast={showToast} />
    </div>
  );
}
