module.exports = async function handler(req, res) {
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
  const matchId = req.query.matchId || req.query.matchid;

  const routing = { euw1: "europe", na1: "americas", kr: "asia", br1: "americas" }[region] || "europe";

  let url = "";
  try {
    if (action === "account") {
      url = `https://europe.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    } else if (action === "rank") {
      url = `https://${region}.api.riotgames.com/lol/league/v4/entries/by-puuid/${puuid}`;
    } else if (action === "summoner") {
      url = `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}`;
    } else if (action === "matchlist") {
      url = `https://${routing}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&start=0&count=1`;
    } else if (action === "match") {
      url = `https://${routing}.api.riotgames.com/lol/match/v5/matches/${matchId}`;
    } else if (action === "mastery") {
      // Top 3 champion masteries by puuid
      url = `https://${region}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=3`;
    } else if (action === "championdata") {
      // Fetch latest Data Dragon champion list to resolve champion IDs → names
      // First get latest version
      const versionRes = await fetch("https://ddragon.leagueoflegends.com/api/versions.json");
      const versions = await versionRes.json();
      const latest = versions[0];
      const champRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${latest}/data/en_US/champion.json`);
      const champData = await champRes.json();
      // Build id->key map (key = champion name used in image URLs)
      const idToKey = {};
      Object.values(champData.data).forEach(c => { idToKey[c.key] = c.id; });
      return res.status(200).json({ version: latest, idToKey });
    } else {
      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    const separator = url.includes("?") ? "&" : "?";
    const finalUrl = `${url}${separator}api_key=${apiKey}`;
    const response = await fetch(finalUrl);
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    return res.status(response.status).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
