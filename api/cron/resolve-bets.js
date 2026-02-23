// api/cron/resolve-bets.js
// Vercel cron job — runs every 5 minutes automatically.
// Finds all pending bets, checks Riot API for completed games, resolves them.
// Players never need to click "Resolve" — this handles everything server-side.

const { neon } = require("@neondatabase/serverless");
const sql = neon(process.env.POSTGRES_URL);

// ─── RIOT API HELPERS ────────────────────────────────────────────────────────
const RIOT_KEY = process.env.RIOT_API_KEY;

// Map region stored in DB to the correct Riot routing domains
const getRegionDomains = (region = "euw1") => {
  const r = region.toLowerCase();
  // Platform domain (for match-v5 matchlist and match data)
  const platform = {
    euw1: "europe", eun1: "europe", tr1: "europe", ru: "europe",
    na1: "americas", br1: "americas", la1: "americas", la2: "americas",
    kr: "asia", jp1: "asia",
    oc1: "sea", ph2: "sea", sg2: "sea", th2: "sea", tw2: "sea", vn2: "sea",
  }[r] || "europe";
  return { platform, summoner: r };
};

const riotFetch = async (url) => {
  const res = await fetch(url, {
    headers: { "X-Riot-Token": RIOT_KEY }
  });
  if (res.status === 429) throw new Error("Riot rate limit hit — will retry next cron run");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Riot API ${res.status}: ${url}`);
  return res.json();
};

const getLastRankedMatch = async (puuid, region) => {
  const { platform, summoner } = getRegionDomains(region);

  // Get last 1 ranked solo/duo match
  const matchIds = await riotFetch(
    `https://${platform}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&type=ranked&start=0&count=1`
  );
  if (!matchIds || !matchIds.length) return null;

  const match = await riotFetch(
    `https://${platform}.api.riotgames.com/lol/match/v5/matches/${matchIds[0]}`
  );
  if (!match) return null;

  const participant = match.info.participants.find(p => p.puuid === puuid);
  if (!participant) return null;

  return {
    matchId: matchIds[0],
    win: participant.win,
    champion: participant.championName,
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    gameEndTimestamp: match.info.gameEndTimestamp,
  };
};

// ─── RESOLVE ONE BET ─────────────────────────────────────────────────────────
const resolveBet = async (bet, matchResult) => {
  const won = matchResult.win;
  const status = won ? "won" : "lost";
  const resolvedAt = Date.now();

  await sql`
    UPDATE bets
    SET status = ${status},
        match_id = ${matchResult.matchId},
        result = ${JSON.stringify(matchResult)},
        resolved_at = ${resolvedAt}
    WHERE id = ${bet.id}
  `;

  if (won) {
    const stake = Number(bet.amount);
    const totalPayout = Number(bet.potential_win);
    const profit = totalPayout - stake;

    if (bet.mode === "real") {
      // Return stake to real balance, profit goes to skin credits
      await sql`
        UPDATE users SET
          real_balance = real_balance + ${stake},
          skin_credits = skin_credits + ${profit}
        WHERE username = ${bet.username}
      `;
    } else {
      // Virtual: full payout back to virtual balance
      await sql`
        UPDATE users SET balance = balance + ${totalPayout}
        WHERE username = ${bet.username}
      `;
    }
  }
  // On loss: stake was already deducted when bet was placed, nothing to do
};

// ─── MAIN HANDLER ────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // Vercel cron jobs call via GET with the cron secret in the Authorization header
  // Reject any request that doesn't have the secret (prevents abuse)
  const authHeader = req.headers["authorization"];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!RIOT_KEY) {
    return res.status(500).json({ error: "RIOT_API_KEY not set" });
  }

  const log = [];
  const errors = [];

  try {
    // Find all pending bets — join users to get puuid and region
    const pendingBets = await sql`
      SELECT b.*, u.puuid, u.lol_account,
             COALESCE(u.region, 'euw1') as region
      FROM bets b
      JOIN users u ON u.username = b.username
      WHERE b.status = 'pending'
      ORDER BY b.placed_at ASC
    `;

    if (!pendingBets.length) {
      return res.status(200).json({ message: "No pending bets", resolved: 0 });
    }

    log.push(`Found ${pendingBets.length} pending bet(s)`);

    // Process each bet — stagger to respect Riot rate limits (20 req/sec personal key)
    let resolved = 0;
    let skipped = 0;

    for (const bet of pendingBets) {
      try {
        if (!bet.puuid) {
          log.push(`  [${bet.username}] skipped — no puuid`);
          skipped++;
          continue;
        }

        // Safety: ignore bets placed in the last 15 minutes
        // (game can't have ended yet, no point checking)
        const minutesSinceBet = (Date.now() - Number(bet.placed_at)) / 60000;
        if (minutesSinceBet < 15) {
          log.push(`  [${bet.username}] too recent (${Math.round(minutesSinceBet)}m) — skipping`);
          skipped++;
          continue;
        }

        const matchResult = await getLastRankedMatch(bet.puuid, bet.region);

        if (!matchResult) {
          log.push(`  [${bet.username}] no match data yet`);
          skipped++;
          continue;
        }

        // Only resolve if the game ended AFTER the bet was placed
        if (matchResult.gameEndTimestamp <= Number(bet.placed_at)) {
          log.push(`  [${bet.username}] last game was before bet — waiting for new game`);
          skipped++;
          continue;
        }

        // Check it's not a duplicate resolution (matchId already used)
        const duplicate = await sql`
          SELECT id FROM bets WHERE match_id = ${matchResult.matchId} AND username = ${bet.username}
          AND status != 'pending'
        `;
        if (duplicate.length) {
          log.push(`  [${bet.username}] match already resolved — skipping duplicate`);
          skipped++;
          continue;
        }

        // All good — resolve it
        await resolveBet(bet, matchResult);
        log.push(`  [${bet.username}] resolved → ${matchResult.win ? "WON" : "LOST"} (${matchResult.champion} ${matchResult.kills}/${matchResult.deaths}/${matchResult.assists})`);
        resolved++;

        // Small delay between Riot API calls to stay under rate limits
        await new Promise(r => setTimeout(r, 150));

      } catch (betErr) {
        const msg = `  [${bet.username}] error: ${betErr.message}`;
        log.push(msg);
        errors.push(msg);
        // Don't let one failure abort the whole batch
      }
    }

    return res.status(200).json({
      resolved,
      skipped,
      errors: errors.length,
      log,
    });

  } catch (e) {
    return res.status(500).json({ error: e.message, log });
  }
};
