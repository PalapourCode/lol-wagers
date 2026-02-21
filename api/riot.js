export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const apiKey = process.env.RIOT_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "No API key configured" });

  const action = req.query.action;
  const gameName = req.query.gameName || req.query.gamename;
  const tagLine = req.query.tagLine || req.query.tagline;
  const region = req.query.region || "euw1";
  const puuid = req.query.puuid;
  const summonerId = req.query.summonerId || req.query.summonerid;
  const matchId = req.query.matchId || req.query.matchid;

  const routing = { euw1: "europe", na1: "americas", kr: "asia", br1: "americas" }[region] || "europe";

  let url = "";
  try {
    if (action === "account") {
      url = `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    } else if (action === "summoner") {
      url = `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`;
    } else if (action === "rank") {
      // Try by summonerId first, fall back to puuid-based rank lookup
      url = `https://${region}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summonerId}`;
    } else if (action === "rankbypuuid") {
      // Direct rank lookup using puuid via summoner endpoint
      url = `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`;
    } else if (action === "matchlist") {
      url = `https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&start=0&count=1`;
    } else if (action === "match") {
      url = `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
    } else {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    const separator = url.includes("?") ? "&" : "?";
    const finalUrl = `${url}${separator}api_key=${apiKey}`;
    const response = await fetch(finalUrl);
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch { data = { raw: text }; }
    return res.status(response.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message, url });
  }
}
